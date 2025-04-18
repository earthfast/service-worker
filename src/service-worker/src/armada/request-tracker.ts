import {Adapter} from '../adapter';

export interface RequestInfo {
  url: string;
  node: string;
  method: string;
  status?: number;
  timestamp: number;
  success: boolean;
  error?: string;
  resource?: string;
}

export class RequestTracker {
  private requests: RequestInfo[] = [];
  private static instance: RequestTracker;

  constructor(private scope: ServiceWorkerGlobalScope, private adapter: Adapter) {}

  static getInstance(scope: ServiceWorkerGlobalScope, adapter: Adapter): RequestTracker {
    if (!RequestTracker.instance) {
      RequestTracker.instance = new RequestTracker(scope, adapter);
    }
    return RequestTracker.instance;
  }

  trackRequest(info: Omit<RequestInfo, 'timestamp'>): RequestInfo {
    const request = {...info, timestamp: Date.now()};

    this.requests.push(request);

    // Keep only the last 100 requests
    if (this.requests.length > 100) {
      this.requests.shift();
    }

    // Broadcast the request to all clients
    this.broadcastRequestUpdate(request);

    return request;
  }

  getRequests(): RequestInfo[] {
    return [...this.requests];
  }

  clearRequests(): void {
    this.requests = [];
    this.broadcastRequestsCleared();
  }

  private async broadcastRequestUpdate(request: RequestInfo): Promise<void> {
    const clients = await this.scope.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({type: 'REQUEST_TRACKED', request});
    });
  }

  private async broadcastRequestsCleared(): Promise<void> {
    const clients = await this.scope.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({type: 'REQUESTS_CLEARED'});
    });
  }

  async sendAllRequests(): Promise<void> {
    const clients = await this.scope.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({type: 'ALL_REQUESTS', requests: this.requests});
    });
  }
}
