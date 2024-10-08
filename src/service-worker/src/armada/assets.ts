import {Adapter} from '../adapter';
import {LazyAssetGroup} from '../assets';
import {Database} from '../database';
import {SwCriticalError, SwUnrecoverableStateError} from '../error';
import {IdleScheduler} from '../idle';
import {AssetGroupConfig} from '../manifest';
import {MsgAny} from '../msg';
import {sha1Binary} from '../sha1';

import {ContentAPIClient} from './api';
import {SwContentNodesFetchFailureError} from './error';
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
  static readonly MAX_ATTEMPTS = 5;

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

  async fetchContent(url: string): Promise<Response> {
    const nodes = await this.registry.allNodes(true);

    let i = 0;
    let resp: Response|undefined;
    for (; i < nodes.length && i < ArmadaLazyAssetGroup.MAX_ATTEMPTS; i++) {
      const retry = (i > 0) ? nodes[i - 1] : undefined;
      try {
        resp = await this.apiClient.getContent(url, nodes[i], retry);
      } catch (err) {
        const msg = `Error fetching content: node=${nodes[i]} resource=${url} error=${err}`;
        await this.broadcaster.postMessage(MsgContentNodeFetchFailure(msg));
        continue;
      }

      if (!resp.ok) {
        const msg =
            `Error fetching content: node=${nodes[i]} resource=${url} status=${resp.status}`;
        await this.broadcaster.postMessage(MsgContentNodeFetchFailure(msg));
        continue;
      }

      if (!await this.hashMatches(url, resp.clone())) {
        const msg = `Content hash mismatch: node=${nodes[i]} resource=${url}`;
        await this.broadcaster.postMessage(MsgContentChecksumMismatch(msg));
        continue;
      }

      return resp;
    }

    const msg = `Failed to fetch content: resource=${url} attempts=${i}`;
    throw new SwContentNodesFetchFailureError(msg, resp?.status, resp?.statusText);
  }

  /**
   * Determine if the hash of an asset matches a hash of the response
   */
  async hashMatches(url: string, response: Response): Promise<boolean> {
    url = this.adapter.normalizeUrl(url);
    const canonicalHash = this.hashes.get(url);

    // Armada:
    // Don't serve resources that can't be integrity checked.
    if (!canonicalHash) {
      throw new SwCriticalError(`Missing hash (safeContentFetch): ${url}`);
    }

    // Compute a checksum of the fetched data. We currently support manifests containing either
    // SHA256 or SHA1 checksums, although the latter is for legacy support reasons and is not
    // recommended for use in production.
    let fetchedHash: string;
    if (canonicalHash.length == 64) {
      fetchedHash = await this.sha256Binary(await response.arrayBuffer());
    } else {
      fetchedHash = sha1Binary(await response.arrayBuffer());
    }

    return fetchedHash === canonicalHash;
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