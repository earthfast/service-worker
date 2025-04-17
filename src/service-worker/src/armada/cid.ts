import {CID} from 'multiformats';
import {sha256} from 'multiformats/hashes/sha2';
// Import the type for clarity.
import type {MultihashDigest} from 'multiformats/hashes/interface';

/**
 * Computes an IPFS CID v1 for the given asset data.
 *
 * Uses the sha2-256 digest algorithm.
 *
 * @param buffer - The asset data as an ArrayBuffer.
 * @returns A Promise resolving to the computed CID string.
 */
export async function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  // Await the digest. Make sure the result conforms to MultihashDigest<18>
  const digestRaw = await sha256.digest(new Uint8Array(buffer));
  // Sometimes the returned value's type is not exactly what we need; we can force a type assertion:
  const digest = digestRaw as unknown as MultihashDigest<18>;
  // Create the CID v1 using the digest and sha256's code.
  const cid = CID.create(1, sha256.code, digest);
  return cid.toString();  // Typically a base32 string.
}
