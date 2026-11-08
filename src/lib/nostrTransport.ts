import { buffer, concat } from './protocol';
const prefix = new TextEncoder().encode('%OMS-NOSTR-');
const marker = concat(prefix, new Uint8Array([1]));
const hex = (s: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error('Invalid Nostr metadata');
  return Uint8Array.from(s.match(/../g)!, b => parseInt(b, 16));
};
const aad = (topic: string, pubkey: string, time: number): Uint8Array => {
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid Nostr timestamp');
  const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(time));
  return concat(marker, hex(topic), hex(pubkey), b);
};
export async function encryptTransport(plain: string, psk: Uint8Array, topic: string, pubkey: string, time: number): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(plain); if (psk.length !== 32 || bytes.length > 1048576) throw new Error('Invalid Nostr payload');
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', buffer(psk), 'AES-GCM', false, ['encrypt']);
  return concat(marker, nonce, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(nonce), additionalData: buffer(aad(topic, pubkey, time)) }, key, buffer(bytes))));
}
export async function decryptTransport(bytes: Uint8Array, psk: Uint8Array, topic: string, pubkey: string, time: number, now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (time < now - 60 || time > now + 30) throw new Error('Nostr event outside freshness window');
  if (psk.length !== 32 || bytes.length < marker.length + 28 || bytes.length > 1048576 + marker.length + 28 || !marker.every((v, i) => bytes[i] === v)) throw new Error('Unsupported Nostr transport');
  const nonce = bytes.slice(marker.length, marker.length + 12), cipher = bytes.slice(marker.length + 12);
  const key = await crypto.subtle.importKey('raw', buffer(psk), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder('utf-8', { fatal: true }).decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(nonce), additionalData: buffer(aad(topic, pubkey, time)) }, key, buffer(cipher)));
}
export class ReplayWindow {
  private seen = new Map<string, number>();
  constructor(private readonly storageKey: string) {}
  accept(id: string, time: number, now = Math.floor(Date.now() / 1000)): boolean {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id || '') || time < now - 60 || time > now + 30) return false;
    // Persist before dispatch. A storage failure rejects the operation.
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) this.seen = new Map(JSON.parse(stored));
      for (const [key, expiry] of this.seen) if (expiry <= now) this.seen.delete(key);
      if (this.seen.has(id) || this.seen.size >= 4096) return false;
      this.seen.set(id, time + 61); localStorage.setItem(this.storageKey, JSON.stringify([...this.seen])); return true;
    } catch { return false; }
  }
  clear(): void { localStorage.removeItem(this.storageKey); this.seen.clear(); }
}
