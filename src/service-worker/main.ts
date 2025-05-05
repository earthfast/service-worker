/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Adapter} from './src/adapter';
import {ArmadaAPIClientImpl, HTTPProtocol} from './src/armada/api';
import {ArmadaDriver as Driver} from './src/armada/driver';
import {DynamicNodeRegistry, NodeRegistry, StaticNodeRegistry} from './src/armada/registry';
import {RequestTracker} from './src/armada/request-tracker';
import {CacheDatabase} from './src/db-cache';

const scope = self as unknown as ServiceWorkerGlobalScope;

const envContentNodes = process.env.CONTENT_NODES as string;
const contentNodes = (envContentNodes.trim() !== '') ? envContentNodes.trim().split(',') : [];

const envBootstrapNodes = process.env.BOOTSTRAP_NODES as string;
const bootstrapNodes = (envBootstrapNodes.trim() !== '') ? envBootstrapNodes.trim().split(',') : [];

const contentNodeRefreshIntervalMs = Number(process.env.CONTENT_NODE_REFRESH_INTERVAL_MS);

const projectId = process.env.PROJECT_ID as string;

const adapter = new Adapter(scope.registration.scope, self.caches);

// Initialize the request tracker
const requestTracker = RequestTracker.getInstance(scope, adapter);

const apiClient = new ArmadaAPIClientImpl(
    adapter,
    scope,
    location.protocol as HTTPProtocol,
    projectId,
);

let registry: NodeRegistry;
if (bootstrapNodes.length) {
  registry = new DynamicNodeRegistry(apiClient, bootstrapNodes, contentNodeRefreshIntervalMs);
} else if (contentNodes.length) {
  registry = new StaticNodeRegistry(contentNodes);
} else {
  throw new Error(
      'Can\'t initialize node registry: must set env.CONTENT_NODES or env.BOOTSTRAP_NODES');
}

// Send initial request tracker info to clients
scope.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_ALL_REQUESTS') {
    requestTracker.sendAllRequests();
  }
});

new Driver(scope, adapter, new CacheDatabase(adapter), registry, apiClient, scope.crypto.subtle);
