import {createRequire} from 'module';

// In CommonJS environments (like when running tests with ts-node),
// __dirname is available and we can simply use require.
// Otherwise (in an ESM context), we use import.meta.url.
let requireFunc: NodeRequire;
if (typeof __dirname !== 'undefined') {
  // Running in CommonJS
  requireFunc = require;
} else if (typeof import.meta !== 'undefined' && import.meta.url) {
  // Running in an ESM context (should not happen in our tests)
  requireFunc = createRequire(import.meta.url);
} else {
  throw new Error('Cannot determine require function');
}

// Use the CommonJS build of multiformats.
// (The CJS build is published at "multiformats/dist/cjs")
const MF = requireFunc('multiformats/dist/cjs');
const {CID} = MF;
const {sha256} = MF.hashes;

/**
 * Computes an IPFS CID v1 for the given ArrayBuffer.
 * Uses the sha2-256 algorithm.
 *
 * @param buffer The asset data as an ArrayBuffer.
 * @returns A Promise resolving to the CID as a string.
 */
export function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  return sha256.digest(new Uint8Array(buffer)).then((digest: any) => {
    const cid = CID.create(1, sha256.code, digest);
    return cid.toString();  // Default to base32 string
  });
}
