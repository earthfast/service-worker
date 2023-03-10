import {TestHarness} from './harness';
import {ContentNode, TopologyNode} from './nodes';

it('checksum mismatch', () => {
  const projectId = 'test-proj';
  const content0 = new ContentNode('content0', projectId, 'checksum-mismatch');
  const topology0 = new TopologyNode('topology0', [content0]);

  const harness = new TestHarness(projectId, [topology0], [content0]);
  harness.intercept();
  harness.spyOnMessages(window);

  cy.visit(harness.domainNode.url);

  cy.wrap(harness).should(harness => {
    expect(harness.messageTypes).to.include('CONTENT_CHECKSUM_MISMATCH');
  });
});