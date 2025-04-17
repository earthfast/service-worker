import {createRequire} from 'module';

// In CommonJS, __dirname is available so we can use the built-in require.
// Otherwise (in an ESM context) fallback to createRequire.
const requireFunc: NodeRequire =
    typeof __dirname !== 'undefined' ? require : createRequire(import.meta.url);

// Force loading the CommonJS entry point by specifying the full path.
const MF = requireFunc('multiformats/dist/cjs/index.js');

// Extract the needed modules.
const {CID} = MF;
const {sha256} = MF.hashes;

/**
 * Computes an IPFS CID v1 for the given ArrayBuffer.
 * Uses the sha2-256 algorithm.
 *
 * @param buffer The data as an ArrayBuffer.
 * @returns A Promise that resolves to the CID (as a string).
 */
export function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  return sha256.digest(new Uint8Array(buffer)).then((digest: any) => {
    const cid = CID.create(1, sha256.code, digest);
    return cid.toString();  // Returns a base32 string by default.
  });
}
