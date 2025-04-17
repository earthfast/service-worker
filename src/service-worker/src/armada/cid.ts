import {CID} from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import {sha256} from 'multiformats/hashes/sha2';

export async function computeCidV1(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, raw.code, hash);
  return cid.toString();
}
