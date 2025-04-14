import {Adapter} from '../adapter';
import {NormalizedUrl} from '../api';
import {AppVersion} from '../app-version';
import {Database} from '../database';
import {DebugHandler} from '../debug';
import {IdleScheduler} from '../idle';
import {Manifest} from '../manifest';
import {MsgAny} from '../msg';
import {sha1Binary} from '../sha1';

import {ContentAPIClient} from './api';
import {ArmadaLazyAssetGroup} from './assets';
import {computeCIDv1} from './cid'
import {NodeRegistry} from './registry';

class Broadcaster {
  constructor(private scope: ServiceWorkerGlobalScope) {}

  async postMessage(message: MsgAny): Promise<void> {
    const clients = await this.scope.clients.matchAll();
    clients.forEach(client => client.postMessage(message));
  }
}

export class ArmadaAppVersion extends AppVersion {
  private hashFunction: string;

  constructor(
      scope: ServiceWorkerGlobalScope, adapter: Adapter, database: Database, idle: IdleScheduler,
      debugHandler: DebugHandler, override readonly manifest: Manifest,
      override readonly manifestHash: string, protected registry: NodeRegistry,
      protected apiClient: ContentAPIClient, protected subtleCrypto: SubtleCrypto) {
    // Clear the Manifest's assetGroups and dataGroups before calling super to prevent the original
    // AssetGroup implementations from being instantiated. We'll populate this AppVersion with our
    // custom AssetGroup implementations immediately afterward.
    const assetFreeManifest: Manifest = {
      ...manifest,
      ...{
        assetGroups: [], dataGroups: []
      }
    };

    super(scope, adapter, database, idle, debugHandler, assetFreeManifest, manifestHash);

    // Initialize the hash function from manifest (default to sha256)
    this.hashFunction = manifest.hashFunction || 'sha256';

    const assetCacheNamePrefix = `${manifestHash}:assets`;
    const broadcaster = new Broadcaster(scope);
    this.assetGroups = ((manifest.assetGroups || []).map(config => {
      if (config.installMode !== 'lazy') {
        this.debugHandler.log(`AssetGroup.installMode="${
            config.installMode}" is not supported, using "lazy" installMode.`);
      }
      return new ArmadaLazyAssetGroup(
          adapter, idle, config, this.hashTable, database, assetCacheNamePrefix, registry,
          apiClient, broadcaster, subtleCrypto);
    }));

    // DataGroups are not supported.
    this.dataGroups = [];
  }

  /**
   * Get the hash function being used by this version
   */
  getHashFunction(): string {
    return this.hashFunction;
  }

  /**
   * Validates content using the configured hash function
   */
  async validateContentHash(content: ArrayBuffer, expectedHash: string): Promise<boolean> {
    try {
      if (this.hashFunction === 'ipfs-cid-v1') {
        const actualCid = await computeCIDv1(content, this.subtleCrypto);
        return actualCid === expectedHash;
      } else {
        // Default to SHA validation
        return sha1Binary(content) === expectedHash;
      }
    } catch (error) {
      this.debugHandler.log(`Error validating content: ${error}`);
      return false;
    }
  }

  override handleFetch(req: Request, event: ExtendableEvent): Promise<Response|null> {
    // Special case for handling index files that aren't requested directly, but rather should be
    // served because their directory is being requested.
    //
    // For example, if /blog/ or /blog is requested and there exists a /blog/index.html, we want to
    // serve that index file instead of the root index.html (which is the default behavior whenever
    // there's a navigation request for a file that doesn't exist in the hash table).
    if (this.isNavigationRequest(req)) {
      const url = this.adapter.normalizeUrl(req.url);
      const indexUrl = url + (url.endsWith('/') ? '' : '/') + 'index.html';
      if (this.hashTable.has(indexUrl as NormalizedUrl)) {
        return super.handleFetch(this.adapter.newRequest(indexUrl), event);
      }
    }

    return super.handleFetch(req, event);
  }
}
