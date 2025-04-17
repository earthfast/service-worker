import {CID} from 'multiformats';
import {sha256} from 'multiformats/hashes/sha2';

export async function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  const digest = await sha256.digest(new Uint8Array(buffer));
  const cid = CID.create(1, sha256.code, digest);
  return cid.toString();
}
