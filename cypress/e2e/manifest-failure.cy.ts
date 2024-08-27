import {TestHarness} from './harness';
import {ContentNode, TopologyNode} from './nodes';

it('manifest fetch on content nodes failure', () => {
  const projectId = 'test-proj';
  const content0 = new ContentNode('content0', projectId, 'manifest-does-not-exist');
  const topology0 = new TopologyNode('topology0', [content0]);

  const harness = new TestHarness(projectId, [topology0], [content0]);
  harness.intercept();
  harness.spyOnMessages(window);

  content0.failResource('earthfast.json');
  content0.failResource('armada.json');

  cy.visit(harness.domainNode.url);

  cy.wrap(harness).should(harness => {
    // a single node failed
    expect(harness.messageTypes).to.include('MANIFEST_FETCH_ERROR');

    // all nodes failed
    expect(harness.messageTypes).to.include('MANIFEST_FETCH_FAILURE_NO_CONSENSUS');
  });
});