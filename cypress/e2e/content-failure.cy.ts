import {TestHarness} from './harness';
import {ContentNode, TopologyNode} from './nodes';

it('content nodes fetch failure', () => {
  const projectId = 'test-proj';
  const content0 = new ContentNode('content0', projectId, 'v1');
  const topology0 = new TopologyNode('topology0', [content0]);

  const harness = new TestHarness(projectId, [topology0], [content0]);
  harness.intercept();
  harness.spyOnMessages(window);

  content0.failResource('/index.html');

  cy.visit(harness.domainNode.url);

  cy.wrap(harness).should(harness => {
    // a single node failed
    expect(harness.messageTypes).to.include('CONTENT_NODE_FETCH_FAILURE');

    // all nodes failed
    expect(harness.messageTypes).to.include('CONTENT_NODES_FETCH_FAILURE');
  });
});
