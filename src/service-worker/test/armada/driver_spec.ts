import {webcrypto} from 'crypto';

import {computeCidV1} from '../../src/armada/cid';
import {ArmadaDriver} from '../../src/armada/driver';
import {CacheDatabase} from '../../src/db-cache';
import {Manifest} from '../../src/manifest';
import {MockRequest, MockResponse} from '../../testing/armada/fetch';
import {StaticNodeRegistry} from '../../testing/armada/registry';
import {SwTestHarnessBuilder} from '../../testing/armada/scope';
import {MockFetchEvent} from '../../testing/events';

class SiteBundle {
  public resources: Map<string, string> = new Map();

  protected _manifest: Manifest;
  public get manifest(): Manifest {
    if (!this._manifest) {
      this.buildManifest();
    }
    return this._manifest;
  }
  public get manifestJSON(): string {
    return JSON.stringify(this.manifest);
  }

  constructor(public id: string) {}

  withResources(resources: {[url: string]: string}): SiteBundle {
    this.addResources(resources);
    return this;
  }

  addResources(resources: {[url: string]: string}): void {
    for (const url in resources) {
      this.resources.set(url.startsWith('/') ? url : '/' + url, resources[url]);
    }
    this.buildManifest();
  }

  public async buildManifest(): Promise<void> {
    const hashTable: {[url: string]: string} = {};
    for (const [url, body] of this.resources.entries()) {
      const encoder = new TextEncoder();
      const buffer = encoder.encode(body).buffer;
      hashTable[url] = await computeCidV1(buffer);
    }

    this._manifest = {
      configVersion: 1,
      timestamp: Date.now(),
      index: '/index.html',
      assetGroups: [
        {
          name: 'main',
          installMode: 'lazy',
          updateMode: 'lazy',
          cacheQueryOptions: {'ignoreVary': true},
          urls: [...this.resources.keys()],
          patterns: [],
        },
      ],
      navigationUrls: [
        {positive: true, regex: '^\\/.*$'},
        {positive: false, regex: '^\\/(?:.+\\/)?[^/]*\\.[^/]*$'},
        {positive: false, regex: '^\\/(?:.+\\/)?[^/]*__[^/]*$'},
        {positive: false, regex: '^\\/(?:.+\\/)?[^/]*__[^/]*\\/.*$'},
      ],
      navigationRequestStrategy: 'performance',
      hashTable: hashTable,
    };
  }
}

class FakeContentNode {
  public bundle: SiteBundle;

  constructor(public host: string) {}

  async getContent(resource: string, _host: string, _retry?: string): Promise<Response> {
    if (!this.bundle) {
      return new MockResponse(null, {status: 410});
    }
    if (resource == ArmadaDriver.MANIFEST_FILENAME) {
      return new MockResponse(this.bundle.manifestJSON);
    }

    const body = this.bundle.resources.get(resource);
    if (!body) {
      return new MockResponse(null, {status: 404});
    }
    return new MockResponse(body);
  }

  withBundle(bundle: SiteBundle): FakeContentNode {
    this.setBundle(bundle);
    return this;
  }

  setBundle(bundle: SiteBundle): void {
    this.bundle = bundle;
  }
}

class FakeAPIClient {
  public nodes: {[host: string]: FakeContentNode} = {};

  constructor(nodes: FakeContentNode[]) {
    nodes.forEach(n => {
      this.nodes[n.host] = n;
    });
  }

  async getContent(resource: string, host: string, retry?: string): Promise<Response> {
    const node = this.nodes[host];
    if (!node) {
      throw new Error(`Unknown host: ${host}`);
    }
    return node.getContent(resource, host, retry);
  }
}

function mockFetchEvent(url: string): MockFetchEvent {
  return new MockFetchEvent(new MockRequest(url), 'test-client-id', 'test-client-id');
}

describe('ArmadaDriver', () => {
  function init(contentNodes: FakeContentNode[]) {
    const scope = new SwTestHarnessBuilder().build();
    const db = new CacheDatabase(scope);
    const registry = new StaticNodeRegistry(contentNodes.map(n => n.host));
    const apiClient = new FakeAPIClient(contentNodes);
    const driver = new ArmadaDriver(scope, scope, db, registry, apiClient, webcrypto.subtle);
    return {scope, db, apiClient, registry, driver};
  }

  it('initializes successfully', async () => {
    const bundle = new SiteBundle('empty');
    const contentNodes = [new FakeContentNode('content0').withBundle(bundle)];
    const {driver} = init(contentNodes);

    await expectAsync(driver['initialize']()).toBeResolved();
  });

  it('fetches content', async () => {
    const bundle = new SiteBundle('hello-world').withResources({'/index.html': 'Hello, world!'});
    const contentNodes = [new FakeContentNode('content0').withBundle(bundle)];
    const {driver} = init(contentNodes);

    const got = await driver.handleFetch(mockFetchEvent('index.html'));
    expect(got.ok).toBeTrue();
    expect(await got.text()).toEqual('Hello, world!');
  });

  it('propagates status code from SwContentNodesFetchFailureError', async () => {
    const bundle = new SiteBundle('empty');
    const contentNodes = [new FakeContentNode('content0').withBundle(bundle)];
    const {driver} = init(contentNodes);

    const got = await driver.handleFetch(mockFetchEvent('index.html'));
    expect(got.status).toEqual(404);
  });

  it('schedules the node registry to periodically refresh itself', async () => {
    const bundle = new SiteBundle('empty');
    const contentNodes = [new FakeContentNode('content0').withBundle(bundle)];
    const {driver, registry} = init(contentNodes);

    const spy = spyOn(registry, 'refreshNodesInterval');
    await driver['initialize']();
    expect(spy).toHaveBeenCalled();
  });

  describe('checkForUpdate', () => {
    let contentNodes: FakeContentNode[];
    let driver: ArmadaDriver;

    const v1 = new SiteBundle('v1').withResources({'/index.html': 'v1'});
    const v2 = new SiteBundle('v2').withResources({'/index.html': 'v2'});

    beforeEach(async () => {
      contentNodes = [
        new FakeContentNode('content0').withBundle(v1),
        new FakeContentNode('content1').withBundle(v1),
        new FakeContentNode('content2').withBundle(v1),
        new FakeContentNode('content3').withBundle(v1),
        new FakeContentNode('content4').withBundle(v1),
      ];
      ({driver} = init(contentNodes));
      await driver['initialize']();
    });

    describe('returns false when the manifest HAS NOT changed', () => {
      it('on any content node', async () => {
        expect(await driver.checkForUpdate()).toBeFalse();
      });

      it('anywhere except the probed content node', async () => {
        contentNodes[0].setBundle(v2);
        expect(await driver.checkForUpdate()).toBeFalse();
      });

      it('on only the probed content node', async () => {
        contentNodes.slice(1).forEach(n => n.setBundle(v2));
        expect(await driver.checkForUpdate()).toBeFalse();
      });
    });

    describe('returns true when the manifest HAS changed', () => {
      it('on every content node', async () => {
        contentNodes.forEach(n => n.setBundle(v2));
        expect(await driver.checkForUpdate()).toBeTrue();
      });

      it('on the majority of content nodes, including the probed node', async () => {
        contentNodes.slice(0, -1).forEach(n => n.setBundle(v2));
        expect(await driver.checkForUpdate()).toBeTrue();
      });
    });

    it('retries failed probes', async () => {
      const downNodes = contentNodes.slice(0, 2);
      const upNodes = contentNodes.slice(2)
      downNodes.forEach(n => spyOn(n, 'getContent').and.throwError('node is down'));
      upNodes.forEach(n => spyOn(n, 'getContent').and.callThrough());

      await driver.checkForUpdate()

      downNodes.forEach(n => expect(n.getContent).toHaveBeenCalled());
      expect(upNodes[0].getContent).toHaveBeenCalled();
      upNodes.slice(1).forEach(n => expect(n.getContent).toHaveBeenCalledTimes(0));
    });
  });
});