import {createRequire} from 'module';
const require = createRequire(import.meta.url);

const MF = require('multiformats/dist/cjs');
const {CID} = MF;
const {sha256} = MF.hashes;

/**
 * Compute an IPFS CID v1 for the given data.
 * Uses SHA-256 (sha2) as the digest algorithm.
 *
 * @param buffer The asset's ArrayBuffer.
 * @returns A Promise resolving to the computed CID (as a string).
 */
export function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  return sha256.digest(new Uint8Array(buffer)).then((digest: any) => {
    const cid = CID.create(1, sha256.code, digest);
    return cid.toString();  // Returns base32 CID v1 string by default.
  });
}
