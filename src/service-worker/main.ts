/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
import {CacheDatabase} from './src/db-cache';

const scope = self as unknown as ServiceWorkerGlobalScope;

const envContentNodes = process.env.CONTENT_NODES as string;
const contentNodes = (envContentNodes.trim() !== '') ? envContentNodes.trim().split(',') : [];

const envBootstrapNodes = process.env.BOOTSTRAP_NODES as string;
const bootstrapNodes = (envBootstrapNodes.trim() !== '') ? envBootstrapNodes.trim().split(',') : [];

const contentNodeRefreshIntervalMs = Number(process.env.CONTENT_NODE_REFRESH_INTERVAL_MS);

const projectId = process.env.PROJECT_ID as string;

const adapter = new Adapter(scope.registration.scope, self.caches as unknown as CacheStorage);
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

new Driver(scope, adapter, new CacheDatabase(adapter), registry, apiClient, scope.crypto.subtle);

// option 1
// // Extend the ServiceWorkerGlobalScope to allow originalFetch
// interface ExtendedServiceWorkerGlobalScope extends ServiceWorkerGlobalScope {
//   originalFetch?: typeof fetch;
// }

// // Use the extended scope
// declare const self: ExtendedServiceWorkerGlobalScope;

// // Save the original fetch function (for use in both external and internal requests)
// self.originalFetch = fetch;

// // Log all network requests intercepted by the Service Worker
// self.addEventListener('fetch', (event: FetchEvent) => {
//   const { method, url } = event.request;

//   // Log to clients (dashboard/viewer)
//   event.waitUntil(
//     logToClients({
//       type: 'sw-fetch',
//       method,
//       url,
//       timestamp: Date.now(),
//     })
//   );

//   // Continue with the normal request using original fetch
//   event.respondWith(self.originalFetch!(event.request));
// });

// // Override fetch inside the SW for internal use (e.g. background fetches)
// self.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
//   const start = Date.now();
//   const method = args[1]?.method || 'GET';
//   const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : (args[0] as URL).toString());

//   try {
//     const response = await self.originalFetch!(...args);

//     await logToClients({
//       type: 'sw-internal-fetch',
//       method,
//       url,
//       status: response.status,
//       duration: Date.now() - start,
//       timestamp: start,
//     });

//     return response;
//   } catch (err: any) {
//     await logToClients({
//       type: 'sw-internal-fetch',
//       method,
//       url,
//       error: err.message || 'Unknown error',
//       duration: Date.now() - start,
//       timestamp: start,
//     });

//     throw err;
//   }
// };

// // ---- Type Definitions and Utility Functions ----

// type SWLogMessage = {
//   type: 'sw-fetch' | 'sw-internal-fetch';
//   method: string;
//   url: string;
//   status?: number;
//   error?: string;
//   duration?: number;
//   timestamp: number;
// };

// // Sends a message to all connected clients (browser tabs)
// async function logToClients(data: SWLogMessage): Promise<void> {
//   const clients = await self.clients.matchAll({
//     includeUncontrolled: true,
//     type: 'window',
//   });

//   for (const client of clients) {
//     client.postMessage(data);
//   }
// }

// option 2
// Service Worker Diagnostic Script

declare const self: ServiceWorkerGlobalScope;

// Comprehensive logging interface
interface ServiceWorkerLogEvent {
  type: string;
  message?: string;
  details?: Record<string, unknown>;
}

// Enhanced error handling and logging
class ServiceWorkerLogger {
  static log(event: ServiceWorkerLogEvent) {
    console.log(`🔍 SW LOG [${event.type}]:`, event.message, event.details || '');
  }

  static error(event: ServiceWorkerLogEvent) {
    console.error(`🚨 SW ERROR [${event.type}]:`, event.message, event.details || '');
  }
}

// Environment validation
function validateServiceWorkerEnvironment() {
  try {
    ServiceWorkerLogger.log({
      type: 'ENVIRONMENT_CHECK',
      message: 'Validating Service Worker Environment',
      details: {
        hasSelf: !!self,
        hasEventListener: typeof self.addEventListener === 'function',
        hasClients: !!self.clients,
        hasSkipWaiting: typeof self.skipWaiting === 'function'
      }
    });
  } catch (error) {
    ServiceWorkerLogger.error({
      type: 'ENVIRONMENT_ERROR',
      message: 'Failed to validate service worker environment',
      details: { error: String(error) }
    });
  }
}

// Install event handler with comprehensive logging
function handleInstallEvent(event: ExtendableEvent) {
  ServiceWorkerLogger.log({
    type: 'INSTALL',
    message: 'Service Worker Installation Started',
    details: { event: String(event) }
  });

  event.waitUntil(
    self.skipWaiting()
      .then(() => {
        ServiceWorkerLogger.log({
          type: 'INSTALL',
          message: 'Skip Waiting Completed Successfully'
        });
      })
      .catch(error => {
        ServiceWorkerLogger.error({
          type: 'INSTALL_ERROR',
          message: 'Skip Waiting Failed',
          details: { error: String(error) }
        });
      })
  );
}

// Activate event handler with comprehensive logging
function handleActivateEvent(event: ExtendableEvent) {
  ServiceWorkerLogger.log({
    type: 'ACTIVATE',
    message: 'Service Worker Activation Started',
    details: { event: String(event) }
  });

  event.waitUntil(
    self.clients.claim()
      .then(() => {
        ServiceWorkerLogger.log({
          type: 'ACTIVATE',
          message: 'Clients Claimed Successfully'
        });
      })
      .catch(error => {
        ServiceWorkerLogger.error({
          type: 'ACTIVATE_ERROR',
          message: 'Client Claiming Failed',
          details: { error: String(error) }
        });
      })
  );
}

// Comprehensive fetch event handler
function handleFetchEvent(event: FetchEvent) {
  try {
    // Extremely verbose logging
    ServiceWorkerLogger.log({
      type: 'FETCH',
      message: 'Fetch Event Intercepted',
      details: {
        url: event.request.url,
        method: event.request.method,
        destination: event.request.destination,
        mode: event.request.mode,
        type: 'fetch',
        headers: {}
      }
    });

    // Send detailed fetch information to all clients
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          type: 'sw-fetch-intercepted',
          url: event.request.url,
          method: event.request.method,
          destination: event.request.destination,
          timestamp: Date.now()
        });
      });
    });

    // Respond to the fetch event
    event.respondWith(
      fetch(event.request)
        .then(response => {
          ServiceWorkerLogger.log({
            type: 'FETCH_RESPONSE',
            message: 'Fetch Successful',
            details: {
              url: event.request.url,
              status: response.status,
              type: response.type
            }
          });
          return response;
        })
        .catch(error => {
          ServiceWorkerLogger.error({
            type: 'FETCH_ERROR',
            message: 'Fetch Failed',
            details: {
              url: event.request.url,
              error: String(error)
            }
          });
          throw error;
        })
    );
  } catch (error) {
    ServiceWorkerLogger.error({
      type: 'FETCH_HANDLER_ERROR',
      message: 'Error in Fetch Event Handler',
      details: { error: String(error) }
    });
  }
}

// Global error handling
function handleErrorEvent(event: ErrorEvent) {
  ServiceWorkerLogger.error({
    type: 'GLOBAL_ERROR',
    message: 'Unhandled Service Worker Error',
    details: {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    }
  });
}

// Initialize service worker event listeners
function initializeServiceWorker() {
  // Validate environment first
  validateServiceWorkerEnvironment();

  // Add event listeners
  self.addEventListener('install', handleInstallEvent);
  self.addEventListener('activate', handleActivateEvent);
  self.addEventListener('fetch', handleFetchEvent);
  self.addEventListener('error', handleErrorEvent);

  ServiceWorkerLogger.log({
    type: 'INITIALIZATION',
    message: 'Service Worker Initialized Successfully'
  });
}

// Execute initialization
initializeServiceWorker();