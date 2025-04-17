import {Adapter} from '../adapter';
import {LazyAssetGroup} from '../assets';
import {Database} from '../database';
import {SwCriticalError, SwUnrecoverableStateError} from '../error';
import {IdleScheduler} from '../idle';
import {AssetGroupConfig} from '../manifest';
import {MsgAny} from '../msg';

import {ContentAPIClient} from './api';
import {computeCidV1} from './cid';
import {SwContentNodesFetchFailureError, SwNoArmadaNodes} from './error';
import {MsgContentChecksumMismatch, MsgContentNodeFetchFailure} from './msg';
import {NodeRegistry} from './registry';

interface MessageBroadcaster {
  postMessage(message: MsgAny): Promise<void>;
}

class ThrowingFetcher {
  async fetch(): Promise<Response> {
    throw new Error('ThrowingFetcher always throws');
  }
}

export class ArmadaLazyAssetGroup extends LazyAssetGroup {
  static readonly TIMEOUT_MS = 200;

  constructor(
      adapter: Adapter, idle: IdleScheduler, config: AssetGroupConfig, hashes: Map<string, string>,
      db: Database, cacheNamePrefix: string, protected registry: NodeRegistry,
      protected apiClient: ContentAPIClient, protected broadcaster: MessageBroadcaster,
      protected subtleCrypto: SubtleCrypto) {
    // We pass an instance of ThrowingFetcher to the superclass in order to be certain that every
    // fetch goes through safeContentFetch (and therefore the checksum test). If some codepath
    // happens to find its way to this.safeFetch(), that's a bug and a security issue.
    super(new ThrowingFetcher(), adapter, idle, config, hashes, db, cacheNamePrefix);
  }

  /**
   * Fetches content from available nodes with the following behavior:
   * 1. Starts with the first node immediately
   * 2. Subsequent nodes are tried after TIMEOUT_MS delay if needed
   * 3. Requests continue until either:
   *    - A valid response is received (correct hash)
   *    - All nodes have been tried and failed
   *
   * Error handling:
   * - Failed requests (non-200, hash mismatch) increment completedRequests
   * - Aborted requests are ignored in the completion count
   * - All errors are broadcast for monitoring
   *
   * Abort behavior:
   * - When a valid response is received, all other pending requests are aborted
   * - When all nodes fail, all pending requests are aborted
   * - All controllers are cleaned up in the finally block
   *
   * @param url The URL of the content to fetch
   * @returns A Response object with the requested content
   * @throws SwContentNodesFetchFailureError if all nodes fail
   */
  async fetchContent(url: string): Promise<Response> {
    const nodes = await this.registry.allNodes(true);

    if (nodes.length === 0) {
      throw new SwNoArmadaNodes(`No nodes available`);
    }

    let successfulResponse: Response|null = null;
    let completedRequests = 0;
    const controllers: AbortController[] = [];

    // Helper to abort all controllers except the specified index
    const abortOtherControllers = (exceptIndex?: number) => {
      controllers.forEach((ctrl, i) => {
        if (ctrl && (exceptIndex === undefined || i !== exceptIndex)) {
          ctrl.abort();
        }
      });
    };

    // Helper to start a request to a node
    // Each request gets its own AbortController for individual cancellation
    const startNodeRequest = async (node: string, index: number) => {
      const controller = new AbortController();
      controllers[index] = controller;

      try {
        const response = await this.apiClient.getContent(url, node, undefined, false);

        // Early return if this request was aborted (don't process response)
        if (controller.signal.aborted) {
          return;
        }

        // Track failed responses (non-200) and broadcast error
        if (!response.ok) {
          const msg =
              `Error fetching content: node=${node} resource=${url} status=${response.status}`;
          await this.broadcaster.postMessage(MsgContentNodeFetchFailure(msg));
          completedRequests++;
          return;
        }

        // Validate hash and track/broadcast failures
        if (!await this.hashMatches(url, response.clone())) {
          const msg = `Content hash mismatch: node=${node} resource=${url}`;
          await this.broadcaster.postMessage(MsgContentChecksumMismatch(msg));
          completedRequests++;
          return;
        }

        // Valid response received - store it and abort other requests
        successfulResponse = response;
        abortOtherControllers(index);
      } catch (err) {
        // Only count non-abort errors towards completion
        if (err.name !== 'AbortError') {
          const msg = `Error fetching content: node=${node} resource=${url} error=${err}`;
          await this.broadcaster.postMessage(MsgContentNodeFetchFailure(msg));
          completedRequests++;
        }
      }
    };

    // Main promise that coordinates the requests and their timing
    const resultPromise = new Promise<Response>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;

      // Helper to check if we're done (success or all failed)
      const checkStatus = () => {
        if (successfulResponse) {
          clearTimeout(timeoutId);
          abortOtherControllers();
          resolve(successfulResponse);
        } else if (completedRequests === nodes.length) {
          clearTimeout(timeoutId);
          abortOtherControllers();
          reject(new SwContentNodesFetchFailureError(
              `Failed to fetch content: resource=${url} attempts=${nodes.length}`, undefined,
              'All nodes failed'));
        }
      };

      // Start first request immediately
      startNodeRequest(nodes[0], 0).then(checkStatus);

      // Schedule subsequent requests with delays
      let currentIndex = 1;
      const scheduleNext = () => {
        if (currentIndex < nodes.length && !successfulResponse) {
          startNodeRequest(nodes[currentIndex], currentIndex).then(checkStatus);
          currentIndex++;
          timeoutId = setTimeout(scheduleNext, ArmadaLazyAssetGroup.TIMEOUT_MS);
        }
      };

      timeoutId = setTimeout(scheduleNext, ArmadaLazyAssetGroup.TIMEOUT_MS);
    });

    try {
      return await resultPromise;
    } finally {
      // Ensure all controllers are cleaned up regardless of outcome
      abortOtherControllers();
    }
  }

  /**
   * Determine if the hash of an asset matches a hash of the response
   */
  async hashMatches(url: string, response: Response): Promise<boolean> {
    url = this.adapter.normalizeUrl(url);
    const canonicalCid = this.hashes.get(url);
    if (!canonicalCid) {
      throw new SwCriticalError(`Missing hash (safeContentFetch): ${url}`);
    }
    const fetchedCid = await computeCidV1(await response.arrayBuffer());
    return fetchedCid === canonicalCid;
  }

  protected async sha256Binary(buffer: ArrayBuffer): Promise<string> {
    const digest = await this.subtleCrypto.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Load a particular asset from the network, accounting for hash validation.
   */
  override async cacheBustedFetchFromNetwork(req: Request): Promise<Response> {
    const url = this.adapter.normalizeUrl(req.url);

    // Armada:
    // Don't integrity check remote requests.
    if (!url.startsWith('/')) {
      return this.safeFetch(req);
    }

    // Ideally, the resource would be requested with cache-busting to guarantee the SW gets
    // the freshest version. However, doing this would eliminate any chance of the response
    // being in the HTTP cache. Given that the browser has recently actively loaded the page,
    // it's likely that many of the responses the SW needs to cache are in the HTTP cache and
    // are fresh enough to use. In the future, this could be done by setting cacheMode to
    // *only* check the browser cache for a cached version of the resource, when cacheMode is
    // fully supported. For now, the resource is fetched directly, without cache-busting, and
    // if the hash test fails a cache-busted request is tried before concluding that the
    // resource isn't correct. This gives the benefit of acceleration via the HTTP cache
    // without the risk of stale data, at the expense of a duplicate request in the event of
    // a stale response.

    // Fetch the resource from the network (possibly hitting the HTTP cache).
    const response = await this.fetchContent(url);

    // At this point, `response` is either successful with a matching hash or is unsuccessful.
    // Before returning it, check whether it failed with a 404 status. This would signify an
    // unrecoverable state.
    if (!response.ok && (response.status === 404)) {
      throw new SwUnrecoverableStateError(
          `Failed to retrieve hashed resource from the server. (AssetGroup: ${
              this.config.name} | URL: ${url})`);
    }

    // Return the response (successful or unsuccessful).

    // Armada:
    // Instead of returning the raw Response, we return a new Response instance that has an
    // empty `url` property. This is critical for making relative URLs in stylesheets work
    // properly. See
    // https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith#specifying_the_final_url_of_a_resource
    // for a detailed explanation.
    return this.adapter.newResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}