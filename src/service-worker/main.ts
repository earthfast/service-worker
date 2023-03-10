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
import {NodeRegistryImpl} from './src/armada/registry';
import {CacheDatabase} from './src/db-cache';

const scope = self as unknown as ServiceWorkerGlobalScope;

const envBootstrapNodes = process.env.BOOTSTRAP_NODES as string;
const bootstrapNodes = envBootstrapNodes.split(',');
const contentNodeRefreshIntervalMs = Number(process.env.CONTENT_NODE_REFRESH_INTERVAL_MS);
const projectId = process.env.PROJECT_ID as string;

const adapter = new Adapter(scope.registration.scope, self.caches);
const apiClient = new ArmadaAPIClientImpl(
    adapter,
    scope,
    location.protocol as HTTPProtocol,
    projectId,
);
const registry = new NodeRegistryImpl(apiClient, bootstrapNodes, contentNodeRefreshIntervalMs);
new Driver(scope, adapter, new CacheDatabase(adapter), registry, apiClient, scope.crypto.subtle);
