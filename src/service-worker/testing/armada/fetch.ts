/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {MockBody as _MockBody, MockHeaders, MockRequest as OriginalMockRequest} from '../fetch';

export {MockHeaders} from '../fetch';

// Export a modified MockRequest class with the bytes property
export class MockRequest extends OriginalMockRequest {
  // Add the bytes property required by the Request interface
  readonly bytes: Uint8Array;

  constructor(url: string, init: RequestInit = {}) {
    super(url, init);

    // Initialize bytes from body
    if (init.body && typeof init.body === 'string') {
      const encoder = new TextEncoder();
      this.bytes = encoder.encode(init.body);
    } else {
      this.bytes = new Uint8Array(0);
    }
  }
}

export class MockBody extends _MockBody {
  readonly body!: ReadableStream;

  constructor(public _body: string|null) {
    super(_body);
    this.body = new ReadableStreamStub(_body);
  }
}

// MockResponse is an exact copy of the original from ../fetch.ts except for the 'body' parameter in
// the constructor. In this version we allow MockResponse to be optionally instantiated with a
// ReadableStreamStub body in addition to a plain string (or null). This more closely mimics the
// Fetch API's implementation, and enables code like:
//
// const original: Reponse = <some Response>;
// const notAClone: Response = new Response(original.body);
//
// See src/armada/assets.ts for an explanation as to why this is necessary.
export class MockResponse extends MockBody implements Response {
  // Add the bytes property required by Response interface
  readonly bytes: Uint8Array;

  readonly trailer: Promise<Headers> = Promise.resolve(new MockHeaders());
  readonly headers: Headers = new MockHeaders();
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType = 'basic';
  readonly url: string = '';
  readonly redirected: boolean = false;

  constructor(
      body: string|ReadableStreamStub|null,
      init: ResponseInit&{type?: ResponseType, redirected?: boolean, url?: string} = {}) {
    super((body instanceof ReadableStreamStub) ? body.data : body);

    // Initialize bytes property from body
    if (body === null) {
      this.bytes = new Uint8Array(0);
    } else if (body instanceof ReadableStreamStub) {
      const bodyStr = body.data || '';
      const encoder = new TextEncoder();
      this.bytes = encoder.encode(bodyStr);
    } else {
      const encoder = new TextEncoder();
      this.bytes = encoder.encode(body);
    }

    this.status = (init.status !== undefined) ? init.status : 200;
    this.statusText = (init.statusText !== undefined) ? init.statusText : 'OK';
    const headers = init.headers as {[key: string]: string};
    if (headers !== undefined) {
      if (headers instanceof MockHeaders) {
        this.headers = headers;
      } else {
        Object.keys(headers).forEach(header => {
          this.headers.set(header, headers[header]);
        });
      }
    }
    if (init.type !== undefined) {
      this.type = init.type;
    }
    if (init.redirected !== undefined) {
      this.redirected = init.redirected;
    }
    if (init.url !== undefined) {
      this.url = init.url;
    }
  }

  // Override the arrayBuffer method to use bytes
  override async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.buffer;
  }

  clone(): Response {
    if (this.bodyUsed) {
      throw 'Body already consumed';
    }
    return new MockResponse(this._body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      type: this.type,
      redirected: this.redirected,
      url: this.url,
    });
  }
}

class ReadableStreamStub implements ReadableStream<Uint8Array> {
  locked: boolean;

  constructor(public data: string|null) {}

  cancel(_reason?: any): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getReader(): ReadableStreamDefaultReader<Uint8Array> {
    throw new Error('Method not implemented.');
  }

  pipeThrough<T>(
      _transform: ReadableWritablePair<T, Uint8Array>,
      _options?: StreamPipeOptions|undefined): ReadableStream<T> {
    throw new Error('Method not implemented.');
  }

  pipeTo(_destination: any, _options?: any): Promise<void> {
    throw new Error('Method not implemented.');
  }

  tee(): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
    throw new Error('Method not implemented.');
  }
}
