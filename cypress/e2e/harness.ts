import {ContentNode, DomainNode, TopologyNode} from './nodes';

const TEST_DOMAIN = 'armada.local';

export class TestHarness {
  public domainNode: DomainNode;

  public readonly messages: MessageEvent[] = [];
  public readonly messageTypes: string[] = [];

  constructor(
      public projectId: string, public topologyNodes: TopologyNode[],
      public contentNodes: ContentNode[]) {
    this.domainNode = new DomainNode(projectId, TEST_DOMAIN, topologyNodes);
  }

  public intercept() {
    this.contentNodes.forEach(n => n.intercept());
    this.topologyNodes.forEach(n => n.intercept());
    this.domainNode.intercept();
  }

  public spyOnMessages(window: Cypress.AUTWindow) {
    window.navigator.serviceWorker.addEventListener('message', (evt: MessageEvent) => {
      this.messages.push(evt);
      this.messageTypes.push(evt.data.type ? evt.data.type : evt.data.action);
    });
  }
}