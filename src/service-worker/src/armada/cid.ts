import {CID} from 'multiformats';
import {sha256} from 'multiformats/hashes/sha2';

/**
 * Compute an IPFS CID v1 for the given data.
 *
 * Uses SHA2-256 as the digest algorithm.
 *
 * @param buffer The asset data as an ArrayBuffer.
 * @returns A Promise that resolves to the CID string.
 */
export async function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  // multiformats sha256.digest requires a Uint8Array.
  const digest = await sha256.digest(new Uint8Array(buffer));
  const cid = CID.create(1, sha256.code, digest);
  return cid.toString();  // Defaults to base32 encoding.
}
