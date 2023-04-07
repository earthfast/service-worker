import {NodesResponse, TopologyAPIClient} from './api';
import {Hashable, majorityResult} from './consensus';

export interface NodeRegistry {
  allNodes(randomize: boolean): Promise<string[]>;
  refreshNodesInterval(): void;
}

export class StaticNodeRegistry implements NodeRegistry {
  constructor(protected contentNodes: string[]) {}

  public async allNodes(randomize: boolean): Promise<string[]> {
    const nodes = this.contentNodes.slice();
    if (randomize) {
      shuffle(nodes);
    }
    return nodes;
  }

  public refreshNodesInterval() {}
}

export class DynamicNodeRegistry implements NodeRegistry {
  private contentNodes: string[] = [];
  private refreshPending: Promise<void>|null = null;
  private updateTimer: ReturnType<typeof setTimeout>|null = null;

  constructor(
      protected apiClient: TopologyAPIClient, protected bootstrapNodes: string[],
      protected refreshIntervalMs: number) {}

  public async allNodes(randomize: boolean): Promise<string[]> {
    if (this.contentNodes.length == 0) {
      await this.refresh();
    }
    const nodes = this.contentNodes.slice();
    if (randomize) {
      shuffle(nodes);
    }
    return nodes;
  }

  public refreshNodesInterval() {
    if (this.updateTimer !== null) {
      return;
    }
    this.updateTimer = setInterval(async () => await this.refresh(), this.refreshIntervalMs);
  }

  // Fetch the latest set of content nodes and cache the result (if successful). If an update is
  // already in progress, the Promise associated with the pending update will be returned.
  private async refresh(): Promise<void> {
    if (this.refreshPending !== null) {
      return this.refreshPending;
    }
    this.refreshPending = this._refresh();
    try {
      return await this.refreshPending;
    } finally {
      this.refreshPending = null;
    }
  }

  private async _refresh(): Promise<void> {
    if (this.bootstrapNodes.length == 0) {
      throw new Error('No bootstrap nodes');
    }

    const promises = this.bootstrapNodes.map(async (host) => {
      const resp = await this.apiClient.getContentNodes(host);
      return new HashableNodesResponse(resp);
    });

    const got = await majorityResult(promises);
    this.contentNodes = got.data.hosts;
  }
}

// HashableNodesResponse is a wrapper around NodesResponse that allows it to be used in
// `majorityResult()` calls.
class HashableNodesResponse implements Hashable {
  constructor(public readonly data: NodesResponse) {}

  public hash(): string {
    return JSON.stringify(this.data);
  }
}

// In-place Fisher-Yates shuffle.
function shuffle<T>(arr: T[]): T[] {
  let currentIndex = arr.length;
  while (currentIndex != 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
  }
  return arr;
}