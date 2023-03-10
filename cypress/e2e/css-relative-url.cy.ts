import {TestHarness} from './harness';
import {ContentNode, TopologyNode} from './nodes';

it('manifest fetch on content nodes failure', () => {
  const projectId = 'test-proj';
  const content0 = new ContentNode('content0', projectId, 'css-relative-url');
  const topology0 = new TopologyNode('topology0', [content0]);

  const harness = new TestHarness(projectId, [topology0], [content0]);
  harness.intercept();

  cy.intercept({
      pathname: '/v1/content',
      query: {
        resource: '/bg.png',
      },
    }).as('bgImage');

  cy.visit(harness.domainNode.url);

  cy.wait('@bgImage');
});