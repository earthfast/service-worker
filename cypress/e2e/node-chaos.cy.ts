import {TestHarness} from './harness';
import {ContentNode, OfflineContentNode, OfflineTopologyNode, TopologyNode} from './nodes';

it('site loads despite minority chaos amongst the nodes', () => {
  const projectId = 'test-proj';

  // 10 Content Nodes: 6 on v1, 2 on v2, 2 offline
  // Note: the number of non-v1 nodes must be < ArmadaLazyAssetGroup.MAX_ATTEMPTS
  const contentNodes: ContentNode[] = [
    new ContentNode('content0', projectId, 'v1'),
    new ContentNode('content1', projectId, 'v1'),
    new ContentNode('content2', projectId, 'v1'),
    new ContentNode('content3', projectId, 'v1'),
    new ContentNode('content4', projectId, 'v1'),
    new ContentNode('content5', projectId, 'v1'),

    new ContentNode('content6', projectId, 'v2'),
    new ContentNode('content7', projectId, 'v2'),

    new OfflineContentNode('content8', projectId),
    new OfflineContentNode('content9', projectId),
  ];

  // 5 Topology Nodes: 3 ok, 1 missing data, 1 offline
  const topologyNodes = [
    new TopologyNode('topology0', contentNodes),
    new TopologyNode('topology1', contentNodes),
    new TopologyNode('topology2', contentNodes),

    new TopologyNode('topology3', contentNodes.slice(0, 3)),

    new OfflineTopologyNode('topology4', contentNodes),
  ];

  const harness = new TestHarness(projectId, topologyNodes, contentNodes);
  harness.intercept();

  cy.visit(harness.domainNode.url);
  cy.get('h1').first().should('have.text', 'Hello, world!');
});