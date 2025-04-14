/**
 * Utility functions for IPFS CID calculation without external dependencies
 */

/**
 * Computes IPFS CID v1 using built-in crypto APIs
 *
 * @param content - Content to hash
 * @param subtleCrypto - SubtleCrypto API instance
 * @returns CID v1 string
 */
export async function computeCIDv1(
    content: ArrayBuffer, subtleCrypto: SubtleCrypto): Promise<string> {
  // 1. Calculate SHA-256 hash using SubtleCrypto
  const hashBuffer = await subtleCrypto.digest('SHA-256', content);
  const hashArray = new Uint8Array(hashBuffer);

  // 2. Construct the CID v1 manually
  // CID v1 format: 0x01 + codec code (0x55 for raw) + hash function code (0x12 for sha2-256) + hash
  // length (0x20 = 32) + hash bytes

  // Create the multihash (hash function code + length + digest)
  const multihash = new Uint8Array(34);  // 2 bytes header + 32 bytes digest
  multihash[0] = 0x12;                   // sha2-256 hash function code
  multihash[1] = 0x20;                   // 32 bytes length
  multihash.set(hashArray, 2);           // Insert the actual hash

  // Create the complete CID
  const cid = new Uint8Array(36);  // 1 byte version + 1 byte codec + 34 bytes multihash
  cid[0] = 0x01;                   // CID version 1
  cid[1] = 0x55;                   // raw codec
  cid.set(multihash, 2);           // Insert the multihash

  // 3. Encode the CID as a base32 string
  return 'b' + base32Encode(cid);
}

/**
 * Simple base32 encoder for CID conversion
 *
 * @param bytes - Bytes to encode
 * @returns Base32 encoded string
 */
function base32Encode(bytes: Uint8Array): string {
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      result += ALPHABET[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += ALPHABET[(value << (5 - bits)) & 31];
  }

  return result;
}
