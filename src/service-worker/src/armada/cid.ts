/**
 * Compute an IPFS CID v1 for the given data.
 * This function dynamically imports the required multiformats modules so that
 * Node's ESM resolution (using the "exports" field) works properly.
 *
 * Uses SHA2-256 as the digest algorithm.
 *
 * @param buffer The data as an ArrayBuffer.
 * @returns A Promise that resolves to the computed CID string.
 */
export async function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  // Dynamically import multiformats and the SHA2 module.
  const {CID} = await import('multiformats');
  const {sha256} = await import('multiformats/hashes/sha2');

  // Compute the digest for the data.
  const digest = await sha256.digest(new Uint8Array(buffer));

  // Create a CID v1 using the digest.
  const cid = CID.create(1, sha256.code, digest);

  // Return the CID as a string (default base32 encoding).
  return cid.toString();
}