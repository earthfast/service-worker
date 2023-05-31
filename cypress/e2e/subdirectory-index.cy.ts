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

  ['/blog',
   '/blog?page=1',
   '/blog/',
   '/blog/?page=1',
   '/blog/index.html',
   '/blog/index.html?page=1',
  ].forEach((href) => {
    cy.get(`a[href="${href}"]`).first().click();
    cy.get('h1').first().should('have.text', 'blog index.html');

    cy.go('back');
    cy.get('h1').first().should('have.text', 'root index.html');
  });
});