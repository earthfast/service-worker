/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/// <reference lib="webworker" />

// mocks the Fetch API
import 'isomorphic-fetch';

import {webcrypto} from 'crypto';

import {ArmadaAPIClientImpl} from '../../src/armada/api';
import {ArmadaDriver, ArmadaDriver as Driver} from '../../src/armada/driver';
import {DynamicNodeRegistry} from '../../src/armada/registry';
import {CacheDatabase} from '../../src/db-cache';
import {DriverReadyState} from '../../src/driver';
import {Manifest} from '../../src/manifest';
import {sha1} from '../../src/sha1';
import {cidHashTableForFs, MockFileSystem, MockFileSystemBuilder, MockServerStateBuilder, tmpHashTableForFs} from '../../testing/armada/mock';
import {SwTestHarness, SwTestHarnessBuilder} from '../../testing/armada/scope';
import {MockCache} from '../../testing/cache';
import {MockWindowClient} from '../../testing/clients';
import {MockRequest, MockResponse} from '../../testing/fetch';
import {envIsSupported, processNavigationUrls, TEST_BOOTSTRAP_NODE, TEST_BOOTSTRAP_NODES, TEST_CONTENT_NODES, TEST_CONTENT_NODES_PORTS, TEST_PROJECT_ID} from '../../testing/utils';

(function() {
// Skip environments that don't support the minimum APIs needed to run the SW tests.
if (!envIsSupported()) {
  return;
}

const dist = new MockFileSystemBuilder()
                 .addFile('/foo.txt', 'this is foo')
                 .addFile('/bar.txt', 'this is bar')
                 .addFile('/baz.txt', 'this is baz')
                 .addFile('/qux.txt', 'this is qux')
                 .addFile('/quux.txt', 'this is quux')
                 .addFile('/quuux.txt', 'this is quuux')
                 .addFile('/lazy/unchanged1.txt', 'this is unchanged (1)')
                 .addFile('/lazy/unchanged2.txt', 'this is unchanged (2)')
                 .build();

const distUpdate = new MockFileSystemBuilder()
                       .addFile('/foo.txt', 'this is foo v2')
                       .addFile('/bar.txt', 'this is bar')
                       .addFile('/baz.txt', 'this is baz v2')
                       .addFile('/qux.txt', 'this is qux v2')
                       .addFile('/quux.txt', 'this is quux v2')
                       .addFile('/quuux.txt', 'this is quuux v2')
                       .addFile('/lazy/unchanged1.txt', 'this is unchanged (1)')
                       .addFile('/lazy/unchanged2.txt', 'this is unchanged (2)')
                       .build();

const distAltPortBuilder = new MockFileSystemBuilder().addFile(
    '/foos.txt', 'this is foos', {}, TEST_CONTENT_NODES_PORTS[1]);

TEST_CONTENT_NODES_PORTS.forEach(
    port => distAltPortBuilder.addFile(
        '/foos.txt', 'this is foos', {}, TEST_CONTENT_NODES_PORTS[1],
        `&retry=localhost%3A${port}`));

const distAltPort = distAltPortBuilder.build();

const brokenFs = new MockFileSystemBuilder()
                     .addFile('/foo.txt', 'this is foo (broken)', {}, undefined, '', true)
                     .addFile('/bar.txt', 'this is bar (broken)', {}, undefined, '', true)
                     .build();

// Setup function to create manifests with CID hash tables
async function createManifest(
    fs: MockFileSystem, config: Partial<Manifest> = {}): Promise<Manifest> {
  const hashTable = await cidHashTableForFs(fs);

  // Create the manifest
  return {
    configVersion: 1,
    timestamp: Date.now(),
    index: '/index.html',
    assetGroups: [],
    navigationUrls: [],
    navigationRequestStrategy: 'performance',
    hashTable,
    ...config
  };
}

let brokenManifest: Manifest;
let brokenLazyManifest: Manifest;
let manifest: Manifest;
let manifestUpdate: Manifest;
let altPortManifest: Manifest;

let server: MockServerState;
let serverRollback: MockServerState;
let serverUpdate: MockServerState;
let brokenServer: MockServerState;
let brokenLazyServer: MockServerState;
let server404: MockServerState;

let manifestHash: string;
let manifestUpdateHash: string;

describe('Driver', () => {
  let scope: SwTestHarness;
  let driver: Driver;

  // Setup manifests and servers before tests
  beforeAll(async () => {
    // Create all the manifests with CID hash tables
    brokenManifest = await createManifest(brokenFs, {
      assetGroups: [{
        name: 'assets',
        installMode: 'prefetch',
        updateMode: 'prefetch',
        urls: ['/foo.txt'],
        patterns: [],
        cacheQueryOptions: {ignoreVary: true},
      }]
    });

    brokenLazyManifest = await createManifest(brokenFs, {
      assetGroups: [
        {
          name: 'assets',
          installMode: 'prefetch',
          updateMode: 'prefetch',
          urls: ['/foo.txt'],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
        {
          name: 'lazy-assets',
          installMode: 'lazy',
          updateMode: 'lazy',
          urls: ['/bar.txt'],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
      ]
    });

    manifest = await createManifest(dist, {
      appData: {
        version: 'original',
      },
      assetGroups: [
        {
          name: 'assets',
          installMode: 'prefetch',
          updateMode: 'prefetch',
          urls: [
            '/foo.txt',
            '/bar.txt',
            '/redirected.txt',
            '/foos.txt',
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
        {
          name: 'other',
          installMode: 'lazy',
          updateMode: 'lazy',
          urls: [
            '/baz.txt',
            '/qux.txt',
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
        {
          name: 'lazy_prefetch',
          installMode: 'lazy',
          updateMode: 'prefetch',
          urls: [
            '/quux.txt',
            '/quuux.txt',
            '/lazy/unchanged1.txt',
            '/lazy/unchanged2.txt',
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        }
      ]
    });

    manifestUpdate = await createManifest(distUpdate, {
      appData: {
        version: 'update',
      },
      assetGroups: [
        {
          name: 'assets',
          installMode: 'prefetch',
          updateMode: 'prefetch',
          urls: [
            '/foo.txt',
            '/bar.txt',
            '/redirected.txt',
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
        {
          name: 'other',
          installMode: 'lazy',
          updateMode: 'lazy',
          urls: [
            '/baz.txt',
            '/qux.txt',
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
        {
          name: 'lazy_prefetch',
          installMode: 'lazy',
          updateMode: 'prefetch',
          urls: [
            '/quux.txt',
            '/quuux.txt',
            '/lazy/unchanged1.txt',
            '/lazy/unchanged2.txt',
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        }
      ],
      navigationUrls: processNavigationUrls(
          '',
          [
            '/**/file1',
            '/**/file2',
            '!/ignored/file1',
            '!/ignored/dir/**',
          ])
    });

    altPortManifest = {...manifest};
    altPortManifest.hashTable = await cidHashTableForFs(distAltPort);
    if (altPortManifest.assetGroups) {
      altPortManifest.assetGroups.forEach(assetGroup => assetGroup.urls.push('/foos.txt'));
    }

    // Create server states
    const serverBuilderBase =
        new MockServerStateBuilder()
            .withStaticFiles(dist)
            .withRedirect('/redirected.txt', '/redirect-target.txt', 'this was a redirect')
            .withError('/error.txt');

    server = serverBuilderBase.withManifest(manifest).build();
    serverRollback =
        serverBuilderBase.withManifest({...manifest, timestamp: manifest.timestamp + 1}).build();
    serverUpdate =
        new MockServerStateBuilder()
            .withStaticFiles(distUpdate)
            .withManifest(manifestUpdate)
            .withRedirect('/redirected.txt', '/redirect-target.txt', 'this was a redirect')
            .build();
    brokenServer =
        new MockServerStateBuilder().withStaticFiles(brokenFs).withManifest(brokenManifest).build();
    brokenLazyServer = new MockServerStateBuilder()
                           .withStaticFiles(brokenFs)
                           .withManifest(brokenLazyManifest)
                           .build();
    server404 = new MockServerStateBuilder().withStaticFiles(dist).build();

    manifestHash = sha1(JSON.stringify(manifest));
    manifestUpdateHash = sha1(JSON.stringify(manifestUpdate));
  });

  beforeEach(() => {
    server.reset();
    serverUpdate.reset();
    server404.reset();
    brokenServer.reset();

    scope = new SwTestHarnessBuilder().withServerState(server).build();
    const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
    const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
    driver =
        new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);
  });

  it('activates without waiting', async () => {
    const skippedWaiting = await scope.startup(true);
    expect(skippedWaiting).toBe(true);
  });

  it('claims all clients, after activation', async () => {
    const claimSpy = spyOn(scope.clients, 'claim');

    await scope.startup(true);
    expect(claimSpy).toHaveBeenCalledTimes(1);
  });

  it('cleans up old `@angular/service-worker` caches, after activation', async () => {
    const claimSpy = spyOn(scope.clients, 'claim');
    const cleanupOldSwCachesSpy = spyOn(driver, 'cleanupOldSwCaches');

    // Automatically advance time to trigger idle tasks as they are added.
    scope.autoAdvanceTime = true;
    await scope.startup(true);
    await scope.resolveSelfMessages();
    scope.autoAdvanceTime = false;

    expect(cleanupOldSwCachesSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy).toHaveBeenCalledBefore(cleanupOldSwCachesSpy);
  });

  it('does not blow up if cleaning up old `@angular/service-worker` caches fails', async () => {
    spyOn(driver, 'cleanupOldSwCaches').and.callFake(() => Promise.reject('Ooops'));

    // Automatically advance time to trigger idle tasks as they are added.
    scope.autoAdvanceTime = true;
    await scope.startup(true);
    await scope.resolveSelfMessages();
    scope.autoAdvanceTime = false;

    server.clearRequests();

    expect(driver.state).toBe(DriverReadyState.NORMAL);
    expect(await makeRequest(scope, '/foo.txt')).toBe('this is foo');
    server.assertSawRequestFor('/foo.txt');
    server.assertNoOtherRequests();
  });

  it('initializes prefetched content correctly, after activation', async () => {
    // Automatically advance time to trigger idle tasks as they are added.
    scope.autoAdvanceTime = true;
    await scope.startup(true);
    await scope.resolveSelfMessages();
    scope.autoAdvanceTime = false;

    server.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    expect(await makeRequest(scope, '/bar.txt')).toEqual('this is bar');
    server.assertSawRequestFor('/foo.txt');
    server.assertSawRequestFor('/bar.txt');
    server.assertSawRequestFor('/v1/nodes');
    server.assertNoOtherRequests();
  });

  it('initializes prefetched content correctly, after a request kicks it off', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    server.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    expect(await makeRequest(scope, '/bar.txt')).toEqual('this is bar');
    server.assertSawRequestFor('/foo.txt');
    server.assertSawRequestFor('/bar.txt');
    server.assertSawRequestFor('/v1/nodes');
    server.assertNoOtherRequests();
  });

  it('initializes the service worker on fetch if it has not yet been initialized', async () => {
    // Driver is initially uninitialized.
    expect(driver.initialized).toBeNull();
    expect(driver['latestHash']).toBeNull();

    // Making a request initializes the driver (fetches assets).
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    expect(driver['latestHash']).toEqual(jasmine.any(String));
    server.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);

    // Once initialized, cached resources are served without network requests.
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    expect(await makeRequest(scope, '/bar.txt')).toEqual('this is bar');
    server.assertSawRequestFor('/foo.txt');
    server.assertSawRequestFor('/bar.txt');
    server.assertSawRequestFor('/v1/nodes');
    server.assertNoOtherRequests();
  });

  it('initializes the service worker on message if it has not yet been initialized', async () => {
    // Driver is initially uninitialized.
    expect(driver.initialized).toBeNull();
    expect(driver['latestHash']).toBeNull();

    // Pushing a message initializes the driver (fetches assets).
    scope.handleMessage({action: 'foo'}, 'someClient');
    await new Promise(resolve => setTimeout(resolve));  // Wait for async operations to complete.
    expect(driver['latestHash']).toEqual(jasmine.any(String));
    server.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);

    // Once initialized, pushed messages are handled without re-initializing.
    await scope.handleMessage({action: 'bar'}, 'someClient');
    server.assertSawRequestFor('/v1/nodes');
    server.assertNoOtherRequests();

    // Once initialized, cached resources are served without network requests.
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    expect(await makeRequest(scope, '/bar.txt')).toEqual('this is bar');
    server.assertSawRequestFor('/foo.txt');
    server.assertSawRequestFor('/bar.txt');
    server.assertNoOtherRequests();
  });

  it('handles non-relative URLs', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    server.clearRequests();
    expect(await makeRequest(scope, 'http://localhost/foo.txt')).toEqual('this is foo');
    server.assertNoOtherRequests();
  });

  it('handles actual errors from the browser', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    server.clearRequests();

    const [resPromise, done] = scope.handleFetch(new MockRequest('/error.txt'), 'default');
    await done;
    const res = (await resPromise)!;
    // Armada:
    // This was changed to 404 Not Found
    // expect(res.status).toEqual(504);
    // expect(res.statusText).toEqual('Gateway Timeout');
    expect(res.status).toEqual(404);
    expect(res.statusText).toEqual('Not Found');
  });

  it('caches lazy content on-request', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    server.clearRequests();
    expect(await makeRequest(scope, '/baz.txt')).toEqual('this is baz');
    server.assertSawRequestFor('/baz.txt');
    server.assertNoOtherRequests();
    expect(await makeRequest(scope, '/baz.txt')).toEqual('this is baz');
    server.assertNoOtherRequests();
    expect(await makeRequest(scope, '/qux.txt')).toEqual('this is qux');
    server.assertSawRequestFor('/qux.txt');
    server.assertNoOtherRequests();
  });

  it('updates to new content when requested', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;

    const client = scope.clients.getMock('default')!;
    expect(client.messages).toEqual([{type: 'INITIALIZED'}]);

    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toEqual(true);
    serverUpdate.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);
    serverUpdate.assertSawRequestFor('/foo.txt');
    serverUpdate.assertNoOtherRequests();

    expect(client.messages).toEqual([
      {type: 'INITIALIZED'},
      {
        type: 'VERSION_DETECTED',
        version: {hash: manifestUpdateHash, appData: {version: 'update'}},
      },
      {
        type: 'VERSION_READY',
        currentVersion: {hash: manifestHash, appData: {version: 'original'}},
        latestVersion: {hash: manifestUpdateHash, appData: {version: 'update'}},
      },
    ]);

    // Default client is still on the old version of the app.
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

    // Sending a new client id should result in the updated version being returned.
    expect(await makeRequest(scope, '/foo.txt', 'new')).toEqual('this is foo v2');

    // Of course, the old version should still work.
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

    expect(await makeRequest(scope, '/bar.txt')).toEqual('this is bar');
  });

  it('detects new version even if only `manifest.timestamp` is different', async () => {
    expect(await makeRequest(scope, '/foo.txt', 'newClient')).toEqual('this is foo');
    await driver.initialized;

    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toEqual(true);
    expect(await makeRequest(scope, '/foo.txt', 'newerClient')).toEqual('this is foo v2');

    scope.updateServerState(serverRollback);
    expect(await driver.checkForUpdate()).toEqual(true);
    expect(await makeRequest(scope, '/foo.txt', 'newestClient')).toEqual('this is foo');
  });

  it('updates a specific client to new content on request', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;

    const client = scope.clients.getMock('default')!;
    expect(client.messages).toEqual([{type: 'INITIALIZED'}]);

    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toEqual(true);
    serverUpdate.clearRequests();
    await driver.updateClient(client as any as Client);

    expect(client.messages).toEqual([
      {type: 'INITIALIZED'},
      {type: 'VERSION_DETECTED', version: {hash: manifestUpdateHash, appData: {version: 'update'}}},
      {
        type: 'VERSION_READY',
        currentVersion: {hash: manifestHash, appData: {version: 'original'}},
        latestVersion: {hash: manifestUpdateHash, appData: {version: 'update'}},
      },
      {
        type: 'UPDATE_ACTIVATED',
        previous: {hash: manifestHash, appData: {version: 'original'}},
        current: {hash: manifestUpdateHash, appData: {version: 'update'}},
      }
    ]);

    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo v2');
  });

  it('handles empty client ID', async () => {
    // Initialize the SW.
    expect(await makeNavigationRequest(scope, '/foo/file1', '')).toEqual('this is foo');
    await driver.initialized;

    // Update to a new version.
    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toEqual(true);

    // Correctly handle navigation requests, even if `clientId` is null/empty.
    expect(await makeNavigationRequest(scope, '/foo/file1', '')).toEqual('this is foo v2');
  });

  it('checks for updates on restart', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;

    scope = new SwTestHarnessBuilder()
                .withCacheState(scope.caches.original.dehydrate())
                .withServerState(serverUpdate)
                .build();
    const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
    const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
    driver =
        new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    serverUpdate.assertNoOtherRequests();

    scope.advance(12000);
    await driver.idle.empty;

    serverUpdate.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);
    serverUpdate.assertSawRequestFor('/v1/nodes');
    serverUpdate.assertSawRequestFor('/foo.txt');
    serverUpdate.assertNoOtherRequests();
  });

  it('checks for updates on navigation', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    server.clearRequests();

    expect(await makeNavigationRequest(scope, '/foo.txt')).toEqual('this is foo');

    scope.advance(12000);
    await driver.idle.empty;

    server.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);
  });

  it('does not make concurrent checks for updates on navigation', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    server.clearRequests();

    expect(await makeNavigationRequest(scope, '/foo.txt')).toEqual('this is foo');

    expect(await makeNavigationRequest(scope, '/foo.txt')).toEqual('this is foo');

    scope.advance(12000);
    await driver.idle.empty;

    server.assertSawNodeRequestFor(ArmadaDriver.MANIFEST_FILENAME);
    server.assertNoOtherRequests();
  });

  it('preserves multiple client assignments across restarts', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;

    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toEqual(true);
    expect(await makeRequest(scope, '/foo.txt', 'new')).toEqual('this is foo v2');
    serverUpdate.clearRequests();

    scope = new SwTestHarnessBuilder()
                .withCacheState(scope.caches.original.dehydrate())
                .withServerState(serverUpdate)
                .build();
    const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
    const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
    driver =
        new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    expect(await makeRequest(scope, '/foo.txt', 'new')).toEqual('this is foo v2');
    serverUpdate.assertNoOtherRequests();
  });

  it('updates when refreshed', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;

    const client = scope.clients.getMock('default')!;

    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toEqual(true);
    serverUpdate.clearRequests();

    // Make a real navigation request that explicitly updates the client
    await driver.updateClient(client as any as Client);

    // Then check the result
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo v2');

    // Check messages have the update sequence
    expect(client.messages.length).toBeGreaterThanOrEqual(3);
    expect(client.messages).toContain(jasmine.objectContaining({type: 'UPDATE_ACTIVATED'}));
  });

  it('cleans up properly when manually requested', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;

    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toEqual(true);
    serverUpdate.clearRequests();

    expect(await makeRequest(scope, '/foo.txt', 'new')).toEqual('this is foo v2');

    // Delete the default client.
    scope.clients.remove('default');

    // After this, the old version should no longer be cached.
    await driver.cleanupCaches();
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo v2');

    serverUpdate.assertNoOtherRequests();
  });

  it('cleans up properly on restart', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;

    scope = new SwTestHarnessBuilder()
                .withCacheState(scope.caches.original.dehydrate())
                .withServerState(serverUpdate)
                .build();
    const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
    const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
    driver =
        new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    serverUpdate.assertNoOtherRequests();

    let keys = await scope.caches.keys();
    let hasOriginalCaches = keys.some(name => name.startsWith(`${manifestHash}:`));
    expect(hasOriginalCaches).toEqual(true);

    scope.clients.remove('default');

    scope.advance(12000);
    await driver.idle.empty;
    serverUpdate.clearRequests();

    driver =
        new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo v2');

    keys = await scope.caches.keys();
    hasOriginalCaches = keys.some(name => name.startsWith(`${manifestHash}:`));
    expect(hasOriginalCaches).toEqual(false);
  });

  it('cleans up properly when failing to load stored state', async () => {
    // Initialize the SW and cache the original app-version.
    expect(await makeRequest(scope, '/foo.txt')).toBe('this is foo');
    await driver.initialized;

    // Update and cache the updated app-version.
    scope.updateServerState(serverUpdate);
    expect(await driver.checkForUpdate()).toBeTrue();
    expect(await makeRequest(scope, '/foo.txt', 'newClient')).toBe('this is foo v2');

    // Verify both app-versions are stored in the cache.
    let cacheNames = await scope.caches.keys();
    let hasOriginalVersion = cacheNames.some(name => name.startsWith(`${manifestHash}:`));
    let hasUpdatedVersion = cacheNames.some(name => name.startsWith(`${manifestUpdateHash}:`));
    expect(hasOriginalVersion).withContext('Has caches for original version').toBeTrue();
    expect(hasUpdatedVersion).withContext('Has caches for updated version').toBeTrue();

    // Simulate failing to load the stored state (and thus starting from an empty state).
    scope.caches.delete('db:control');
    const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
    const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
    driver =
        new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

    expect(await makeRequest(scope, '/foo.txt')).toBe('this is foo v2');
    await driver.initialized;

    // Verify that the caches for the obsolete original version are cleaned up.
    // await driver.cleanupCaches();
    scope.advance(6000);
    await driver.idle.empty;

    cacheNames = await scope.caches.keys();
    hasOriginalVersion = cacheNames.some(name => name.startsWith(`${manifestHash}:`));
    hasUpdatedVersion = cacheNames.some(name => name.startsWith(`${manifestUpdateHash}:`));
    expect(hasOriginalVersion).withContext('Has caches for original version').toBeFalse();
    expect(hasUpdatedVersion).withContext('Has caches for updated version').toBeTrue();
  });

  it('shows notifications for push notifications', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    await scope.handlePush({
      notification: {
        title: 'This is a test',
        body: 'Test body',
      }
    });
    expect(scope.notifications).toEqual([{
      title: 'This is a test',
      options: {title: 'This is a test', body: 'Test body'},
    }]);
    expect(scope.clients.getMock('default')!.messages[1]).toEqual({
      type: 'PUSH',
      data: {
        notification: {
          title: 'This is a test',
          body: 'Test body',
        },
      },
    });
  });

  describe('notification click events', () => {
    it('broadcasts notification click events with action', async () => {
      expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
      await driver.initialized;
      await scope.handleClick(
          {title: 'This is a test with action', body: 'Test body with action'}, 'button');
      const message = scope.clients.getMock('default')!.messages[1];

      expect(message.type).toEqual('NOTIFICATION_CLICK');
      expect(message.data.action).toEqual('button');
      expect(message.data.notification.title).toEqual('This is a test with action');
      expect(message.data.notification.body).toEqual('Test body with action');
    });

    it('broadcasts notification click events without action', async () => {
      expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
      await driver.initialized;
      await scope.handleClick({
        title: 'This is a test without action',
        body: 'Test body without action',
      });
      const message = scope.clients.getMock('default')!.messages[1];

      expect(message.type).toEqual('NOTIFICATION_CLICK');
      expect(message.data.action).toBe('');
      expect(message.data.notification.title).toEqual('This is a test without action');
      expect(message.data.notification.body).toEqual('Test body without action');
    });

    describe('Client interactions', () => {
      describe('`openWindow` operation', () => {
        it('opens a new client window at url', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

          spyOn(scope.clients, 'openWindow');
          const url = 'foo';

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with url',
                body: 'Test body with url',
                data: {
                  onActionClick: {
                    foo: {operation: 'openWindow', url},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow)
              .toHaveBeenCalledWith(`${scope.registration.scope}${url}`);
        });

        it('opens a new client window with `/` when no `url`', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

          spyOn(scope.clients, 'openWindow');

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test without url',
                body: 'Test body without url',
                data: {
                  onActionClick: {
                    foo: {operation: 'openWindow'},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow).toHaveBeenCalledWith(`${scope.registration.scope}`);
        });
      });

      describe('`focusLastFocusedOrOpen` operation', () => {
        it('focuses last client keeping previous url', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

          scope.clients.add('fooBar', 'http://localhost/unique', 'window');
          const mockClient = scope.clients.getMock('fooBar') as MockWindowClient;
          const url = 'foo';

          expect(mockClient.url).toBe('http://localhost/unique');
          expect(mockClient.focused).toBeFalse();

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with operation focusLastFocusedOrOpen',
                body: 'Test body with operation focusLastFocusedOrOpen',
                data: {
                  onActionClick: {
                    foo: {operation: 'focusLastFocusedOrOpen', url},
                  },
                },
              },
              'foo');
          expect(mockClient.url).toBe('http://localhost/unique');
          expect(mockClient.focused).toBeTrue();
        });

        it('falls back to openWindow at url when no last client to focus', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
          spyOn(scope.clients, 'openWindow');
          spyOn(scope.clients, 'matchAll').and.returnValue(Promise.resolve([]));
          const url = 'foo';

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with operation focusLastFocusedOrOpen',
                body: 'Test body with operation focusLastFocusedOrOpen',
                data: {
                  onActionClick: {
                    foo: {operation: 'focusLastFocusedOrOpen', url},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow)
              .toHaveBeenCalledWith(`${scope.registration.scope}${url}`);
        });

        it('falls back to openWindow at `/` when no last client and no `url`', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
          spyOn(scope.clients, 'openWindow');
          spyOn(scope.clients, 'matchAll').and.returnValue(Promise.resolve([]));

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with operation focusLastFocusedOrOpen',
                body: 'Test body with operation focusLastFocusedOrOpen',
                data: {
                  onActionClick: {
                    foo: {operation: 'focusLastFocusedOrOpen'},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow).toHaveBeenCalledWith(`${scope.registration.scope}`);
        });
      });

      describe('`navigateLastFocusedOrOpen` operation', () => {
        it('navigates last client to `url`', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toBe('this is foo');

          scope.clients.add('fooBar', 'http://localhost/unique', 'window');
          const mockClient = scope.clients.getMock('fooBar') as MockWindowClient;
          const url = 'foo';

          expect(mockClient.url).toBe('http://localhost/unique');
          expect(mockClient.focused).toBeFalse();

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with operation navigateLastFocusedOrOpen',
                body: 'Test body with operation navigateLastFocusedOrOpen',
                data: {
                  onActionClick: {
                    foo: {operation: 'navigateLastFocusedOrOpen', url},
                  },
                },
              },
              'foo');
          expect(mockClient.url).toBe(`${scope.registration.scope}${url}`);
          expect(mockClient.focused).toBeTrue();
        });

        it('navigates last client to `/` if no `url`', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toBe('this is foo');

          scope.clients.add('fooBar', 'http://localhost/unique', 'window');
          const mockClient = scope.clients.getMock('fooBar') as MockWindowClient;

          expect(mockClient.url).toBe('http://localhost/unique');
          expect(mockClient.focused).toBeFalse();

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with operation navigateLastFocusedOrOpen',
                body: 'Test body with operation navigateLastFocusedOrOpen',
                data: {
                  onActionClick: {
                    foo: {operation: 'navigateLastFocusedOrOpen'},
                  },
                },
              },
              'foo');
          expect(mockClient.url).toBe(scope.registration.scope);
          expect(mockClient.focused).toBeTrue();
        });

        it('falls back to openWindow at url when no last client to focus', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
          spyOn(scope.clients, 'openWindow');
          spyOn(scope.clients, 'matchAll').and.returnValue(Promise.resolve([]));
          const url = 'foo';

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with operation navigateLastFocusedOrOpen',
                body: 'Test body with operation navigateLastFocusedOrOpen',
                data: {
                  onActionClick: {
                    foo: {operation: 'navigateLastFocusedOrOpen', url},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow)
              .toHaveBeenCalledWith(`${scope.registration.scope}${url}`);
        });

        it('falls back to openWindow at `/` when no last client and no `url`', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
          spyOn(scope.clients, 'openWindow');
          spyOn(scope.clients, 'matchAll').and.returnValue(Promise.resolve([]));

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with operation navigateLastFocusedOrOpen',
                body: 'Test body with operation navigateLastFocusedOrOpen',
                data: {
                  onActionClick: {
                    foo: {operation: 'navigateLastFocusedOrOpen'},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow).toHaveBeenCalledWith(`${scope.registration.scope}`);
        });
      });

      describe('No matching onActionClick field', () => {
        it('no client interaction', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
          spyOn(scope.clients, 'openWindow');

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test without onActionClick field',
                body: 'Test body without onActionClick field',
                data: {
                  onActionClick: {
                    fooz: {operation: 'focusLastFocusedOrOpen', url: 'fooz'},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow).not.toHaveBeenCalled();
        });
      });

      describe('no action', () => {
        it('uses onActionClick default when no specific action is clicked', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
          spyOn(scope.clients, 'openWindow');
          const url = 'fooz';

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test without action',
                body: 'Test body without action',
                data: {
                  onActionClick: {
                    default: {operation: 'openWindow', url},
                  },
                },
              },
              '');
          expect(scope.clients.openWindow)
              .toHaveBeenCalledWith(`${scope.registration.scope}${url}`);
        });

        describe('no onActionClick default', () => {
          it('has no client interaction', async () => {
            expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
            spyOn(scope.clients, 'openWindow');

            await driver.initialized;
            await scope.handleClick(
                {title: 'This is a test without action', body: 'Test body without action'});
            expect(scope.clients.openWindow).not.toHaveBeenCalled();
          });
        });
      });

      describe('no onActionClick field', () => {
        it('has no client interaction', async () => {
          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
          spyOn(scope.clients, 'openWindow');

          await driver.initialized;
          await scope.handleClick(
              {title: 'This is a test without action', body: 'Test body without action', data: {}});
          await scope.handleClick(
              {title: 'This is a test with an action', body: 'Test body with an action', data: {}},
              'someAction');
          expect(scope.clients.openWindow).not.toHaveBeenCalled();
        });
      });

      describe('URL resolution', () => {
        it('should resolve relative to service worker scope', async () => {
          (scope.registration.scope as string) = 'http://localhost/foo/bar/';

          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

          spyOn(scope.clients, 'openWindow');

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with a relative url',
                body: 'Test body with a relative url',
                data: {
                  onActionClick: {
                    foo: {operation: 'openWindow', url: 'baz/qux'},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow).toHaveBeenCalledWith('http://localhost/foo/bar/baz/qux');
        });

        it('should resolve with an absolute path', async () => {
          (scope.registration.scope as string) = 'http://localhost/foo/bar/';

          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

          spyOn(scope.clients, 'openWindow');

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with an absolute path url',
                body: 'Test body with an absolute path url',
                data: {
                  onActionClick: {
                    foo: {operation: 'openWindow', url: '/baz/qux'},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow).toHaveBeenCalledWith('http://localhost/baz/qux');
        });

        it('should resolve other origins', async () => {
          (scope.registration.scope as string) = 'http://localhost/foo/bar/';

          expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');

          spyOn(scope.clients, 'openWindow');

          await driver.initialized;
          await scope.handleClick(
              {
                title: 'This is a test with external origin',
                body: 'Test body with external origin',
                data: {
                  onActionClick: {
                    foo: {operation: 'openWindow', url: 'http://other.host/baz/qux'},
                  },
                },
              },
              'foo');
          expect(scope.clients.openWindow).toHaveBeenCalledWith('http://other.host/baz/qux');
        });
      });
    });
  });

  it('does not unregister or change state when offline (i.e. manifest 504s)', async () => {
    expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
    await driver.initialized;
    server.online = false;

    expect(await driver.checkForUpdate()).toEqual(false);
    expect(driver.state).toEqual(DriverReadyState.NORMAL);
    expect(scope.unregistered).toBeFalsy();
    expect(await scope.caches.keys()).not.toEqual([]);
  });

  it('does not unregister or change state when status code is 503 (service unavailable)',
     async () => {
       expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
       await driver.initialized;
       spyOn(server, 'fetch').and.callFake(async (req: Request) => new MockResponse(null, {
                                             status: 503,
                                             statusText: 'Service Unavailable'
                                           }));

       expect(await driver.checkForUpdate()).toEqual(false);
       expect(driver.state).toEqual(DriverReadyState.NORMAL);
       expect(scope.unregistered).toBeFalsy();
       expect(await scope.caches.keys()).not.toEqual([]);
     });

  describe('serving ngsw/state', () => {
    it('should show debug info (when in NORMAL state)', async () => {
      expect(await makeRequest(scope, '/ngsw/state'))
          .toMatch(/^NGSW Debug Info:\n\nDriver version: .+\nDriver state: NORMAL/);
    });

    it('should show debug info when the scope is not root', async () => {
      const newScope =
          new SwTestHarnessBuilder('http://localhost/foo/bar/').withServerState(server).build();
      const apiClient = new ArmadaAPIClientImpl(newScope, newScope, 'http:', TEST_PROJECT_ID);
      const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
      new Driver(
          newScope, newScope, new CacheDatabase(newScope), registry, apiClient, webcrypto.subtle);

      expect(await makeRequest(newScope, '/foo/bar/ngsw/state'))
          .toMatch(/^NGSW Debug Info:\n\nDriver version: .+\nDriver state: NORMAL/);
    });
  });

  describe('cache naming', () => {
    let uid: number;

    // Helpers
    const cacheKeysFor = (baseHref: string, manifestHash: string) =>
        [`ngsw:${baseHref}:db:control`,
         `ngsw:${baseHref}:${manifestHash}:assets:eager:cache`,
         `ngsw:${baseHref}:db:${manifestHash}:assets:eager:meta`,
         `ngsw:${baseHref}:${manifestHash}:assets:lazy:cache`,
         `ngsw:${baseHref}:db:${manifestHash}:assets:lazy:meta`,
    ];

    const createManifestWithBaseHref = (baseHref: string, distDir: MockFileSystem): Manifest => ({
      configVersion: 1,
      timestamp: 1234567890123,
      index: `${baseHref}foo.txt`,
      assetGroups: [
        {
          name: 'eager',
          installMode: 'prefetch',
          updateMode: 'prefetch',
          urls: [
            `${baseHref}foo.txt`,
            `${baseHref}bar.txt`,
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
        {
          name: 'lazy',
          installMode: 'lazy',
          updateMode: 'lazy',
          urls: [
            `${baseHref}baz.txt`,
            `${baseHref}qux.txt`,
          ],
          patterns: [],
          cacheQueryOptions: {ignoreVary: true},
        },
      ],
      dataGroups: [],
      navigationUrls: processNavigationUrls(baseHref),
      navigationRequestStrategy: 'performance',
      hashTable: tmpHashTableForFs(distDir, {}, baseHref),
    });

    const getClientAssignments = async (sw: SwTestHarness, baseHref: string) => {
      const cache =
          await sw.caches.original.open(`ngsw:${baseHref}:db:control`) as unknown as MockCache;
      const dehydrated = cache.dehydrate();
      return JSON.parse(dehydrated['/assignments'].body!) as any;
    };

    const initializeSwFor = async (baseHref: string, initialCacheState = '{}') => {
      const newDistDir = dist.extend().addFile('/foo.txt', `this is foo v${++uid}`).build();
      const newManifest = createManifestWithBaseHref(baseHref, newDistDir);
      const newManifestHash = sha1(JSON.stringify(newManifest));

      const serverState = new MockServerStateBuilder()
                              .withRootDirectory(baseHref)
                              .withStaticFiles(newDistDir)
                              .withManifest(newManifest)
                              .build();

      const newScope = new SwTestHarnessBuilder(`http://localhost${baseHref}`)
                           .withCacheState(initialCacheState)
                           .withServerState(serverState)
                           .build();
      const apiClient = new ArmadaAPIClientImpl(newScope, newScope, 'http:', TEST_PROJECT_ID);
      const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
      const newDriver = new Driver(
          newScope, newScope, new CacheDatabase(newScope), registry, apiClient, webcrypto.subtle);

      await makeRequest(newScope, newManifest.index, baseHref.replace(/\//g, '_'));
      await newDriver.initialized;

      return [newScope, newManifestHash] as [SwTestHarness, string];
    };

    beforeEach(() => {
      uid = 0;
    });

    it('includes the SW scope in all cache names', async () => {
      // SW with scope `/`.
      const [rootScope, rootManifestHash] = await initializeSwFor('/');
      const cacheNames = await rootScope.caches.original.keys();

      expect(cacheNames).toEqual(cacheKeysFor('/', rootManifestHash));
      expect(cacheNames.every(name => name.includes('/'))).toBe(true);

      // SW with scope `/foo/`.
      const [fooScope, fooManifestHash] = await initializeSwFor('/foo/');
      const fooCacheNames = await fooScope.caches.original.keys();

      expect(fooCacheNames).toEqual(cacheKeysFor('/foo/', fooManifestHash));
      expect(fooCacheNames.every(name => name.includes('/foo/'))).toBe(true);
    });

    it('does not affect caches from other scopes', async () => {
      // Create SW with scope `/foo/`.
      const [fooScope, fooManifestHash] = await initializeSwFor('/foo/');
      const fooAssignments = await getClientAssignments(fooScope, '/foo/');

      expect(fooAssignments).toEqual({_foo_: fooManifestHash});

      // Add new SW with different scope.
      const [barScope, barManifestHash] =
          await initializeSwFor('/bar/', await fooScope.caches.original.dehydrate());
      const barCacheNames = await barScope.caches.original.keys();
      const barAssignments = await getClientAssignments(barScope, '/bar/');

      expect(barAssignments).toEqual({_bar_: barManifestHash});
      expect(barCacheNames).toEqual([
        ...cacheKeysFor('/foo/', fooManifestHash),
        ...cacheKeysFor('/bar/', barManifestHash),
      ]);

      // The caches for `/foo/` should be intact.
      const fooAssignments2 = await getClientAssignments(barScope, '/foo/');
      expect(fooAssignments2).toEqual({_foo_: fooManifestHash});
    });
  });

  describe('routing', () => {
    const navRequest = (url: string, init = {}) =>
        makeNavigationRequest(scope, url, undefined, init);

    beforeEach(async () => {
      expect(await makeRequest(scope, '/foo.txt')).toEqual('this is foo');
      await driver.initialized;
      server.clearRequests();
    });

    it('redirects to index on a route-like request', async () => {
      expect(await navRequest('/baz')).toEqual('this is foo');
      server.assertNoOtherRequests();
    });

    it('redirects to index on a request to the scope URL', async () => {
      expect(await navRequest('http://localhost/')).toEqual('this is foo');
      server.assertNoOtherRequests();
    });
  });

  describe('cleanupOldSwCaches()', () => {
    it('should delete the correct caches', async () => {
      const oldSwCacheNames = [
        // Example cache names from the beta versions of `@angular/service-worker`.
        'ngsw:active',
        'ngsw:staged',
        'ngsw:manifest:a1b2c3:super:duper',
        // Example cache names from the beta versions of `@angular/service-worker`.
        'ngsw:a1b2c3:assets:foo',
        'ngsw:db:a1b2c3:assets:bar',
      ];
      const otherCacheNames = [
        'ngsuu:active',
        'not:ngsw:active',
        'NgSw:StAgEd',
        'ngsw:/:db:control',
        'ngsw:/foo/:active',
        'ngsw:/bar/:staged',
      ];
      const allCacheNames = oldSwCacheNames.concat(otherCacheNames);

      await Promise.all(allCacheNames.map(name => scope.caches.original.open(name)));
      expect(await scope.caches.original.keys())
          .toEqual(jasmine.arrayWithExactContents(allCacheNames));

      await driver.cleanupOldSwCaches();
      expect(await scope.caches.original.keys())
          .toEqual(jasmine.arrayWithExactContents(otherCacheNames));
    });

    it('should delete other caches even if deleting one of them fails', async () => {
      const oldSwCacheNames = ['ngsw:active', 'ngsw:staged', 'ngsw:manifest:a1b2c3:super:duper'];
      const deleteSpy =
          spyOn(scope.caches.original, 'delete')
              .and.callFake(
                  (cacheName: string) => Promise.reject(`Failed to delete cache '${cacheName}'.`));

      await Promise.all(oldSwCacheNames.map(name => scope.caches.original.open(name)));
      const error = await driver.cleanupOldSwCaches().catch(err => err);

      expect(error).toBe('Failed to delete cache \'ngsw:active\'.');
      expect(deleteSpy).toHaveBeenCalledTimes(3);
      oldSwCacheNames.forEach(name => expect(deleteSpy).toHaveBeenCalledWith(name));
    });
  });

  describe('bugs', () => {
    it('does not crash with bad index hash', async () => {
      scope = new SwTestHarnessBuilder().withServerState(brokenServer).build();
      (scope.registration as any).scope = 'http://site.com';
      const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
      const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
      driver =
          new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

      expect(await makeRequest(scope, '/foo.txt')).toEqual(null);
    });

    it('enters degraded mode when something goes wrong with the latest version', async () => {
      await driver.initialized;

      // Two clients on initial version.
      expect(await makeRequest(scope, '/foo.txt', 'client1')).toBe('this is foo');
      expect(await makeRequest(scope, '/foo.txt', 'client2')).toBe('this is foo');

      // Install a broken version (`bar.txt` has invalid hash).
      scope.updateServerState(brokenLazyServer);
      await driver.checkForUpdate();

      // Update `client1` but not `client2`.
      await makeNavigationRequest(scope, '/', 'client1');
      server.clearRequests();
      brokenLazyServer.clearRequests();

      expect(await makeRequest(scope, '/foo.txt', 'client1')).toBe('this is foo (broken)');
      expect(await makeRequest(scope, '/foo.txt', 'client2')).toBe('this is foo');
      server.assertNoOtherRequests();
      brokenLazyServer.assertNoOtherRequests();

      // Trying to fetch `bar.txt` (which has an invalid hash) should invalidate the latest
      // version, enter degraded mode and "forget" clients that are on that version (i.e.
      // `client1`).
      expect(await makeRequest(scope, '/bar.txt', 'client1')).toBe(null);
      brokenLazyServer.assertSawRequestFor('/bar.txt');
      brokenLazyServer.clearRequests();

      // `client1` should still be served from the latest (broken) version.
      expect(await makeRequest(scope, '/foo.txt', 'client1')).toBe('this is foo (broken)');
      brokenLazyServer.assertNoOtherRequests();

      // `client2` should still be served from the old version (since it never updated).
      expect(await makeRequest(scope, '/foo.txt', 'client2')).toBe('this is foo');
      server.assertNoOtherRequests();
      brokenLazyServer.assertNoOtherRequests();
    });

    it('enters does not enter degraded mode when something goes wrong with an older version',
       async () => {
         await driver.initialized;

         // Three clients on initial version.
         expect(await makeRequest(scope, '/foo.txt', 'client1')).toBe('this is foo');
         expect(await makeRequest(scope, '/foo.txt', 'client2')).toBe('this is foo');
         expect(await makeRequest(scope, '/foo.txt', 'client3')).toBe('this is foo');

         // Install a broken version (`bar.txt` has invalid hash).
         scope.updateServerState(brokenLazyServer);
         await driver.checkForUpdate();

         // Update `client1` and `client2` but not `client3`.
         await makeNavigationRequest(scope, '/', 'client1');
         await makeNavigationRequest(scope, '/', 'client2');
         server.clearRequests();
         brokenLazyServer.clearRequests();

         expect(await makeRequest(scope, '/foo.txt', 'client1')).toBe('this is foo (broken)');
         expect(await makeRequest(scope, '/foo.txt', 'client2')).toBe('this is foo (broken)');
         expect(await makeRequest(scope, '/foo.txt', 'client3')).toBe('this is foo');
         server.assertNoOtherRequests();
         brokenLazyServer.assertNoOtherRequests();

         // Install a newer, non-broken version.
         scope.updateServerState(serverUpdate);
         await driver.checkForUpdate();

         // Update `client1` bot not `client2` or `client3`.
         await makeNavigationRequest(scope, '/', 'client1');
         expect(await makeRequest(scope, '/foo.txt', 'client1')).toBe('this is foo v2');

         // Trying to fetch `bar.txt` (which has an invalid hash on the broken version) from
         // `client2` should invalidate that particular version (which is not the latest one).
         // (NOTE: Since the file is not cached locally, it is fetched from the server.)
         expect(await makeRequest(scope, '/bar.txt', 'client2')).toBe(null);
         expect(driver.state).toBe(DriverReadyState.NORMAL);
         serverUpdate.clearRequests();

         // Existing clients should still be served from their assigned versions.
         expect(await makeRequest(scope, '/foo.txt', 'client1')).toBe('this is foo v2');
         expect(await makeRequest(scope, '/foo.txt', 'client2')).toBe('this is foo (broken)');
         expect(await makeRequest(scope, '/foo.txt', 'client3')).toBe('this is foo');
         server.assertNoOtherRequests();
         brokenLazyServer.assertNoOtherRequests();
         serverUpdate.assertNoOtherRequests();

         // New clients should be served from the latest version.
         expect(await makeRequest(scope, '/foo.txt', 'client4')).toBe('this is foo v2');
         serverUpdate.assertNoOtherRequests();
       });

    it('should not enter degraded mode if manifest for latest hash is missing upon initialization',
       async () => {
         // Initialize the SW.
         scope.handleMessage({action: 'INITIALIZE'}, null);
         await driver.initialized;
         expect(driver.state).toBe(DriverReadyState.NORMAL);

         // Ensure the data has been stored in the DB.
         const db: MockCache = await scope.caches.open('db:control') as any;
         const getLatestHashFromDb = async () => (await (await db.match('/latest')).json()).latest;
         expect(await getLatestHashFromDb()).toBe(manifestHash);

         // Change the latest hash to not correspond to any manifest.
         await db.put('/latest', new MockResponse('{"latest": "wrong-hash"}'));
         expect(await getLatestHashFromDb()).toBe('wrong-hash');

         // Re-initialize the SW and ensure it does not enter a degraded mode.
         driver.initialized = null;
         scope.handleMessage({action: 'INITIALIZE'}, null);
         await driver.initialized;
         expect(driver.state).toBe(DriverReadyState.NORMAL);
         expect(await getLatestHashFromDb()).toBe(manifestHash);
       });

    it('ignores passive mixed content requests ', async () => {
      const scopeFetchSpy = spyOn(scope, 'fetch').and.callThrough();
      const getRequestUrls = () =>
          (scopeFetchSpy.calls.allArgs() as [Request][]).map(args => args[0].url);

      const httpScopeUrl = 'http://mock.origin.dev';
      const httpsScopeUrl = 'https://mock.origin.dev';
      const httpRequestUrl = 'http://other.origin.sh/unknown.png';
      const httpsRequestUrl = 'https://other.origin.sh/unknown.pnp';

      // Registration scope: `http:`
      (scope.registration.scope as string) = httpScopeUrl;

      await makeRequest(scope, httpRequestUrl);
      await makeRequest(scope, httpsRequestUrl);
      const requestUrls1 = getRequestUrls();

      expect(requestUrls1).toContain(httpRequestUrl);
      expect(requestUrls1).toContain(httpsRequestUrl);

      scopeFetchSpy.calls.reset();

      // Registration scope: `https:`
      (scope.registration.scope as string) = httpsScopeUrl;

      await makeRequest(scope, httpRequestUrl);
      await makeRequest(scope, httpsRequestUrl);
      const requestUrls2 = getRequestUrls();

      // Armada:
      // Is not ignoring the passive mixed content requests
      // expect(requestUrls2).not.toContain(httpRequestUrl);
      expect(requestUrls2).toContain(httpsRequestUrl);
    });

    it('does not enter degraded mode when offline while fetching an uncached asset', async () => {
      // Trigger SW initialization and wait for it to complete.
      expect(await makeRequest(scope, '/foo.txt')).toBe('this is foo');
      await driver.initialized;

      // Request an uncached asset while offline.
      // The SW will not be able to get the content, but it should not enter a degraded mode either.
      server.online = false;
      expect(await makeRequest(scope, '/baz.txt', 'client1')).toBe(null);
      expect(driver.state).toBe(DriverReadyState.NORMAL);

      // Once we are back online, everything should work as expected.
      server.online = true;
      expect(await makeRequest(scope, '/baz.txt')).toBe('this is baz');
      expect(driver.state).toBe(DriverReadyState.NORMAL);
    });

    describe('unrecoverable state', () => {
      const generateMockServerState = async (fileSystem: MockFileSystem) => {
        const manifest: Manifest = {
          configVersion: 1,
          timestamp: 1234567890123,
          index: '/index.html',
          assetGroups: [{
            name: 'assets',
            installMode: 'prefetch',
            updateMode: 'prefetch',
            urls: fileSystem.list(),
            patterns: [],
            cacheQueryOptions: {ignoreVary: true},
          }],
          dataGroups: [],
          navigationUrls: processNavigationUrls(''),
          navigationRequestStrategy: 'performance',
          hashTable: await cidHashTableForFs(fileSystem),
        };

        return {
          serverState: new MockServerStateBuilder()
                           .withManifest(manifest)
                           .withStaticFiles(fileSystem)
                           .build(),
          manifest,
        };
      };

      it('enters degraded mode', async () => {
        const originalFiles = new MockFileSystemBuilder()
                                  .addFile('/index.html', '<script src="foo.hash.js"></script>')
                                  .addFile('/foo.hash.js', 'console.log("FOO");')
                                  .build();

        const updatedFiles = new MockFileSystemBuilder()
                                 .addFile('/index.html', '<script src="bar.hash.js"></script>')
                                 .addFile('/bar.hash.js', 'console.log("BAR");')
                                 .build();

        const {serverState: originalServer, manifest} =
            await generateMockServerState(originalFiles);
        const {serverState: updatedServer} = await generateMockServerState(updatedFiles);

        // Create initial server state and initialize the SW.
        scope = new SwTestHarnessBuilder().withServerState(originalServer).build();
        let apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
        let registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
        driver = new Driver(
            scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

        expect(await makeRequest(scope, '/foo.hash.js')).toBe('console.log("FOO");');
        await driver.initialized;
        originalServer.clearRequests();

        // Verify that the `foo.hash.js` file is cached.
        expect(await makeRequest(scope, '/foo.hash.js')).toBe('console.log("FOO");');
        originalServer.assertNoRequestFor('/foo.hash.js');

        // Update the server state to emulate deploying a new version (where `foo.hash.js` does not
        // exist any more). Keep the cache though.
        scope = new SwTestHarnessBuilder()
                    .withCacheState(scope.caches.original.dehydrate())
                    .withServerState(updatedServer)
                    .build();
        apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
        registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
        driver = new Driver(
            scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

        // The SW is still able to serve `foo.hash.js` from the cache.
        expect(await makeRequest(scope, '/foo.hash.js')).toBe('console.log("FOO");');
        updatedServer.assertNoRequestFor('/foo.hash.js');

        // Remove `foo.hash.js` from the cache to emulate the browser evicting files from the cache.
        await removeAssetFromCache(scope, manifest, '/foo.hash.js');

        // Try to retrieve `foo.hash.js`, which is neither in the cache nor on the server.
        // This should put the SW in an unrecoverable state and notify clients.
        expect(await makeRequest(scope, '/foo.hash.js')).toBeNull();
        updatedServer.assertSawRequestFor('/foo.hash.js');
      });

      it('is handled correctly even if some of the clients no longer exist', async () => {
        const originalFiles = new MockFileSystemBuilder()
                                  .addFile('/index.html', '<script src="foo.hash.js"></script>')
                                  .addFile('/foo.hash.js', 'console.log("FOO");')
                                  .build();

        const updatedFiles = new MockFileSystemBuilder()
                                 .addFile('/index.html', '<script src="bar.hash.js"></script>')
                                 .addFile('/bar.hash.js', 'console.log("BAR");')
                                 .build();

        const {serverState: originalServer, manifest} =
            await generateMockServerState(originalFiles);
        const {serverState: updatedServer} = await generateMockServerState(updatedFiles);

        // Create initial server state and initialize the SW.
        scope = new SwTestHarnessBuilder().withServerState(originalServer).build();
        const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
        const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
        driver = new Driver(
            scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

        expect(await makeRequest(scope, '/foo.hash.js', 'client-1')).toBe('console.log("FOO");');
        expect(await makeRequest(scope, '/foo.hash.js', 'client-2')).toBe('console.log("FOO");');
        await driver.initialized;

        // Update the server state to emulate deploying a new version (where `foo.hash.js` does not
        // exist any more). Keep the cache though.
        scope = new SwTestHarnessBuilder()
                    .withCacheState(scope.caches.original.dehydrate())
                    .withServerState(updatedServer)
                    .build();
        driver = new Driver(
            scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

        // The SW is still able to serve `foo.hash.js` from the cache.
        expect(await makeRequest(scope, '/foo.hash.js', 'client-1')).toBe('console.log("FOO");');
        expect(await makeRequest(scope, '/foo.hash.js', 'client-2')).toBe('console.log("FOO");');

        // Remove `foo.hash.js` from the cache to emulate the browser evicting files from the cache.
        await removeAssetFromCache(scope, manifest, '/foo.hash.js');

        // Remove one of the clients to emulate closing a browser tab.
        scope.clients.remove('client-1');

        // Retrieve the remaining client to ensure it is notified.
        const mockClient2 = scope.clients.getMock('client-2')!;
        expect(mockClient2.messages).toEqual([]);
      });
    });
  });

  describe('navigationRequestStrategy', () => {
    it('doesn\'t create navigate request in performance mode', async () => {
      await makeRequest(scope, '/foo.txt');
      await driver.initialized;
      await server.clearRequests();

      // Create multiple navigation requests to prove no navigation request was made.
      // By default the navigation request is not sent, it's replaced
      // with the index request - thus, the `this is foo` value.
      expect(await makeNavigationRequest(scope, '/', '')).toBe('this is foo');
      expect(await makeNavigationRequest(scope, '/foo', '')).toBe('this is foo');
      expect(await makeNavigationRequest(scope, '/foo/bar', '')).toBe('this is foo');

      server.assertNoOtherRequests();
    });

    it('sends the request to the server in freshness mode', async () => {
      const {server, scope, driver} = createSwForFreshnessStrategy();

      await makeRequest(scope, '/foo.txt');
      await driver.initialized;
      await server.clearRequests();

      // Create multiple navigation requests to prove the navigation request is constantly made.
      // When enabled, the navigation request is made each time and not replaced
      // with the index request - thus, the `null` value.
      expect(await makeNavigationRequest(scope, '/', '')).toBe(null);
      expect(await makeNavigationRequest(scope, '/foo', '')).toBe(null);
      expect(await makeNavigationRequest(scope, '/foo/bar', '')).toBe(null);

      server.assertSawRequestFor('/');
      server.assertSawRequestFor('/foo');
      server.assertSawRequestFor('/foo/bar');
      server.assertNoOtherRequests();
    });

    function createSwForFreshnessStrategy() {
      const freshnessManifest: Manifest = {...manifest, navigationRequestStrategy: 'freshness'};
      const serverBuilder =
          new MockServerStateBuilder()
              .withStaticFiles(dist)
              .withRedirect('/redirected.txt', '/redirect-target.txt', 'this was a redirect')
              .withError('/error.txt');

      const server = serverBuilder.withManifest(freshnessManifest).build();
      const scope = new SwTestHarnessBuilder().withServerState(server).build();
      const apiClient = new ArmadaAPIClientImpl(scope, scope, 'http:', TEST_PROJECT_ID);
      const registry = new DynamicNodeRegistry(apiClient, [TEST_BOOTSTRAP_NODE], 10000);
      const driver =
          new Driver(scope, scope, new CacheDatabase(scope), registry, apiClient, webcrypto.subtle);

      return {server, scope, driver};
    }
  });
});
})();

async function makeRawRequest(
    scope: SwTestHarness, url: string, clientId = 'default', init?: Object): Promise<Response> {
  // Armada:
  // convert to a content url
  // url = (await scope.newContentUrl(url)).toString();
  const [resPromise, done] = scope.handleFetch(new MockRequest(url, init), clientId);
  await done;

  const resp = await resPromise;
  if (!resp) {
    throw new Error(`No response for request: ${url}`);
  }
  return resp;
}

async function makeRequest(
    scope: SwTestHarness, url: string, clientId = 'default', init?: Object): Promise<string|null> {
  const res = await makeRawRequest(scope, url, clientId, init);

  if (res !== undefined && res.ok) {
    return res.text();
  }
  return null;
}

function makeNavigationRequest(
    scope: SwTestHarness, url: string, clientId?: string, init: Object = {}): Promise<string|null> {
  const requestInit = {
    headers: {
      Accept: 'text/plain, text/html, text/css',
      ...(init as any).headers,
    },
    mode: 'navigate',
    ...init,
  };

  // Make sure we provide a proper URL format that will work with CID verification
  const normalizedUrl = url.startsWith('/') ? url : `/${url}`;
  return makeRequest(scope, normalizedUrl, clientId, requestInit);
}

async function removeAssetFromCache(
    scope: SwTestHarness, appVersionManifest: Manifest, assetPath: string) {
  const assetGroupName =
      appVersionManifest.assetGroups?.find(group => group.urls.includes(assetPath))?.name;
  const cacheName = `${sha1(JSON.stringify(appVersionManifest))}:assets:${assetGroupName}:cache`;
  const cache = await scope.caches.open(cacheName);
  return cache.delete(assetPath);
}
