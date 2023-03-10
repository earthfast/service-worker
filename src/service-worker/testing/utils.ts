/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {NormalizedUrl} from '../src/api';

// Armada:
export const TEST_BOOTSTRAP_NODE_PORTS = [30080, 30081, 30082, 30083, 30084];
export const TEST_BOOTSTRAP_NODE = `localhost`;
export const TEST_BOOTSTRAP_NODES = TEST_BOOTSTRAP_NODE_PORTS.map(port => `localhost:${port}`);
export const TEST_CONTENT_NODES_PORTS = [30090, 30091, 30092, 30093, 30094];
export const TEST_CONTENT_NODES = TEST_CONTENT_NODES_PORTS.map(port => `localhost:${port}`);
export const TEST_PROJECT_ID = '8a35acfbc15ff81a39ae7d344fd709f28e8600b4aa8c65c6b64bfe7fe36bd19b';

/**
 * Determine whether the current environment provides all necessary APIs to run ServiceWorker tests.
 *
 * @return Whether ServiceWorker tests can be run in the current environment.
 */
export function envIsSupported(): boolean {
  if (typeof URL === 'function') {
    return true;
  }

  // If we're in a browser that doesn't support URL at this point, don't go any further
  // since browser builds use requirejs which will fail on the `require` call below.
  if (typeof window !== 'undefined' && window) {
    return false;
  }

  // In older Node.js versions, the `URL` global does not exist. We can use `url` instead.
  const url = (typeof require === 'function') && require('url');
  return url && (typeof url.parse === 'function') && (typeof url.resolve === 'function');
}

/**
 * Get a normalized representation of a URL relative to a provided base URL.
 *
 * More specifically:
 * 1. Resolve the URL relative to the provided base URL.
 * 2. If the URL is relative to the base URL, then strip the origin (and only return the path and
 *    search parts). Otherwise, return the full URL.
 *
 * @param url The raw URL.
 * @param relativeTo The base URL to resolve `url` relative to.
 *     (This is usually the ServiceWorker's origin or registration scope).
 * @return A normalized representation of the URL.
 */
export function normalizeUrl(url: string, relativeTo: string): NormalizedUrl {
  const {origin, path, search} = parseUrl(url, relativeTo);
  const {origin: relativeToOrigin} = parseUrl(relativeTo);

  return ((origin === relativeToOrigin) ? path + search : url) as NormalizedUrl;
}


// Test Utils from Angular:
// https://github.com/angular/angular/blob/main/packages/service-worker/config/src/generator.ts

const QUESTION_MARK = '[^/]';
const WILD_SINGLE = '[^/]*';
const WILD_OPEN = '(?:.+\\/)?';

const TO_ESCAPE_BASE = [
  {replace: /\./g, with: '\\.'},
  {replace: /\+/g, with: '\\+'},
  {replace: /\*/g, with: WILD_SINGLE},
];
const TO_ESCAPE_WILDCARD_QM = [
  ...TO_ESCAPE_BASE,
  {replace: /\?/g, with: QUESTION_MARK},
];
const TO_ESCAPE_LITERAL_QM = [
  ...TO_ESCAPE_BASE,
  {replace: /\?/g, with: '\\?'},
];

export function globToRegex(glob: string, literalQuestionMark = false): string {
  const toEscape = literalQuestionMark ? TO_ESCAPE_LITERAL_QM : TO_ESCAPE_WILDCARD_QM;
  const segments = glob.split('/').reverse();
  let regex: string = '';
  while (segments.length > 0) {
    const segment = segments.pop()!;
    if (segment === '**') {
      if (segments.length > 0) {
        regex += WILD_OPEN;
      } else {
        regex += '.*';
      }
    } else {
      const processed = toEscape.reduce(
          (segment, escape) => segment.replace(escape.replace, escape.with), segment);
      regex += processed;
      if (segments.length > 0) {
        regex += '\\/';
      }
    }
  }
  return regex;
}

export function joinUrls(a: string, b: string): string {
  if (a.endsWith('/') && b.startsWith('/')) {
    return a + b.slice(1);
  } else if (!a.endsWith('/') && !b.startsWith('/')) {
    return a + '/' + b;
  }
  return a + b;
}

/**
 * Parse a URL into its different parts, such as `origin`, `path` and `search`.
 */
export function parseUrl(
    url: string, relativeTo?: string): {origin: string, path: string, search: string} {
  const parsedUrl: URL = (typeof URL === 'function') ?
      (!relativeTo ? new URL(url) : new URL(url, relativeTo)) :
      require('url').parse(require('url').resolve(relativeTo || '', url));

  return {
    origin: parsedUrl.origin || `${parsedUrl.protocol}//${parsedUrl.host}`,
    path: parsedUrl.pathname,
    search: parsedUrl.search || '',
  };
}

/**
 * Parse a URL into its different parts, such as `origin`, `path` and `search`.
 *
 * Armada: Added this function
 */
export function parseUrlArmada(url: string, relativeTo?: string):
    {origin: string, path: string, search: string, protocol: string} {
  const parsedUrl: URL = (typeof URL === 'function') ?
      (!relativeTo ? new URL(url) : new URL(url, relativeTo)) :
      require('url').parse(require('url').resolve(relativeTo || '', url));

  return {
    origin: parsedUrl.origin || `${parsedUrl.protocol}//${parsedUrl.host}`,
    path: parsedUrl.pathname,
    search: parsedUrl.search || '',
    protocol: parsedUrl.protocol,
  };
}


export function urlToRegex(url: string, baseHref: string, literalQuestionMark?: boolean): string {
  if (!url.startsWith('/') && url.indexOf('://') === -1) {
    // Prefix relative URLs with `baseHref`.
    // Strip a leading `.` from a relative `baseHref` (e.g. `./foo/`), since it would result in an
    // incorrect regex (matching a literal `.`).
    url = joinUrls(baseHref.replace(/^\.(?=\/)/, ''), url);
  }

  return globToRegex(url, literalQuestionMark);
}

const DEFAULT_NAVIGATION_URLS = [
  '/**',           // Include all URLs.
  '!/**/*.*',      // Exclude URLs to files (containing a file extension in the last segment).
  '!/**/*__*',     // Exclude URLs containing `__` in the last segment.
  '!/**/*__*/**',  // Exclude URLs containing `__` in any other segment.
];

export function processNavigationUrls(
    baseHref: string, urls = DEFAULT_NAVIGATION_URLS): {positive: boolean, regex: string}[] {
  return urls.map(url => {
    const positive = !url.startsWith('!');
    url = positive ? url : url.slice(1);
    return {positive, regex: `^${urlToRegex(url, baseHref)}$`};
  });
}