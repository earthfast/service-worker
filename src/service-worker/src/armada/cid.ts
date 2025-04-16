import {CID} from '../../../../vendor/multiformats/src/cid';
import * as rawCodec from '../../../../vendor/multiformats/src/codecs/raw';
import {sha256} from '../../../../vendor/multiformats/src/hashes/sha2';

/**
 * Computes IPFS CID v1 for content
 * Uses the official IPFS implementation (vendored)
 */
export async function computeCIDv1(
    content: ArrayBuffer, _subtleCrypto?: SubtleCrypto): Promise<string> {
  // Convert ArrayBuffer to Uint8Array for multiformats
  const contentBytes = new Uint8Array(content);

  // Hash the content
  const hash = await sha256.digest(contentBytes);

  // Create CID
  const cid = CID.create(1, rawCodec.code, hash);

  // Return as string
  return cid.toString();
}
