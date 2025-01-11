import {Adapter} from '../adapter';

export interface ContentAPIClient {
  getContent(resource: string, host: string, retry?: string, cacheBust?: boolean): Promise<Response>;
}

export type TopologyAPIClient = {
  getContentNodes(host: string): Promise<NodesResponse>;
}

export type ArmadaAPIClient = ContentAPIClient&TopologyAPIClient;

export type HTTPProtocol = 'http:'|'https:';

export type NodesResponse = {
  hosts: string[];
}

interface Fetcher {
  fetch(req: RequestInfo, init?: RequestInit): Promise<Response>;
}

export class ArmadaAPIClientImpl implements ArmadaAPIClient {
  public static readonly cacheBustKey: string = 'cache-bust';

  constructor(
      protected adapter: Adapter, protected fetcher: Fetcher, protected protocol: HTTPProtocol,
      public readonly projectId: string) {}

  async getContent(
    resource: string, 
    host: string, 
    retry?: string, 
    cacheBust?: boolean
  ): Promise<Response> {
    const url = new URL('/v1/content', `${this.protocol}//${host}`);
    url.searchParams.append('project_id', this.projectId);
    url.searchParams.append('resource', resource);
    if (cacheBust) {
      url.searchParams.append(ArmadaAPIClientImpl.cacheBustKey, Math.random().toString());
    }
    if (retry) {
      url.searchParams.append('retry', retry);
    }

    const req = this.adapter.newRequest(url.toString());
    return this.fetcher.fetch(req);
  }

  async getContentNodes(host: string): Promise<NodesResponse> {
    const url = new URL('/v1/nodes', `${this.protocol}//${host}`);
    url.searchParams.append('project_id', this.projectId);
    const req = this.adapter.newRequest(url.toString());

    const resp = await this.fetcher.fetch(req);
    if (!resp.ok) {
      throw new Error(`Failed to fetch content nodes (status: ${resp.status})`);
    }
    return (await resp.json()) as NodesResponse;
  }
}