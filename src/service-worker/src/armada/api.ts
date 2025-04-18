import {Adapter} from '../adapter';

import {RequestTracker} from './request-tracker';

export type ContentAPIClient = {
  getContent(
      resource: string, host: string, retry?: string, cacheBust?: boolean): Promise<Response>;
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
  private requestTracker?: RequestTracker;

  constructor(
      protected adapter: Adapter, protected fetcher: Fetcher, protected protocol: HTTPProtocol,
      public readonly projectId: string) {
    // Initialize the request tracker if available
    if (typeof RequestTracker.getInstance === 'function' && 'clients' in this.fetcher) {
      this.requestTracker =
          RequestTracker.getInstance(this.fetcher as ServiceWorkerGlobalScope, adapter);
    }
  }

  async getContent(resource: string, host: string, retry?: string, cacheBust?: boolean):
      Promise<Response> {
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

    // Track the request before making it
    if (this.requestTracker) {
      this.requestTracker.trackRequest(
          {url: url.toString(), node: host, method: 'GET', success: true, resource});
    }

    try {
      const response = await this.fetcher.fetch(req);

      // Update the request tracking with the status
      if (this.requestTracker) {
        this.requestTracker.trackRequest({
          url: url.toString(),
          node: host,
          method: 'GET',
          status: response.status,
          success: response.ok,
          resource
        });
      }

      return response;
    } catch (error) {
      // Track failed requests
      if (this.requestTracker) {
        this.requestTracker.trackRequest({
          url: url.toString(),
          node: host,
          method: 'GET',
          success: false,
          error: error.toString(),
          resource
        });
      }
      throw error;
    }
  }

  async getContentNodes(host: string): Promise<NodesResponse> {
    const url = new URL('/v1/nodes', `${this.protocol}//${host}`);
    url.searchParams.append('project_id', this.projectId);
    const req = this.adapter.newRequest(url.toString());

    // Track the request before making it
    if (this.requestTracker) {
      this.requestTracker.trackRequest(
          {url: url.toString(), node: host, method: 'GET', success: true, resource: 'nodes'});
    }

    try {
      const resp = await this.fetcher.fetch(req);

      // Update the request tracking with the status
      if (this.requestTracker) {
        this.requestTracker.trackRequest({
          url: url.toString(),
          node: host,
          method: 'GET',
          status: resp.status,
          success: resp.ok,
          resource: 'nodes'
        });
      }

      if (!resp.ok) {
        throw new Error(`Failed to fetch content nodes (status: ${resp.status})`);
      }
      return (await resp.json()) as NodesResponse;
    } catch (error) {
      // Track failed requests
      if (this.requestTracker) {
        this.requestTracker.trackRequest({
          url: url.toString(),
          node: host,
          method: 'GET',
          success: false,
          error: error.toString(),
          resource: 'nodes'
        });
      }
      throw error;
    }
  }
}
