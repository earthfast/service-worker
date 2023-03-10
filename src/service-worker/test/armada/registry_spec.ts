import {NodesResponse} from '../../src/armada/api';
import {NodeRegistryImpl} from '../../src/armada/registry';

class StaticAPIClient {
  public count: number;

  constructor(public nodes: string[]|null) {
    this.count = 0;
  };

  async getContentNodes(host: string): Promise<NodesResponse> {
    this.count++;
    if (this.nodes === null) {
      throw new Error('no nodes to return');
    }
    return {hosts: this.nodes};
  }
}

class MultiHostStaticAPIClient {
  public clients: {[key: string]: StaticAPIClient} = {};

  constructor(public data: {[key: string]: string[]}) {
    for (const host in data) {
      this.clients[host] = new StaticAPIClient(data[host]);
    }
  }

  async getContentNodes(host: string): Promise<NodesResponse> {
    const client = this.clients[host];
    if (!client) {
      throw new Error(`Unknown host: ${host}`);
    }
    return client.getContentNodes(host);
  }
}

describe('NodeRegistryImpl', () => {
  describe('populates content nodes', () => {
    it('when allNodes() is called', async () => {
      const nodes = ['content0', 'content1'];
      const apiClient = new StaticAPIClient(nodes);
      const registry = new NodeRegistryImpl(apiClient, ['topology'], 10000);

      expect(await registry.allNodes(false)).toEqual(nodes);
    });

    describe('when there is consensus amongst', () => {
      const cases: {
        name: string,
        topologyData: {[key: string]: string[]},
        want: string[],
      }[] =
          [
            {
              name: '1 bootstrap node',
              topologyData: {
                topology0: ['content0', 'content1', 'content2'],
              },
              want: ['content0', 'content1', 'content2'],
            },
            {
              name: '2 bootstrap nodes',
              topologyData: {
                topology0: ['content0', 'content1', 'content2'],
                topology1: ['content0', 'content1', 'content2'],
              },
              want: ['content0', 'content1', 'content2'],
            },
            {
              name: '>50% but <100% of the bootstrap nodes',
              topologyData: {
                topology0: ['content0', 'content1', 'content2', 'content3'],
                topology1: ['content2', 'content3', 'content4'],
                topology2: ['content0', 'content1', 'content2', 'content3'],
                topology3: ['content0', 'content1', 'content2', 'content3'],
                topology4: ['content2', 'content3', 'content4'],
              },
              want: ['content0', 'content1', 'content2', 'content3'],
            },
            {
              name: '100% of the bootstrap nodes',
              topologyData: {
                topology0: ['content0', 'content1'],
                topology1: ['content0', 'content1'],
                topology2: ['content0', 'content1'],
                topology3: ['content0', 'content1'],
              },
              want: ['content0', 'content1'],
            },
          ];

      for (let tc of cases) {
        it(tc.name, async () => {
          const apiClient = new MultiHostStaticAPIClient(tc.topologyData);
          const registry = new NodeRegistryImpl(apiClient, Object.keys(tc.topologyData), 10000);
          expect(await registry.allNodes(false)).toEqual(tc.want);
        });
      }
    });
  });

  describe('fails to populate content nodes', () => {
    const cases: {
      name: string,
      topologyData: {[key: string]: string[]},
    }[] =
        [
          {
            name: 'when there are only 2 bootstrap nodes and they disagree',
            topologyData: {
              topology0: ['content0', 'content1', 'content2'],
              topology1: ['content0', 'content1'],
            },
          },
          {
            name: 'when there is 0% agreement amongst >2 bootstrap nodes',
            topologyData: {
              topology0: ['content0', 'content1', 'content2'],
              topology1: ['content3', 'content4'],
              topology2: ['content2', 'content3', 'content4'],
              topology3: ['content2'],
            },
          },
          {
            name: 'when there is exactly 50% agreement amongst bootstrap nodes',
            topologyData: {
              topology0: ['content0', 'content1', 'content2', 'content3'],
              topology1: ['content2', 'content3', 'content4'],
              topology2: ['content0', 'content1', 'content2', 'content3'],
              topology3: ['content2', 'content3', 'content4'],
            },
          },
        ];

    for (let tc of cases) {
      it(tc.name, async () => {
        const apiClient = new MultiHostStaticAPIClient(tc.topologyData);
        const registry = new NodeRegistryImpl(apiClient, Object.keys(tc.topologyData), 10000);
        await expectAsync(registry.allNodes(false)).toBeRejected();
      });
    }
  });

  describe('content node cache', () => {
    let apiClient: StaticAPIClient;
    let registry: NodeRegistryImpl;
    const nodes = ['content0', 'content1'];

    beforeEach(async () => {
      apiClient = new StaticAPIClient(nodes);
      registry = new NodeRegistryImpl(apiClient, ['topology'], 10000);
    });

    it('will hit once populated', async () => {
      await registry.allNodes(false);
      expect(apiClient.count).toEqual(1);
      await registry.allNodes(false);
      await registry.allNodes(false);
      expect(apiClient.count).toEqual(1);
    });

    it('will ignore failed refreshes', async () => {
      expect(await registry.allNodes(false)).toEqual(nodes);
      expect(apiClient.count).toEqual(1);

      // Break the apiClient so the next fetch will fail.
      apiClient.nodes = null;

      await expectAsync(registry['refresh']()).toBeRejectedWithError();
      expect(apiClient.count).toEqual(2);
      expect(await registry.allNodes(false)).toEqual(nodes);
    });
  });

  it('only allows a single node refresh to be in flight at a time', async () => {
    let fetchCount = 0;

    let waitResolver: (value: void|PromiseLike<void>) => void;
    const wait: Promise<void> = new Promise((resolve) => {
      waitResolver = resolve;
    });

    const waitingAPIClient = {
      getContentNodes: async(_host: string): Promise<NodesResponse> => {
        fetchCount++;
        await wait;
        return {hosts: ['content0', 'content1']};
      },
    };
    const registry = new NodeRegistryImpl(waitingAPIClient, ['topology0'], 10000);

    const fetch1 = registry.allNodes(false);
    const fetch2 = registry.allNodes(false);
    waitResolver!();
    const got1 = await fetch1;
    const got2 = await fetch2;

    expect(fetchCount).toEqual(1);
    expect(got1).toEqual(['content0', 'content1']);
    expect(got1).toEqual(got2);
  });

  it('randomizes the returned nodes when specified', async () => {
    const nodesArr = [...Array(20).keys()].map(i => `content${i}`);
    const nodesSet = new Set(nodesArr);
    const apiClient = new StaticAPIClient(nodesArr);
    const registry = new NodeRegistryImpl(apiClient, ['topology'], 10000);

    let foundShuffled = false;
    for (let i = 0; i < 100 && !foundShuffled; i++) {
      const got = await registry.allNodes(true);
      expect(got.length).toEqual(nodesArr.length);
      expect(new Set(got)).toEqual(nodesSet);
      if (!arraysMatch(got, nodesArr)) {
        foundShuffled = true;
      }
    }
    expect(foundShuffled).toBeTrue();
  });
});

function arraysMatch<T>(a: T[], b: T[]): boolean {
  if (a.length != b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] != b[i]) {
      return false;
    }
  }
  return true;
}