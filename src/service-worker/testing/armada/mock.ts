/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {computeCidV1} from '../../src/armada/cid';
import {ArmadaDriver} from '../../src/armada/driver';
import {Manifest} from '../../src/manifest';
import {sha1} from '../../src/sha1';
import {TEST_BOOTSTRAP_NODE, TEST_PROJECT_ID} from '../utils';

import {MockResponse} from './fetch';

export type HeaderMap = {
  [key: string]: string
};

export class MockFile {
  constructor(
      readonly path: string, readonly contents: string, readonly headers = {},
      readonly hashThisFile: boolean, readonly brokenHash: boolean = false) {}

  get hash(): string {
    return sha1(this.contents);
  }

  // Add method to compute CID for file content
  async getCid(): Promise<string> {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(this.contents).buffer;
    return computeCidV1(buffer);
  }

  get randomHash(): string {
    return sha1(((Math.random() * 10000000) | 0).toString());
  }

  // Generate a broken CID for testing
  async getRandomCid(): Promise<string> {
    const randomContent = ((Math.random() * 10000000) | 0).toString();
    const encoder = new TextEncoder();
    const buffer = encoder.encode(randomContent).buffer;
    return computeCidV1(buffer);
  }
}

export class MockFileSystemBuilder {
  private resources = new Map<string, MockFile>();

  addFile(
      path: string, contents: string, headers?: HeaderMap, port?: number,
      additional: string = ''): MockFileSystemBuilder {
    this.resources.set(path, new MockFile(path, contents, headers, true));

    const projectId = encodeURIComponent(TEST_PROJECT_ID);
    const pathKey =
        `/v1/content?project_id=${projectId}&resource=${encodeURIComponent(path)}${additional}`;
    this.resources.set(pathKey, new MockFile(path, contents, headers, true));

    return this;
  }

  addUnhashedFile(path: string, contents: string, headers?: HeaderMap, port?: number):
      MockFileSystemBuilder {
    this.resources.set(path, new MockFile(path, contents, headers, false));

    const projectId = encodeURIComponent(TEST_PROJECT_ID);
    const pathKey = `/v1/content?project_id=${projectId}&resource=${encodeURIComponent(path)}`;
    this.resources.set(pathKey, new MockFile(path, contents, headers, false));

    return this;
  }

  build(): MockFileSystem {
    return new MockFileSystem(this.resources);
  }
}

export class MockFileSystem {
  constructor(private resources: Map<string, MockFile>) {}

  lookup(path: string): MockFile|undefined {
    return this.resources.get(path);
  }

  extend(): MockFileSystemBuilder {
    const builder = new MockFileSystemBuilder();
    Array.from(this.resources.keys()).forEach(path => {
      const res = this.resources.get(path)!;
      if (res.hashThisFile) {
        builder.addFile(path, res.contents, res.headers);
      } else {
        builder.addUnhashedFile(path, res.contents, res.headers);
      }
    });
    return builder;
  }

  list(): string[] {
    return Array.from(this.resources.keys());
  }

  // Helper to read content directly
  async read(path: string): Promise<string> {
    const file = this.lookup(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }
    return file.contents;
  }
}

export class MockServerStateBuilder {
  private rootDir = '/';
  private resources = new Map<string, Response>();
  private errors = new Set<string>();

  withRootDirectory(newRootDir: string): MockServerStateBuilder {
    // Update existing resources/errors.
    const oldRootDir = this.rootDir;
    const updateRootDir = (path: string) =>
        path.startsWith(oldRootDir) ? joinPaths(newRootDir, path.slice(oldRootDir.length)) : path;

    this.resources = new Map(
        [...this.resources].map(([path, contents]) => [updateRootDir(path), contents.clone()]));
    this.errors = new Set([...this.errors].map(url => updateRootDir(url)));

    // Set `rootDir` for future resource/error additions.
    this.rootDir = newRootDir;

    return this;
  }

  withStaticFiles(dir: MockFileSystem): MockServerStateBuilder {
    dir.list().forEach(path => {
      const file = dir.lookup(path)!;
      this.resources.set(
          joinPaths(this.rootDir, path), new MockResponse(file.contents, {headers: file.headers}));
    });
    return this;
  }

  withManifest(manifest: Manifest): MockServerStateBuilder {
    const projectId = encodeURIComponent(TEST_PROJECT_ID);
    this.resources.set(
        `/v1/nodes?project_id=${projectId}`,
        new MockResponse(JSON.stringify({hosts: [TEST_BOOTSTRAP_NODE]})),
    );

    this.resources.set(
        `/v1/content?project_id=${projectId}&resource=${ArmadaDriver.MANIFEST_FILENAME}`,
        new MockResponse(JSON.stringify(manifest)),
    );

    return this;
  }

  withContentNodes(manifest: Manifest, nodes: {node: string, hosts: string[]}[]):
      MockServerStateBuilder {
    const projectId = encodeURIComponent(TEST_PROJECT_ID);

    nodes.forEach((node) => {
      this.resources.set(
          `http://${node.node}/v1/nodes?project_id=${projectId}`,
          new MockResponse(JSON.stringify({hosts: node.hosts})));
      this.resources.set(
          `/v1/nodes?project_id=${projectId}`,
          new MockResponse(JSON.stringify({hosts: node.hosts})));

      node.hosts.forEach((host) => {
        this.resources.set(
            `http://${host}/v1/content?project_id=${projectId}&resource=${
                ArmadaDriver.MANIFEST_FILENAME}`,
            new MockResponse(JSON.stringify(manifest)));
      });
    });

    return this;
  }

  withRedirect(from: string, to: string, toContents: string): MockServerStateBuilder {
    this.resources.set(from, new MockResponse(toContents, {redirected: true, url: to}));
    this.resources.set(to, new MockResponse(toContents));
    return this;
  }

  withError(url: string): MockServerStateBuilder {
    this.errors.add(url);
    return this;
  }

  build(): MockServerState {
    // Take a "snapshot" of the current `resources` and `errors`.
    const resources = new Map(this.resources.entries());
    const errors = new Set(this.errors.values());

    return new MockServerState(resources, errors);
  }
}

export class MockServerState {
  private requests: Request[] = [];
  private gate: Promise<void> = Promise.resolve();
  private resolve: Function|null = null;
  // TODO(issue/24571): remove '!'.
  private resolveNextRequest!: Function;
  online = true;
  nextRequest: Promise<Request>;

  constructor(private resources: Map<string, Response>, private errors: Set<string>) {
    this.nextRequest = new Promise(resolve => {
      this.resolveNextRequest = resolve;
    });
  }

  async fetch(req: Request): Promise<Response> {
    this.resolveNextRequest(req);
    this.nextRequest = new Promise(resolve => {
      this.resolveNextRequest = resolve;
    });


    await this.gate;

    if (!this.online) {
      throw new Error('Offline.');
    }

    this.requests.push(req);

    if ((req.credentials === 'include') || (req.mode === 'no-cors')) {
      return new MockResponse(null, {status: 0, statusText: '', type: 'opaque'});
    }
    const url = req.url.split('%3F')[0];

    if (this.resources.has(url)) {
      let res = this.resources.get(url)!.clone();
      return res;
    }

    // temp hack
    if (this.resources.has('/' + url)) {
      let res = this.resources.get('/' + url)!.clone();
      return res;
    }

    if (this.errors.has(url)) {
      throw new Error('Intentional failure!');
    }
    return new MockResponse(null, {status: 404, statusText: 'Not Found'});
  }

  pause(): void {
    this.gate = new Promise(resolve => {
      this.resolve = resolve;
    });
  }

  unpause(): void {
    if (this.resolve === null) {
      return;
    }
    this.resolve();
    this.resolve = null;
  }

  assertSawRequestFor(url: string): void {
    if (!this.sawRequestFor(url)) {
      throw new Error(`Expected request for ${url}, got none.`);
    }
  }

  assertNoRequestFor(url: string): void {
    if (this.sawRequestFor(url)) {
      throw new Error(`Expected no request for ${url} but saw one.`);
    }
  }

  matchResource(url: string): Request[] {
    return this.requests.filter(req => {
      const queryParams = new URLSearchParams(req.url.split('?')[1]);
      const resource = queryParams.get('resource')?.split('?')[0] || '';
      return decodeURIComponent(resource) == url;
    });
  }

  sawRequestFor(url: string): boolean {
    // look for content requests
    let matching = this.matchResource(url);
    if (matching.length > 0) {
      this.requests = this.requests.filter(req => req !== matching[0]);
      return true;
    }

    // node or legacy requests
    matching = this.requests.filter(req => req.url.split('?')[0] === url);
    if (matching.length > 0) {
      this.requests = this.requests.filter(req => req !== matching[0]);
      return true;
    }

    return false;
  }

  assertSawNodeRequestFor(resource: string): void {
    if (!this.sawNodeRequestFor(resource)) {
      throw new Error(`Expected node request for ${resource}, got none.`);
    }
  }

  sawNodeRequestFor(file: string): boolean {
    const matching = this.matchResource(file);
    const matched = matching.length > 0;

    // remove all occurrences as we may do multiple manifest lookups
    matching.forEach(match => {
      this.requests = this.requests.filter(req => req !== match);
    });

    return matched;
  }

  assertNoOtherRequests(): void {
    let requests = this.requests.map(req => {
      const queryParams = new URLSearchParams(req.url.split('?')[1]);
      const resource = queryParams.get('resource')?.split('?')[0] || req.url.split('?')[0];
      return resource;
    });

    if (!this.noOtherRequests()) {
      throw new Error(`Expected no other requests, got requests for ${requests.join(', ')}`);
    }
  }

  noOtherRequests(): boolean {
    return this.requests.length === 0;
  }

  clearRequests(): void {
    this.requests = [];
  }

  reset(): void {
    this.clearRequests();
    this.nextRequest = new Promise(resolve => {
      this.resolveNextRequest = resolve;
    });
    this.gate = Promise.resolve();
    this.resolve = null;
    this.online = true;
  }
}

export function tmpManifestSingleAssetGroup(fs: MockFileSystem): Manifest {
  const files = fs.list();
  const hashTable: {[url: string]: string} = {};
  files.forEach(path => {
    hashTable[path] = fs.lookup(path)!.hash;
  });
  return {
    configVersion: 1,
    timestamp: 1234567890123,
    index: '/index.html',
    assetGroups: [
      {
        name: 'group',
        installMode: 'prefetch',
        updateMode: 'prefetch',
        urls: files,
        patterns: [],
        cacheQueryOptions: {ignoreVary: true}
      },
    ],
    navigationUrls: [],
    navigationRequestStrategy: 'performance',
    hashTable,
  };
}

// Traditional SHA1 hash table generation (keep for backward compatibility)
export function tmpHashTableForFs(
    fs: MockFileSystem, breakHashes: {[url: string]: boolean} = {},
    baseHref = '/'): {[url: string]: string} {
  // Create a basic hashTable with SHA-1 hashes for backward compatibility
  const table: {[url: string]: string} = {};
  fs.list().forEach(filePath => {
    const urlPath = joinPaths(baseHref, filePath);
    const file = fs.lookup(filePath);
    if (!file) return;

    if (file.brokenHash) {
      table[urlPath] = file.randomHash;
    } else if (file.hashThisFile) {
      table[urlPath] = file.hash;  // Use SHA-1 hash for backward compatibility
      if (breakHashes[filePath]) {
        table[urlPath] = table[urlPath].split('').reverse().join('');
      }
    }
  });
  return table;
}

// CID-based hash table function for tests
export async function cidHashTableForFs(
    fs: MockFileSystem, breakHashes: {[url: string]: boolean} = {},
    baseHref = '/'): Promise<{[url: string]: string}> {
  const table: {[url: string]: string} = {};

  await Promise.all(fs.list().map(async (filePath) => {
    const urlPath = joinPaths(baseHref, filePath);
    const file = fs.lookup(filePath);
    if (!file) return;

    if (file.hashThisFile) {
      const encoder = new TextEncoder();
      const buffer = encoder.encode(file.contents).buffer;

      if (file.brokenHash || breakHashes[filePath]) {
        // Generate a different CID for broken hashes
        const wrongContent = file.contents + 'BROKEN';
        const wrongBuffer = encoder.encode(wrongContent).buffer;
        table[urlPath] = await computeCidV1(wrongBuffer);
      } else {
        table[urlPath] = await computeCidV1(buffer);
      }
    }
  }));

  return table;
}

export function tmpHashTable(manifest: Manifest): Map<string, string> {
  const map = new Map<string, string>();
  Object.keys(manifest.hashTable).forEach(url => {
    const hash = manifest.hashTable[url];
    map.set(url, hash);
  });
  return map;
}

// Helpers
/**
 * Join two path segments, ensuring that there is exactly one slash (`/`) between them.
 */
function joinPaths(path1: string, path2: string): string {
  return `${path1.replace(/\/$/, '')}/${path2.replace(/^\//, '')}`;
}
