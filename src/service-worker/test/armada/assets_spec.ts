import {webcrypto} from 'crypto';

import {Adapter} from '../../src/adapter';
import {ArmadaLazyAssetGroup} from '../../src/armada/assets';
import {SwContentNodesFetchFailureError, SwNoArmadaNodes} from '../../src/armada/error';
import {Database} from '../../src/database';
import {CacheDatabase} from '../../src/db-cache';
import {SwCriticalError} from '../../src/error';
import {IdleScheduler} from '../../src/idle';
import {AssetGroupConfig} from '../../src/manifest';
import {MsgAny} from '../../src/msg';
import {sha1} from '../../src/sha1';
import {MockRequest, MockResponse} from '../../testing/armada/fetch';
import {StaticNodeRegistry} from '../../testing/armada/registry';
import {SwTestHarnessBuilder} from '../../testing/armada/scope';
import {sha256} from '../../testing/armada/sha256';
import {MockFetchEvent} from '../../testing/events';

class OrderedAPIClient {
  public count: number;
  public seenHosts: Set<string>;
  private requestTimes: Map<string, number>;

  constructor(
    public responses: (Response|null)[],
    public delays: { [host: string]: number } = {}
  ) {
    this.count = 0;
    this.seenHosts = new Set<string>();
    this.requestTimes = new Map();
  }

  async getContent(_resource: string, host: string, _retry?: string, _useCache?: boolean): Promise<Response> {
    this.seenHosts.add(host);
    const startTime = Date.now();
    this.requestTimes.set(host, startTime);

    // Simulate network delay if specified for this host
    if (this.delays[host]) {
      await new Promise(resolve => setTimeout(resolve, this.delays[host]));
    }

    this.count++;
    if (this.count > this.responses.length) {
      return new MockResponse(null, {status: 500, statusText: `too many requests (${this.count})`});
    }

    const resp = this.responses[this.count - 1];
    if (resp === null) {
      return new MockResponse(null, {status: 504, statusText: 'simulating unreachable node'});
    }
    return resp;
  }

  getTimeBetweenRequests(host1: string, host2: string): number | undefined {
    const time1 = this.requestTimes.get(host1);
    const time2 = this.requestTimes.get(host2);
    if (time1 && time2) {
      return time2 - time1;
    }
    return undefined;
  }
}

class FakeBroadcaster {
  public messages: MsgAny[] = [];

  async postMessage(message: MsgAny): Promise<void> {
    this.messages.push(message);
  }
}

function isSuperset(set: Set<string>, subset: Set<string>): boolean {
  for (const elem of subset) {
    if (!set.has(elem)) {
      return false;
    }
  }
  return true;
}

describe('ArmadaLazyAssetGroup', () => {
  let adapter: Adapter;
  let idle: IdleScheduler;
  let config: AssetGroupConfig;
  let hashes: Map<string, string>;
  let db: Database;
  let broadcaster: FakeBroadcaster;

  const helloWorld = '/hello-world.txt';
  const helloWorldBody = 'Hello, world!';

  beforeEach(() => {
    adapter = new SwTestHarnessBuilder().build();
    idle = new IdleScheduler(adapter, 1000, 1000, console);
    config = {
      name: 'test',
      installMode: 'lazy',
      updateMode: 'lazy',
      urls: [helloWorld],
      patterns: [],
    };
    hashes = new Map<string, string>([[helloWorld, sha256(helloWorldBody)]]);
    db = new CacheDatabase(adapter);
    broadcaster = new FakeBroadcaster();
  });

  describe('succeeds', () => {
    const cases = [
      {
        name: 'when no retries are needed',
        nodes: new Set(['content0']),
        request: helloWorld,
        responses: [
          new MockResponse(helloWorldBody),
        ],
        wantAttempts: 1,
        wantBody: helloWorldBody,
      },
      {
        name: 'when a retry is needed due to a content mismatch',
        nodes: new Set(['content0', 'content1']),
        request: helloWorld,
        responses: [
          new MockResponse('Goodbye, world!'),
          new MockResponse(helloWorldBody),
        ],
        wantAttempts: 2,
        wantBody: helloWorldBody,
      },
      {
        name: 'when a retry is needed due to an unreachable node',
        nodes: new Set(['content0', 'content1']),
        request: helloWorld,
        responses: [
          null,
          new MockResponse(helloWorldBody),
        ],
        wantAttempts: 2,
        wantBody: helloWorldBody,
      },
      {
        name: 'when a retry is needed due to a non-200 response',
        nodes: new Set(['content0', 'content1']),
        request: helloWorld,
        responses: [
          new MockResponse(null, {status: 500}),
          new MockResponse(helloWorldBody),
        ],
        wantAttempts: 2,
        wantBody: helloWorldBody,
      },
      {
        name: 'when multiple retries are needed',
        nodes: new Set(['content0', 'content1', 'content2', 'content3', 'content4']),
        request: helloWorld,
        responses: [
          null,
          null,
          null,
          null,
          new MockResponse(helloWorldBody),
        ],
        wantAttempts: 5,
        wantBody: helloWorldBody,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const apiClient = new OrderedAPIClient(tc.responses);
        const registry = new StaticNodeRegistry([...tc.nodes]);
        const group = new ArmadaLazyAssetGroup(
          adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
          webcrypto.subtle);
        await group.initializeFully();

        const req = new MockRequest(tc.request);
        const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
        const resp = await group.handleFetch(req, evt);
        expect(resp).toBeTruthy();

        const gotContent = await resp!.text();
        expect(gotContent).toEqual(tc.wantBody);

        expect(apiClient.count).toEqual(tc.wantAttempts);
        expect(apiClient.seenHosts.size).toEqual(tc.wantAttempts);
        expect(isSuperset(tc.nodes, apiClient.seenHosts)).toBeTrue();
      });
    }
  });

  describe('throws', () => {
    beforeEach(() => {
      config.urls.push('/foo.txt');
    });

    const cases = [
      {
        name: 'when the resource checksum is missing',
        nodes: new Set(['content0']),
        request: '/foo.txt',
        responses: [
          new MockResponse('this is foo'),
        ],
        wantError: SwContentNodesFetchFailureError,
      },
      {
        name: 'when there are no content nodes',
        nodes: new Set(),
        request: helloWorld,
        responses: [],
        wantError: SwNoArmadaNodes,
      },
      {
        name: 'when all nodes are unreachable',
        nodes: new Set(['content0', 'content1']),
        request: helloWorld,
        responses: [
          null,
          null,
        ],
        wantError: SwContentNodesFetchFailureError,
      },
      {
        name: 'when all nodes return unexpected content',
        nodes: new Set(['content0', 'content1']),
        request: helloWorld,
        responses: [
          new MockResponse('abc'),
          new MockResponse('def'),
        ],
        wantError: SwContentNodesFetchFailureError,
      },
      {
        name: 'when all nodes return non-200 responses',
        nodes: new Set(['content0', 'content1']),
        request: helloWorld,
        responses: [
          new MockResponse(null, {status: 502}),
          new MockResponse(null, {status: 404}),
        ],
        wantError: SwContentNodesFetchFailureError,
      },
    ];

    for (const tc of cases) {
      it(tc.name, async () => {
        const apiClient = new OrderedAPIClient(tc.responses);
        const registry = new StaticNodeRegistry([...tc.nodes]);
        const group = new ArmadaLazyAssetGroup(
          adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
          webcrypto.subtle);
        await group.initializeFully();

        const req = new MockRequest(tc.request);
        const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
        await expectAsync(group.handleFetch(req, evt)).toBeRejectedWithError(tc.wantError);
      });
    }
  });

  describe('broadcasts', () => {
    it('CONTENT_CHECKSUM_MISMATCH', async () => {
      const apiClient = new OrderedAPIClient([
        new MockResponse('mismatch'),
        new MockResponse('mismatch 2'),
        new MockResponse(helloWorldBody),
      ]);
      const registry = new StaticNodeRegistry(['content0', 'content1', 'content2']);
      const group = new ArmadaLazyAssetGroup(
          adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
          webcrypto.subtle);
      await group.initializeFully();

      const req = new MockRequest(helloWorld);
      const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
      const resp = await group.handleFetch(req, evt);
      expect(resp).toBeTruthy();

      const gotContent = await resp!.text();
      expect(gotContent).toEqual(helloWorldBody);

      expect(broadcaster.messages.length).toEqual(2);
      expect(broadcaster.messages).toEqual([
        jasmine.objectContaining({action: 'CONTENT_CHECKSUM_MISMATCH'}),
        jasmine.objectContaining({action: 'CONTENT_CHECKSUM_MISMATCH'}),
      ]);
    });

    it('CONTENT_NODES_FETCH_FAILURE', async () => {
      const apiClient = new OrderedAPIClient([
        null,
        new MockResponse(null, {status: 404}),
        new MockResponse(helloWorldBody),
      ]);
      const registry = new StaticNodeRegistry(['content0', 'content1', 'content2']);
      const group = new ArmadaLazyAssetGroup(
          adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
          webcrypto.subtle);
      await group.initializeFully();

      const req = new MockRequest(helloWorld);
      const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
      const resp = await group.handleFetch(req, evt);
      expect(resp).toBeTruthy();

      const gotContent = await resp!.text();
      expect(gotContent).toEqual(helloWorldBody);

      expect(broadcaster.messages.length).toEqual(2);
      expect(broadcaster.messages).toEqual([
        jasmine.objectContaining({action: 'CONTENT_NODE_FETCH_FAILURE'}),
        jasmine.objectContaining({action: 'CONTENT_NODE_FETCH_FAILURE'}),
      ]);
    });
  });

  it('supports SHA-1 checksums (only for backward compatibility)', async () => {
    hashes.set(helloWorld, sha1(helloWorldBody));

    const apiClient = new OrderedAPIClient([new MockResponse(helloWorldBody)]);
    const registry = new StaticNodeRegistry(['content0']);
    const group = new ArmadaLazyAssetGroup(
        adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
        webcrypto.subtle);
    await group.initializeFully();

    const req = new MockRequest(helloWorld);
    const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
    const resp = await group.handleFetch(req, evt);
    expect(resp).toBeTruthy();

    const gotContent = await resp!.text();
    expect(gotContent).toEqual(helloWorldBody);
  });

  it('returns Response objects with no "url" property', async () => {
    const apiClient = new OrderedAPIClient([new MockResponse(helloWorldBody)]);
    const registry = new StaticNodeRegistry(['content0']);
    const group = new ArmadaLazyAssetGroup(
        adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
        webcrypto.subtle);
    await group.initializeFully();

    const req = new MockRequest(helloWorld);
    const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
    const resp = await group.handleFetch(req, evt);
    expect(resp).toBeTruthy();
    expect(resp!.url).toEqual('');
  });

  describe('timeout behavior', () => {
    it('should try second node when first node takes longer than TIMEOUT_MS', async () => {
      const delays = {
        'content0': ArmadaLazyAssetGroup.TIMEOUT_MS * 2,
        'content1': 50
      };
      
      const apiClient = new OrderedAPIClient(
        [
          new MockResponse('wrong content'),
          new MockResponse(helloWorldBody)
        ],
        delays
      );
      
      const registry = new StaticNodeRegistry(['content0', 'content1']);
      const group = new ArmadaLazyAssetGroup(
        adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
        webcrypto.subtle
      );
      await group.initializeFully();

      const req = new MockRequest(helloWorld);
      const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
      const resp = await group.handleFetch(req, evt);
      
      expect(resp).toBeTruthy();
      const gotContent = await resp!.text();
      expect(gotContent).toEqual(helloWorldBody);

      const timeBetweenRequests = apiClient.getTimeBetweenRequests('content0', 'content1');
      expect(timeBetweenRequests).toBeDefined();
      expect(timeBetweenRequests).toBeGreaterThanOrEqual(ArmadaLazyAssetGroup.TIMEOUT_MS);
      expect(timeBetweenRequests).toBeLessThan(ArmadaLazyAssetGroup.TIMEOUT_MS + 100);

      expect(apiClient.seenHosts.size).toBe(2);
      expect([...apiClient.seenHosts]).toEqual(['content0', 'content1']);
    });

    it('should fail with SwContentNodesFetchFailureError when all nodes fail with timeouts', async () => {
      const nodes = ['content0', 'content1', 'content2'];
      const delays = {
        'content0': ArmadaLazyAssetGroup.TIMEOUT_MS * 2,
        'content1': ArmadaLazyAssetGroup.TIMEOUT_MS * 2,
        'content2': ArmadaLazyAssetGroup.TIMEOUT_MS * 2
      };
      
      const apiClient = new OrderedAPIClient(
        [
          new MockResponse(null, {status: 504}),
          new MockResponse(null, {status: 504}),
          new MockResponse(null, {status: 504})
        ],
        delays
      );
      
      const registry = new StaticNodeRegistry(nodes);
      const group = new ArmadaLazyAssetGroup(
        adapter, idle, config, hashes, db, 'test', registry, apiClient, broadcaster,
        webcrypto.subtle
      );
      await group.initializeFully();

      const req = new MockRequest(helloWorld);
      const evt = new MockFetchEvent(req, 'some-client-id', 'some-client-id');
      
      await expectAsync(group.handleFetch(req, evt))
        .toBeRejectedWithError(
          SwContentNodesFetchFailureError,
          `Failed to fetch content: resource=${helloWorld} attempts=${nodes.length}`
        );

      const time1to2 = apiClient.getTimeBetweenRequests('content0', 'content1');
      const time2to3 = apiClient.getTimeBetweenRequests('content1', 'content2');
      
      expect(time1to2).toBeGreaterThanOrEqual(ArmadaLazyAssetGroup.TIMEOUT_MS);
      expect(time2to3).toBeGreaterThanOrEqual(ArmadaLazyAssetGroup.TIMEOUT_MS);

      expect(apiClient.seenHosts.size).toBe(3);
      expect([...apiClient.seenHosts]).toEqual(nodes);

      expect(broadcaster.messages.length).toBe(3);
      expect(broadcaster.messages).toEqual([
        jasmine.objectContaining({action: 'CONTENT_NODE_FETCH_FAILURE'}),
        jasmine.objectContaining({action: 'CONTENT_NODE_FETCH_FAILURE'}),
        jasmine.objectContaining({action: 'CONTENT_NODE_FETCH_FAILURE'})
      ]);
    });
  });
});