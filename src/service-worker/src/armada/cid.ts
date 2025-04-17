import {CID} from 'multiformats';
import {sha256} from 'multiformats/hashes/sha2';

/**
 * Computes an IPFS CID v1 for the given asset data (as an ArrayBuffer)
 * using the sha2-256 digest.
 *
 * @param buffer – The asset data as an ArrayBuffer.
 * @returns A Promise that resolves to the computed CID string.
 */
export async function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  // Await the hash digest.
  const digest = await sha256.digest(new Uint8Array(buffer));
  // Create the CID v1; the digest must be of the proper type.
  const cid = CID.create(1, sha256.code, digest);
  return cid.toString();  // Typically returns a base32 string.
}
