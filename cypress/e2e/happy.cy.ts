import {TestHarness} from './harness';
import {ContentNode, TopologyNode} from './nodes';

it('happy path', () => {
  const projectId = 'test-proj';
  const content0 = new ContentNode('content0', projectId, 'v1');
  const topology0 = new TopologyNode('topology0', [content0]);

  const harness = new TestHarness(projectId, [topology0], [content0]);
  harness.intercept();

  cy.visit(harness.domainNode.url);
  cy.get('h1').first().should('have.text', 'Hello, world!').then(() => {
    // Update the site to v2.
    content0.setContent('v2');
  });

  // Force the SW to refetch the manifest and load the new version.
  cy.reload().then(window => {
    harness.spyOnMessages(window);
  });

  // Wait for the new version to become ready.
  cy.wrap(harness).should(harness => {
    expect(harness.messageTypes).to.include('VERSION_READY');
  });

  // Reload again, expecting v2 to be presented.
  cy.reload();

  cy.get('h1').first().should('have.text', 'Hello, world v2!');
});