import {Adapter} from '../adapter';
import {AppVersion} from '../app-version';
import {Database} from '../database';
import {DebugHandler} from '../debug';
import {IdleScheduler} from '../idle';
import {Manifest} from '../manifest';
import {MsgAny} from '../msg';

import {ContentAPIClient} from './api';
import {ArmadaLazyAssetGroup} from './assets';
import {NodeRegistry} from './registry';

class Broadcaster {
  constructor(private scope: ServiceWorkerGlobalScope) {}

  async postMessage(message: MsgAny): Promise<void> {
    const clients = await this.scope.clients.matchAll();
    clients.forEach(client => client.postMessage(message));
  }
}

export class ArmadaAppVersion extends AppVersion {
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
}