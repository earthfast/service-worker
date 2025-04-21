import {Adapter} from '../adapter';
import {AppVersion} from '../app-version';
import {Database} from '../database';
import {Driver, DriverReadyState} from '../driver';
import {IdleScheduler} from '../idle';
import {hashManifest, Manifest, ManifestHash} from '../manifest';

import {ContentAPIClient} from './api';
import {ArmadaAppVersion} from './app-version';
import {majorityResult} from './consensus';
import {SwManifestFetchFailureError} from './error';
import {MsgContentNodesFetchFailure, MsgManifestFetchError, MsgManifestFetchNoConsensus} from './msg';
import {NodeRegistry} from './registry';

// Armada:
// These 2 values were changed
const IDLE_DELAY = 1000;
const MAX_IDLE_DELAY = 5000;

export class ArmadaDriver extends Driver {
  public static readonly MANIFEST_FILENAME = 'earthfast.json';
  public static readonly FALLBACK_MANIFEST_FILENAME = 'armada.json';

  // Override the state property so we can panic if the service worker ever attempts to transition
  // into a non-NORMAL state. We throw an error instead of just ignoring it because such a
  // transition isn't ever expected to happen given the changes we've made from the base Driver.
  // Therefore, if it does occur then it's a bug and would indicate a potential security issue since
  // non-NORMAL modes often blindly pass requests through to the network.
  override set state(value: DriverReadyState) {
    if (value != DriverReadyState.NORMAL) {
      throw new Error(`Driver attepted to transition into an unsupported state: ${value}`);
    }
    super.state = value;
  }
  override get state(): DriverReadyState {
    return super.state;
  }

  constructor(
      override scope: ServiceWorkerGlobalScope, override adapter: Adapter, override db: Database,
      protected registry: NodeRegistry, protected apiClient: ContentAPIClient,
      protected subtleCrypto: SubtleCrypto) {
    super(scope, adapter, db);

    // required to pick up the updated IDLE_DELAY and MAX_IDLE_DELAY values
    this.idle = new IdleScheduler(this.adapter, IDLE_DELAY, MAX_IDLE_DELAY, this.debugger);
  }

  /**
   * The handler for fetch events.
   *
   * This is the transition point between the synchronous event handler and the
   * asynchronous execution that eventually resolves for respondWith() and waitUntil().
   *
   * Armada: removed code in the orig function that allowed bypassing and caching
   */
  override onFetch(event: FetchEvent): void {
    const req = event.request;
    const scopeUrl = this.scope.registration.scope;
    const requestUrlObj = this.adapter.parseUrl(req.url, scopeUrl);

    // The only thing that is served unconditionally is the debug page.
    if (requestUrlObj.path === this.ngswStatePath) {
      // Allow the debugger to handle the request, but don't affect SW state in any other way.
      event.respondWith(this.debugger.handleFetch(req));
      return;
    }

    // Past this point, the SW commits to handling the request itself. This could still
    // fail (and result in `state` being set to `SAFE_MODE`), but even in that case the
    // SW will still deliver a response.
    event.respondWith(this.handleFetch(event));
  }

  protected override async initialize(): Promise<void> {
    await super.initialize();

    // schedule the interval for feteching fresh content nodes
    this.registry.refreshNodesInterval();
  }

  override async ensureInitialized(event: ExtendableEvent): Promise<void> {
    // Since the SW may have just been started, it may or may not have been initialized already.
    // `this.initialized` will be `null` if initialization has not yet been attempted, or will be a
    // `Promise` which will resolve (successfully or unsuccessfully) if it has.
    if (this.initialized !== null) {
      return this.initialized;
    }

    // Initialization has not yet been attempted, so attempt it. This should only ever happen once
    // per SW instantiation.
    try {
      this.initialized = this.initialize();
      await this.initialized;

      // Armada:
      // Let the client know that the Service Worker is ready so it can reload the page, resulting
      // in an intercepted index.html request.
      await this.notifyClientsAboutInitialization();
    } catch (error) {
      // Armada:
      // In the case of an error we reset the pending initialization Promise, allowing for
      // subsequent calls to `ensureInitialized` to retry the initialization routine.
      this.initialized = null;

      throw error;
    } finally {
      // Regardless if initialization succeeded, background tasks still need to happen.
      event.waitUntil(this.idle.trigger());
    }
  }

  override async handleFetch(event: FetchEvent): Promise<Response> {
    // Require that the SW instance has been initialized.
    await this.ensureInitialized(event);

    const req = event.request;

    // Special handling for navigation requests
    if (req.mode === 'navigate') {
      // On navigation requests, check for new updates - but don't wait for completion
      if (!this.scheduledNavUpdateCheck) {
        this.scheduledNavUpdateCheck = true;
        // Schedule immediately and with high priority
        const checkPromise = this.checkForUpdate()
                                 .catch(err => {
                                   console.error('Update check failed:', err);
                                 })
                                 .finally(() => {
                                   this.scheduledNavUpdateCheck = false;
                                 });
        event.waitUntil(checkPromise);
      }

      // Handle navigation with special logic
      const navigationResponse = await this.handleNavigationRequest(req, event.clientId);
      if (navigationResponse) {
        // Make sure we trigger idle tasks
        event.waitUntil(this.idle.trigger());
        return navigationResponse;
      }
    }

    // Don't integrity check remote requests.
    const url = this.adapter.normalizeUrl(event.request.url);
    if (!url.startsWith('/')) {
      return this.safeFetch(event.request);
    }

    // Decide which version of the app to use to serve this request. This is asynchronous as in
    // some cases, a record will need to be written to disk about the assignment that is made.
    const appVersion = await this.assignVersion(event);
    let res: Response|null = null;

    try {
      if (appVersion !== null) {
        try {
          // Handle the request. First try the AppVersion. If that doesn't work, fall back on the
          // network.
          res = await appVersion.handleFetch(event.request, event);
        } catch (err) {
          if (err.isUnrecoverableState) {
            await this.notifyClientsAboutUnrecoverableState(appVersion, err.message);
          }
          if (err.isContentNodesFetchFailure) {
            // send message to clients about all content nodes failing
            await this.broadcast(MsgContentNodesFetchFailure(err.message));
            return this.adapter.newResponse(null, {status: err.status, statusText: err.statusText});
          }
          if (err.isCritical) {
            // Something went wrong with handling the request from this version.
            this.debugger.log(err, `Driver.handleFetch(version: ${appVersion.manifestHash})`);
          }
          throw err;
        }
      } else {
        // Armada:
        // The original implementation would fall back to making a plain fetch when no AppVersion
        // was assigned. However, we require it since that's where integrity checking is done.
        throw new Error('No assigned AppVersion');
      }

      // The response will be `null` only if no `AppVersion` can be assigned to the request or if
      // the assigned `AppVersion`'s manifest doesn't specify what to do about the request.
      // In that case, just fall back on the network.
      if (res === null) {
        // Armada:
        // Convert safeFetch into a 404 response
        return this.adapter.newResponse(null, {status: 404, statusText: 'Not Found'});
      }

      // The `AppVersion` returned a usable response, so return it.
      return res;
    } finally {
      // Trigger the idle scheduling system. The Promise returned by `trigger()` will resolve after
      // a specific amount of time has passed. If `trigger()` hasn't been called again by then (e.g.
      // on a subsequent request), the idle task queue will be drained and the `Promise` won't
      // be resolved until that operation is complete as well.
      event.waitUntil(this.idle.trigger());
    }
  }

  protected async handleNavigationRequest(request: Request, clientId: string):
      Promise<Response|null> {
    // Get the app version assigned to this client
    const appVersion = await this.assignVersion({clientId, request} as FetchEvent);

    if (!appVersion) {
      return null;
    }

    try {
      // Check the navigation strategy from the manifest
      if (appVersion.manifest.navigationRequestStrategy !== 'freshness') {
        // In performance mode, redirect to index
        const indexUrl = appVersion.manifest.index;

        // Create a proper URL by resolving against the scope
        const scope = this.scope.registration.scope;
        const fullUrl = new URL(indexUrl, scope).toString();

        // Use the app version to handle the request to ensure proper CID validation
        return await appVersion.handleFetch(
            new Request(fullUrl), {clientId, request} as FetchEvent);
      } else {
        // In freshness mode, fetch from network directly
        return await this.safeFetch(request);
      }
    } catch (err) {
      console.error('Navigation request handling error:', err);
      return this.adapter.newResponse(null, {status: 404, statusText: 'Not Found'});
    }
  }

  /**
   * Retrieve the latest manifest from the content nodes. A manifest will only be returned if a
   * majority of the content nodes provide the exact same copy, otherwise this will reject.
   */
  protected override async fetchLatestManifest(ignoreOfflineError?: false): Promise<Manifest>;
  protected override async fetchLatestManifest(ignoreOfflineError: true): Promise<Manifest|null>;
  protected override async fetchLatestManifest(): Promise<Manifest> {
    const nodes = await this.registry.allNodes(false);
    try {
      const manifestJSON = await majorityResult(nodes.map(n => this.fetchLatestManifestOnce(n)));
      return JSON.parse(manifestJSON) as Manifest;
    } catch (err) {
      await this.broadcast(MsgManifestFetchNoConsensus(err));
      throw err;
    } finally {
      this.lastUpdateCheck = this.adapter.time;
    }
  }

  protected async fetchLatestManifestOnce(node: string): Promise<string> {
    const filenames = [ArmadaDriver.MANIFEST_FILENAME, ArmadaDriver.FALLBACK_MANIFEST_FILENAME];
    for (const filename of filenames) {
      try {
        const resp = await this.apiClient.getContent(filename, node, undefined, true);

        if (resp.ok) {
          return resp.text();
        }

        if (filename === filenames[filenames.length - 1]) {
          throw new Error(`HTTP error: ${resp.status}`);
        }
      } catch (err) {
        if (filename === filenames[filenames.length - 1]) {
          const msg = `Error fetching manifest: node=${node} error=${err}`;
          await this.broadcast(MsgManifestFetchError(msg));
          throw new SwManifestFetchFailureError(msg);
        }
      }
    }

    throw new Error('Unexpected error in fetchLatestManifestOnce');
  }

  protected async probeLatestManifest(): Promise<Manifest> {
    const nodes = await this.registry.allNodes(true);
    for (let i = 0; i < nodes.length; i++) {
      try {
        const manifestJSON = await this.fetchLatestManifestOnce(nodes[i]);
        return JSON.parse(manifestJSON) as Manifest;
      } catch (err) {
        const msg = `Error fetching manifest: node=${nodes[i]} error=${err}`;
        this.debugger.log(msg);
        await this.broadcast(MsgManifestFetchError(msg));
      }
    }
    throw new Error(`Manifest probe failed: attempts=${nodes.length}`);
  }

  // Armada:
  // noop
  // eslint-disable-next-line
  override async versionFailed(_appVersion: AppVersion, _err: Error): Promise<void> {}

  override async checkForUpdate(): Promise<boolean> {
    let hash = '(unknown)';
    try {
      // Probe a random content node to determine if there *might* be a new version available.
      // Since we don't consider any single content node to be authoritative, this is just an
      // inexpensive signal that tells us whether we need to poll all the nodes (expensive) or
      // not.
      const probeManifest = await this.probeLatestManifest();
      if (this.latestHash == hashManifest(probeManifest)) {
        return false;
      }

      // The probe passed, so ask every node for the manifest.
      const manifest = await this.fetchLatestManifest();
      hash = hashManifest(manifest);

      // Check whether this is really an update.
      // Armada:
      // Originally: if (this.versions.has(hash)) { return false; }
      // I believe the intention was to prevent CDNs or other caches from accidentally
      // reverting a site to a previous version, however, the side effect is that you can't
      // do a normal rollback or switch back and forth between versions (handy for demos).
      if (this.latestHash == hash) {
        return false;
      }

      await this.notifyClientsAboutVersionDetected(manifest, hash);

      await this.setupUpdate(manifest, hash);

      return true;
    } catch (err) {
      this.debugger.log(err as Error, `Error occurred while updating to manifest ${hash}`);
      return false;
    }
  }

  // Armada:
  // noop
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override async notifyClientsAboutNoNewVersionDetected(manifest: Manifest, hash: string):
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      Promise<void> {}

  override async notifyClientsAboutVersionDetected(manifest: Manifest, hash: string):
      Promise<void> {
    this.debugger.log(`New site version detected: ${hash}`);
    return super.notifyClientsAboutVersionDetected(manifest, hash);
  }

  // Armada:
  // New function
  async notifyClientsAboutInitialization(): Promise<void> {
    return this.broadcast({type: 'INITIALIZED'});
  }

  protected override newAppVersion(manifest: Manifest, hash: ManifestHash): AppVersion {
    return new ArmadaAppVersion(
        this.scope, this.adapter, this.db, this.idle, this.debugger, manifest, hash, this.registry,
        this.apiClient, this.subtleCrypto);
  }
}
