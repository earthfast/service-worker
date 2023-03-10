import {join} from 'path';

export abstract class FakeNode {
  public readonly url: string;

  constructor(public hostname: string) {
    this.url = `http://${this.hostname}`;
  }

  public abstract intercept(): void;
}

export class ContentNode extends FakeNode {
  protected failingResources: Set<string> = new Set();

  constructor(hostname: string, public projectId: string, public site?: string) {
    super(hostname);
  }

  public intercept() {
    cy.intercept(
        {
          pathname: '/v1/content',
          hostname: this.hostname,
          query: {
            project_id: this.projectId,
          },
        },
        (req) => {
          if (!this.site) {
            req.reply(410);
            return;
          }

          const resource = req.query['resource'] as string;
          if (this.failingResources.has(resource)) {
            req.destroy();
            return;
          }

          const fixture = join(this.site, 'e2e', resource);
          req.reply({fixture: fixture});
        },
    );
  }

  public setContent(site: string) {
    this.site = site;
  }

  public failResource(resource: string) {
    this.failingResources.add(resource);
  }
}

export class OfflineContentNode extends ContentNode {
  public override intercept() {
    cy.intercept({hostname: this.hostname}, req => req.destroy());
  }
}

export class TopologyNode extends FakeNode {
  constructor(hostname: string, public contentNodes?: ContentNode[]) {
    super(hostname);
  }

  public intercept() {
    const nodesByProject = new Map<string, ContentNode[]>();
    for (const node of this.contentNodes || []) {
      const projectNodes = nodesByProject.get(node.projectId) || [];
      projectNodes.push(node);
      nodesByProject.set(node.projectId, projectNodes);
    }

    cy.intercept(
        {
          pathname: '/v1/nodes',
          hostname: this.hostname,
        },
        (req) => {
          const projectId = req.query['project_id'] as string;
          const projectNodes = nodesByProject.get(projectId) || [];
          req.reply({hosts: projectNodes.map(n => n.hostname)});
        },
    );
  }
}

export class OfflineTopologyNode extends TopologyNode {
  public override intercept() {
    cy.intercept({hostname: this.hostname}, req => req.destroy());
  }
}

export class DomainNode extends FakeNode {
  constructor(public projectId: string, hostname: string, public topologyNodes?: TopologyNode[]) {
    super(hostname);
  }

  public intercept() {
    cy.intercept(
        {
          hostname: this.hostname,
        },
        (req) => {
          const url = new URL(req.url);
          req.reply({fixture: join('../../dist/public', url.pathname)});
        },
    );

    cy.intercept('/', {hostname: this.hostname}, {fixture: '../../dist/public/index.html'});

    cy.fixture('../../dist/templates/main.js.tmpl').then((tmpl: string) => {
      const bootstrapNodes =
          this.topologyNodes ? this.topologyNodes.map(n => n.hostname).join(',') : '';
      let body = tmpl.replace('{{.BootstrapNodes}}', bootstrapNodes);
      body = body.replace('{{.ProjectID}}', this.projectId);

      cy.intercept(
          '/armada-sw.js',
          {
            hostname: this.hostname,
          },
          {
            headers: {
              'Content-Type': 'application/javascript',
            },
            body: body,
          },
      );
    });
  }
}