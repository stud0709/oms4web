/** OMS v1 wire codec; see docs/protocol-v1.md and shared interoperability fixtures. */
import { bytesToBase64 } from './base64';

export const MAGIC = new TextEncoder().encode('%OMS-');
export const CHUNK_SIZE = 65536;
export const MAX_BLOB = 1048576;
export interface ProtocolHeader {
  kind: number; encoded: Uint8Array; noncePrefix: Uint8Array;
  fingerprint: Uint8Array; wrappedKey: Uint8Array; salt: Uint8Array; iterations: number;
}
export const buffer = (b: Uint8Array): ArrayBuffer => Uint8Array.from(b).buffer;
export function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const p of parts) { result.set(p, offset); offset += p.length; } return result;
}
export function u32(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Invalid unsigned integer');
  const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b;
}
export function u16(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error('Invalid unsigned short');
  const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n); return b;
}
export function blob(b: Uint8Array): Uint8Array {
  if (b.length > MAX_BLOB) throw new Error('OMS field too large'); return concat(u32(b.length), b);
}
export class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number): Uint8Array { if (n < 0 || this.offset + n > this.bytes.length) throw new Error('Truncated OMS data'); const b = this.bytes.slice(this.offset, this.offset + n); this.offset += n; return b; }
  byte(): number { return this.take(1)[0]; }
  short(): number { return new DataView(buffer(this.take(2))).getUint16(0); }
  int(): number { return new DataView(buffer(this.take(4))).getUint32(0); }
  blob(limit = MAX_BLOB): Uint8Array { const n = this.int(); if (n > limit) throw new Error('OMS field too large'); return this.take(n); }
  end(): void { if (this.offset !== this.bytes.length) throw new Error('Trailing OMS data'); }
}
export function hasMagic(b: Uint8Array): boolean { return b.length >= 5 && MAGIC.every((v, i) => b[i] === v); }
export function frame(kind: number, parameters: Uint8Array): Uint8Array {
  if (parameters.length > 2048) throw new Error('OMS header too large'); return concat(MAGIC, new Uint8Array([1, kind]), u16(parameters.length), parameters);
}
export function readHeader(bytes: Uint8Array): { header: ProtocolHeader; records: Uint8Array } {
  const r = new Reader(bytes); if (!hasMagic(r.take(5))) throw new Error('Invalid OMS magic');
  const version = r.byte(); if (version !== 1) throw new Error(`Unsupported OMS protocol version: ${version}`);
  const kind = r.byte(), size = r.short(); if (size > 2048) throw new Error('OMS header too large');
  const p = new Reader(r.take(size));
  const header: ProtocolHeader = { kind, encoded: bytes.slice(0, r.offset), fingerprint: new Uint8Array(), wrappedKey: new Uint8Array(), noncePrefix: new Uint8Array(), salt: new Uint8Array(), iterations: 0 };
  if (kind === 1) {
    header.fingerprint = p.take(32); header.wrappedKey = p.blob(1024); if (header.wrappedKey.length < 256) throw new Error('RSA keys must be at least 2048 bits'); header.noncePrefix = p.take(8);
  } else if (kind === 2) {
    header.salt = p.take(16); header.iterations = p.int(); if (header.iterations < 1 || header.iterations > 10000000) throw new Error('Unsupported PBKDF2 iteration count'); header.noncePrefix = p.take(8);
  } else if (kind !== 3 || size !== 0) throw new Error('Unsupported OMS envelope kind');
  p.end(); return { header, records: bytes.slice(r.offset) };
}
export function decodeText(text: string): Uint8Array | null {
  let clean = text.trim().replace(/[\t\r\n ]/g, ''); const legacy = clean.startsWith('oms00_'); if (legacy) clean = clean.slice(6);
  if (clean.length > MAX_BLOB * 2) throw new Error('OMS text too large');
  let b: Uint8Array; try { b = Uint8Array.from(atob(clean), c => c.charCodeAt(0)); } catch (e) { if (legacy) throw e; return null; }
  if (legacy) return b; if (!hasMagic(b)) return null; readHeader(b); return b;
}
export function encodeText(bytes: Uint8Array): string { return (hasMagic(bytes) ? '' : 'oms00_') + bytesToBase64(bytes); }
export function application(id: number, body: Uint8Array): Uint8Array { return concat(u16(id), u16(1), body); }
export function readApplication(payload: Uint8Array, expected?: number): { id: number; body: Uint8Array } {
  const r = new Reader(payload), id = r.short(), version = r.short();
  if (version !== 1) throw new Error(`Unsupported OMS application version: ${version}`);
  if (expected !== undefined && id !== expected) throw new Error('Unexpected OMS application');
  return { id, body: payload.slice(r.offset) };
}
export function control(id: number, body: Uint8Array): Uint8Array { return concat(frame(3, new Uint8Array()), application(id, body)); }
export function readReply(bytes: Uint8Array, requestId: Uint8Array, paired: boolean): Uint8Array {
  const { header, records } = readHeader(bytes);
  if (header.kind !== 3 || requestId.length !== 16) throw new Error('Not a control response');
  const { body } = readApplication(records, 5), r = new Reader(body);
  if (!r.take(16).every((v, i) => v === requestId[i])) throw new Error('Mismatched OMS response');
  if (r.byte() !== (paired ? 1 : 0)) throw new Error('Wrong OMS response mode');
  const key = r.blob(1024); r.end();
  if (paired && ![16, 24, 32].includes(key.length)) throw new Error('Invalid AES key length');
  return key;
}
async function record(mode: 'encrypt' | 'decrypt', key: CryptoKey, header: ProtocolHeader, index: number, flag: number, bytes: Uint8Array, length: number): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle[mode]({ name: 'AES-GCM', iv: buffer(concat(header.noncePrefix, u32(index))), additionalData: buffer(concat(header.encoded, u32(index), new Uint8Array([flag]), u32(length))), tagLength: 128 }, key, buffer(bytes)));
}
export async function encryptRecords(header: ProtocolHeader, key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const parts: Uint8Array[] = []; let index = 0;
  for (let offset = 0; offset < plain.length; offset += CHUNK_SIZE) {
    const b = plain.slice(offset, offset + CHUNK_SIZE), length = b.length + 16;
    if (index === 0xffffffff) throw new Error('OMS record counter exhausted');
    parts.push(u32(length), new Uint8Array([0]), await record('encrypt', key, header, index++, 0, b, length));
  }
  parts.push(u32(16), new Uint8Array([1]), await record('encrypt', key, header, index, 1, new Uint8Array(), 16)); return concat(...parts);
}
export async function decryptRecords(header: ProtocolHeader, key: CryptoKey, encrypted: Uint8Array): Promise<Uint8Array> {
  const r = new Reader(encrypted), parts: Uint8Array[] = []; let index = 0;
  while (true) {
    const length = r.int(), flag = r.byte();
    if ((flag === 0 && (length < 17 || length > CHUNK_SIZE + 16 || index === 0xffffffff)) || (flag === 1 && length !== 16) || flag > 1) throw new Error('Invalid OMS record');
    const plain = await record('decrypt', key, header, index++, flag, r.take(length), length);
    if (flag === 1) { r.end(); return concat(...parts); } parts.push(plain);
  }
}
export async function seal(publicKey: CryptoKey, fingerprint: Uint8Array, id: number, body: Uint8Array): Promise<{ bytes: Uint8Array; key: Uint8Array }> {
  const key = crypto.getRandomValues(new Uint8Array(32)), nonce = crypto.getRandomValues(new Uint8Array(8));
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, buffer(key)));
  const encoded = frame(1, concat(fingerprint, blob(wrapped), nonce)), { header } = readHeader(encoded);
  const aes = await crypto.subtle.importKey('raw', buffer(key), 'AES-GCM', false, ['encrypt']);
  return { bytes: concat(encoded, await encryptRecords(header, aes, application(id, body))), key };
}
