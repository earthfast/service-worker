/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {computeCidV1} from '../src/armada/cid';
import {PrefetchAssetGroup} from '../src/assets';
import {CacheDatabase} from '../src/db-cache';
import {IdleScheduler} from '../src/idle';
import {Manifest} from '../src/manifest';
import {MockCache} from '../testing/cache';
import {MockExtendableEvent} from '../testing/events';
import {MockRequest} from '../testing/fetch';
import {MockFileSystem, MockFileSystemBuilder, MockServerStateBuilder, tmpHashTable} from '../testing/mock';
import {SwTestHarnessBuilder} from '../testing/scope';
import {envIsSupported} from '../testing/utils';

// Helper function to create a CID-based hash table
async function cidHashTable(fs: MockFileSystem): Promise<{[url: string]: string}> {
  const table: {[url: string]: string} = {};

  for (const path of fs.list()) {
    const file = fs.lookup(path);
    if (file && file.hashThisFile) {
      const encoder = new TextEncoder();
      const buffer = encoder.encode(file.contents).buffer;
      table[path] = await computeCidV1(buffer);
    }
  }

  return table;
}

// Helper to create a manifest with CID hashes
async function cidManifestSingleAssetGroup(fs: MockFileSystem): Promise<Manifest> {
  const files = fs.list();
  const hashTable = await cidHashTable(fs);

  return {
    configVersion: 1,
    timestamp: 1234567890123,
    index: '/index.html',
    assetGroups: [
      {
        name: 'group',
        installMode: 'prefetch',
        updateMode: 'prefetch',
        urls: files,
        patterns: [],
        cacheQueryOptions: {ignoreVary: true}
      },
    ],
    navigationUrls: [],
    navigationRequestStrategy: 'performance',
    hashTable,
  };
}

// Helper to create a Map from the hash table
function mapFromHashTable(hashTable: {[url: string]: string}): Map<string, string> {
  const map = new Map<string, string>();
  Object.keys(hashTable).forEach(url => {
    map.set(url, hashTable[url]);
  });
  return map;
}

(function() {
// Skip environments that don't support the minimum APIs needed to run the SW tests.
if (!envIsSupported()) {
  return;
}

const dist = new MockFileSystemBuilder()
                 .addFile('/foo.txt', 'this is foo', {Vary: 'Accept'})
                 .addFile('/bar.txt', 'this is bar')
                 .build();

let manifest: Manifest;
let hashMap: Map<string, string>;

describe('prefetch assets', () => {
  let group: PrefetchAssetGroup;
  let idle: IdleScheduler;
  let server: any;
  let scope: any;
  let db: CacheDatabase;
  let testEvent: MockExtendableEvent;

  // Setup the manifest with CID hashes before tests
  beforeAll(async () => {
    manifest = await cidManifestSingleAssetGroup(dist);
    hashMap = mapFromHashTable(manifest.hashTable);

    server = new MockServerStateBuilder().withStaticFiles(dist).withManifest(manifest).build();
    scope = new SwTestHarnessBuilder().withServerState(server).build();
    db = new CacheDatabase(scope);
    testEvent = new MockExtendableEvent('test');
  });

  beforeEach(() => {
    server.reset();
    idle = new IdleScheduler(null!, 3000, 30000, {
      log: (v, ctx = '') => console.error(v, ctx),
    });
    group =
        new PrefetchAssetGroup(scope, scope, idle, manifest.assetGroups![0], hashMap, db, 'test');
  });

  it('initializes without crashing', async () => {
    await group.initializeFully();
  });

  it('fully caches the two files', async () => {
    await group.initializeFully();
    scope.updateServerState();
    const res1 = await group.handleFetch(scope.newRequest('/foo.txt'), testEvent);
    const res2 = await group.handleFetch(scope.newRequest('/bar.txt'), testEvent);
    expect(await res1!.text()).toEqual('this is foo');
    expect(await res2!.text()).toEqual('this is bar');
  });

  it('persists the cache across restarts', async () => {
    await group.initializeFully();
    const freshScope =
        new SwTestHarnessBuilder().withCacheState(scope.caches.original.dehydrate()).build();
    group = new PrefetchAssetGroup(
        freshScope, freshScope, idle, manifest.assetGroups![0], hashMap,
        new CacheDatabase(freshScope), 'test');
    await group.initializeFully();
    const res1 = await group.handleFetch(scope.newRequest('/foo.txt'), testEvent);
    const res2 = await group.handleFetch(scope.newRequest('/bar.txt'), testEvent);
    expect(await res1!.text()).toEqual('this is foo');
    expect(await res2!.text()).toEqual('this is bar');
  });

  it('caches properly if resources are requested before initialization', async () => {
    const res1 = await group.handleFetch(scope.newRequest('/foo.txt'), testEvent);
    const res2 = await group.handleFetch(scope.newRequest('/bar.txt'), testEvent);
    expect(await res1!.text()).toEqual('this is foo');
    expect(await res2!.text()).toEqual('this is bar');
    scope.updateServerState();
    await group.initializeFully();
  });

  it('throws if the server-side content does not match the manifest hash', async () => {
    const badHashFs = dist.extend().addFile('/foo.txt', 'corrupted file').build();
    const badServer =
        new MockServerStateBuilder().withManifest(manifest).withStaticFiles(badHashFs).build();
    const badScope = new SwTestHarnessBuilder().withServerState(badServer).build();
    group = new PrefetchAssetGroup(
        badScope, badScope, idle, manifest.assetGroups![0], hashMap, new CacheDatabase(badScope),
        'test');
    const err = await errorFrom(group.initializeFully());
    expect(err.message).toContain('CID mismatch');  // Updated error message expectation
  });

  it('CacheQueryOptions are passed through', async () => {
    await group.initializeFully();
    const matchSpy = spyOn(MockCache.prototype, 'match').and.callThrough();
    await group.handleFetch(scope.newRequest('/foo.txt'), testEvent);
    expect(matchSpy).toHaveBeenCalledWith(new MockRequest('/foo.txt'), {ignoreVary: true});
  });
});
})();

function errorFrom(promise: Promise<any>): Promise<any> {
  return promise.catch(err => err);
}
