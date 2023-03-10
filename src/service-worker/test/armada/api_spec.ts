import {ArmadaAPIClientImpl, HTTPProtocol} from '../../src/armada/api';
import {MockResponse} from '../../testing/armada/fetch';
import {SwTestHarnessBuilder} from '../../testing/armada/scope';

class ThrowingFetcher {
  async fetch(_req: RequestInfo, _init?: RequestInit): Promise<Response> {
    throw new Error('ThrowingFetcher always throws');
  }
}

class InternalServerErrorFetcher {
  async fetch(_req: RequestInfo, _init?: RequestInit): Promise<Response> {
    return new MockResponse('', {status: 500});
  }
}

describe('ArmadaAPIClientImpl', () => {
  describe('getContent', () => {
    describe('request URLs', () => {
      const cases: {
        name: string,
        protocol: HTTPProtocol,
        host: string,
        want: jasmine.ObjectContaining<unknown>[],
      }[] =
          [
            {
              name: 'have the correct protocol for http',
              protocol: 'http:',
              host: 'content0',
              want: [jasmine.objectContaining({protocol: 'http:'})],
            },
            {
              name: 'have the correct protocol for https',
              protocol: 'https:',
              host: 'content0',
              want: [jasmine.objectContaining({protocol: 'https:'})],
            },
            {
              name: 'have the correct hostname',
              protocol: 'https:',
              host: 'content0',
              want: [jasmine.objectContaining({hostname: 'content0'})],
            },
            {
              name: 'have the correct path',
              protocol: 'https:',
              host: 'content0',
              want: [jasmine.objectContaining({pathname: '/v1/content'})],
            },
          ];

      for (let tc of cases) {
        it(tc.name, async () => {
          const fetcher = {
            async fetch(req: RequestInfo, _init?: RequestInit): Promise<Response> {
              const url = (typeof req === 'string') ? new URL(req) : new URL((req as Request).url);

              tc.want.forEach(x => expect(url).toEqual(x));

              return new MockResponse('ok');
            }
          }

          const adapter = new SwTestHarnessBuilder().build();
          const client = new ArmadaAPIClientImpl(adapter, fetcher, tc.protocol, 'test-proj');
          await client.getContent('index.html', tc.host);
        });
      }
    });

    describe('request URL query parameters', () => {
      const cases: {
        name: string,
        projectId: string,
        resource: string,
        retry: string|undefined,
        want: {
          [key: string]: string|RegExp|null,
        }
      }[] =
          [
            {
              name: 'include project_id',
              projectId: 'test-proj',
              resource: 'index.html',
              retry: undefined,
              want: {
                project_id: 'test-proj',
              },
            },
            {
              name: 'include resource',
              projectId: 'test-proj',
              resource: 'index.html',
              retry: undefined,
              want: {
                resource: 'index.html',
              },
            },
            {
              name: 'properly encode non-urlsafe resources',
              projectId: 'test-proj',
              resource: '/scripts/main.js',
              retry: undefined,
              want: {
                resource: '/scripts/main.js',
              },
            },
            {
              name: 'include retry',
              projectId: 'test-proj',
              resource: 'index.html',
              retry: 'content2',
              want: {
                retry: 'content2',
              },
            },
            {
              name: 'omit retry when null',
              projectId: 'test-proj',
              resource: 'index.html',
              retry: undefined,
              want: {
                retry: null,
              }
            },
            {
              name: 'include a cache busting param',
              projectId: 'test-proj',
              resource: 'index.html',
              retry: undefined,
              want: {
                [ArmadaAPIClientImpl.cacheBustKey]: new RegExp(/.+/),
              },
            },
          ];

      for (let tc of cases) {
        it(tc.name, async () => {
          const fetcher = {
            async fetch(req: RequestInfo, _init?: RequestInit): Promise<Response> {
              const url = (typeof req === 'string') ? new URL(req) : new URL((req as Request).url);

              for (const key in tc.want) {
                const val = tc.want[key];
                if (val === null) {
                  expect(url.searchParams.has(key)).toBeFalse();
                } else {
                  expect(url.searchParams.get(key)).toMatch(val);
                }
              }

              return new MockResponse('ok');
            }
          }

          const adapter = new SwTestHarnessBuilder().build();
          const client = new ArmadaAPIClientImpl(adapter, fetcher, 'http:', tc.projectId);
          await client.getContent(tc.resource, 'content0', tc.retry);
        });
      }
    });

    it('throws if the fetch fails', async () => {
      const adapter = new SwTestHarnessBuilder().build();
      const client = new ArmadaAPIClientImpl(adapter, new ThrowingFetcher(), 'http:', 'test-proj');
      await expectAsync(client.getContent('index.html', 'content0')).toBeRejected();
    });

    it('does not throw for non-200 responses', async () => {
      const adapter = new SwTestHarnessBuilder().build();
      const client =
          new ArmadaAPIClientImpl(adapter, new InternalServerErrorFetcher(), 'http:', 'test-proj');
      await expectAsync(client.getContent('index.html', 'content0')).toBeResolved();
    });
  });

  describe('getContentNodes', () => {
    describe('request URLs', () => {
      const cases: {
        name: string,
        protocol: HTTPProtocol,
        host: string,
        want: jasmine.ObjectContaining<unknown>[],
      }[] =
          [
            {
              name: 'have the correct protocol for http',
              protocol: 'http:',
              host: 'topology0',
              want: [jasmine.objectContaining({protocol: 'http:'})],
            },
            {
              name: 'have the correct protocol for https',
              protocol: 'https:',
              host: 'topology0',
              want: [jasmine.objectContaining({protocol: 'https:'})],
            },
            {
              name: 'have the correct hostname',
              protocol: 'https:',
              host: 'topology0',
              want: [jasmine.objectContaining({hostname: 'topology0'})],
            },
            {
              name: 'have the correct path',
              protocol: 'https:',
              host: 'topology0',
              want: [jasmine.objectContaining({pathname: '/v1/nodes'})],
            },
          ];

      for (let tc of cases) {
        it(tc.name, async () => {
          const fetcher = {
            async fetch(req: RequestInfo, _init?: RequestInit): Promise<Response> {
              const url = (typeof req === 'string') ? new URL(req) : new URL((req as Request).url);

              tc.want.forEach(x => expect(url).toEqual(x));

              return new MockResponse(JSON.stringify({hosts: []}));
            }
          }

          const adapter = new SwTestHarnessBuilder().build();
          const client = new ArmadaAPIClientImpl(adapter, fetcher, tc.protocol, 'test-proj');
          await client.getContentNodes(tc.host);
        });
      }
    });

    describe('request URL query parameters', () => {
      const cases: {
        name: string,
        projectId: string,
        want: {
          [key: string]: string|RegExp|null,
        }
      }[] =
          [
            {
              name: 'include project_id',
              projectId: 'test-proj',
              want: {
                project_id: 'test-proj',
              },
            },
          ];

      for (let tc of cases) {
        it(tc.name, async () => {
          const fetcher = {
            async fetch(req: RequestInfo, _init?: RequestInit): Promise<Response> {
              const url = (typeof req === 'string') ? new URL(req) : new URL((req as Request).url);

              for (const key in tc.want) {
                const val = tc.want[key];
                if (val === null) {
                  expect(url.searchParams.has(key)).toBeFalse();
                } else {
                  expect(url.searchParams.get(key)).toMatch(val);
                }
              }

              return new MockResponse(JSON.stringify({hosts: []}));
            }
          }

          const adapter = new SwTestHarnessBuilder().build();
          const client = new ArmadaAPIClientImpl(adapter, fetcher, 'http:', tc.projectId);
          await client.getContentNodes('topology0');
        });
      }
    });

    it('throws if the fetch fails', async () => {
      const adapter = new SwTestHarnessBuilder().build();
      const client = new ArmadaAPIClientImpl(adapter, new ThrowingFetcher(), 'http:', 'test-proj');
      await expectAsync(client.getContentNodes('topology0')).toBeRejected();
    });

    it('throws for non-200 responses', async () => {
      const adapter = new SwTestHarnessBuilder().build();
      const client =
          new ArmadaAPIClientImpl(adapter, new InternalServerErrorFetcher(), 'http:', 'test-proj');
      await expectAsync(client.getContentNodes('topology0')).toBeRejected();
    });
  });
});