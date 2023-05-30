import {TestHarness} from './harness';
import {ContentNode, TopologyNode} from './nodes';

it('subdirectories with index.html', () => {
  const projectId = 'test-proj';
  const content0 = new ContentNode('content0', projectId, 'subdirectory-index');
  const topology0 = new TopologyNode('topology0', [content0]);

  const harness = new TestHarness(projectId, [topology0], [content0]);
  harness.intercept();

  cy.visit(harness.domainNode.url);
  cy.get('h1').first().should('have.text', 'root index.html');

  // With trailing slash
  cy.get('a[href="/blog/"]').first().click();
  cy.get('h1').first().should('have.text', 'blog index.html');

  cy.go('back');
  cy.get('h1').first().should('have.text', 'root index.html');

  // Without trailing slash
  cy.get('a[href="/blog"]').first().click();
  cy.get('h1').first().should('have.text', 'blog index.html');
});