import {NodeRegistry} from '../../src/armada/registry';

export class StaticNodeRegistry implements NodeRegistry {
  constructor(public nodes: string[]) {}

  async allNodes(): Promise<string[]> {
    return this.nodes.slice();
  }

  refreshNodesInterval(): void {}
}