import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as p from '../src/lib/protocol';
import { getFingerprint, decryptEnvelope, parseRsaAesEnvelope, createEncryptedMessage } from '../src/lib/crypto';
import { encryptVaultData } from '../src/lib/fileEncryption';
import { DEFAULT_SETTINGS } from '../src/lib/constants';
import { decryptTransport, ReplayWindow } from '../src/lib/nostrTransport';
import { NostrSession } from '../src/lib/nostrUtil';
import { verifyEvent } from 'nostr-tools/pure';
const fixture = JSON.parse(readFileSync(process.env.OMS_FIXTURES!, 'utf8'));
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'));
const privateKey = await crypto.subtle.importKey('pkcs8', p.buffer(b64(fixture.privateKey)), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
const publicKey = await crypto.subtle.importKey('spki', p.buffer(b64(fixture.publicKey)), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
async function open(bytes: Uint8Array) {
  const { header, records } = p.readHeader(bytes);
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, p.buffer(header.wrappedKey));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  return { header, records, key, plain: await p.decryptRecords(header, key, records) };
}

class TestSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: TestSocket[] = [];
  readyState = TestSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) { TestSocket.instances.push(this); }
  open() { this.readyState = TestSocket.OPEN; this.onopen?.(); }
  close() { this.readyState = TestSocket.CLOSED; this.onclose?.(); }
  send(text: string) {
    assert.equal(this.readyState, TestSocket.OPEN, 'must not send to a closed relay');
    this.sent.push(text);
  }
}

function mockSockets(t: TestContext) {
  const original = globalThis.WebSocket;
  TestSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: TestSocket });
  t.after(() => Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: original }));
}

test('restored Nostr credentials stay offline until a send and wait for a connected relay', async t => {
  mockSockets(t);
  const topic = '11'.repeat(32), psk = new Uint8Array(32).fill(22);
  const session = new NostrSession(topic, psk, ['wss://relay.example']);
  t.after(() => session.destroy());
  assert.equal(TestSocket.instances.length, 0);
  let finished = false;
  const sending = session.sendRequest('test secret').then(() => { finished = true; });
  assert.equal(TestSocket.instances.length, 1);
  await Promise.resolve();
  assert.equal(finished, false);
  session.start();
  assert.equal(TestSocket.instances.length, 1, 'starting twice must not create duplicate sockets');
  const socket = TestSocket.instances[0];
  socket.open();
  await sending;
  const published = socket.sent.map(text => JSON.parse(text)).find(message => message[0] === 'EVENT')?.[1];
  assert.ok(published);
  assert.ok(verifyEvent(published));
  const content = JSON.parse(await decryptTransport(b64(published.content), psk, topic, published.pubkey, published.created_at));
  assert.equal(content.type, 'request');
  assert.equal(content.payload, 'test secret');
});

test('cancelling Nostr closes connecting sockets and rejects pending sends without reconnecting', async t => {
  mockSockets(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = new NostrSession('11'.repeat(32), new Uint8Array(32), ['wss://relay.example']);
  const rejected = assert.rejects(session.sendRequest('not sent'), /disconnected/);
  const socket = TestSocket.instances[0];
  session.destroy();
  await rejected;
  assert.equal(socket.readyState, TestSocket.CLOSED);
  t.mock.timers.tick(60000);
  assert.equal(TestSocket.instances.length, 1);
  assert.equal(socket.sent.length, 0);
});

test('unreachable Nostr relays have bounded retries and cannot report a message as sent', async t => {
  mockSockets(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors: Error[] = [];
  const session = new NostrSession('11'.repeat(32), new Uint8Array(32), ['wss://one.example', 'wss://two.example'], 120, { onError: error => errors.push(error) });
  t.after(() => session.destroy());
  session.start();
  for (const delay of [3000, 6000, 12000]) {
    for (const socket of TestSocket.instances.filter(s => s.readyState === TestSocket.CONNECTING)) socket.close();
    t.mock.timers.tick(delay);
  }
  for (const socket of TestSocket.instances.filter(s => s.readyState === TestSocket.CONNECTING)) socket.close();
  assert.equal(session.getStatus(), 'error');
  assert.equal(errors.length, 1);
  assert.equal(TestSocket.instances.length, 8);
  t.mock.timers.tick(60000);
  assert.equal(TestSocket.instances.length, 8, 'failed relays must not be retried forever');
  const rejected = assert.rejects(session.sendRequest('not sent'), /No Nostr relay is reachable/);
  t.mock.timers.tick(10000);
  await rejected;
  assert.ok(TestSocket.instances.every(socket => socket.sent.every(text => JSON.parse(text)[0] !== 'EVENT')));
});
test('Java RSA text and multi-chunk file decrypt in WebCrypto', async () => {
  for (const [name, app, body] of [['rsaText', 8, 'textBody'], ['rsaFile', 3, 'fileBody']] as const) {
    const bytes = b64(fixture[name]), result = await open(bytes);
    assert.deepEqual(p.readApplication(result.plain, app).body, b64(fixture[body]));
    assert.deepEqual(p.decodeText(p.encodeText(bytes)), bytes);
    assert.deepEqual(result.header.fingerprint, await getFingerprint(publicKey));
  }
});
test('control responses require the pending request, expected mode and exact framing', () => {
  const id = crypto.getRandomValues(new Uint8Array(16)), key = crypto.getRandomValues(new Uint8Array(32));
  const reply = p.control(5, p.concat(id, new Uint8Array([1]), p.blob(key)));
  assert.deepEqual(p.readReply(reply, id, true), key);
  assert.throws(() => p.readReply(reply, id, false));
  const wrong = id.slice(); wrong[0] ^= 1;
  assert.throws(() => p.readReply(reply, wrong, true));
  assert.throws(() => p.readReply(p.concat(reply, new Uint8Array([0])), id, true));
  assert.throws(() => p.readReply(reply.slice(0, -1), id, true));
  assert.throws(() => p.readReply(p.control(5, p.concat(id, new Uint8Array([1]), p.blob(new Uint8Array(31)))), id, true));
});
test('production message and export writers use v1 despite legacy settings', async () => {
  const settings = { ...DEFAULT_SETTINGS, publicKey: fixture.publicKey, rsaTransformationIdx: 0, aesTransformationIdx: 0, aesKeyLength: 128 };
  const text = await createEncryptedMessage('production writer', settings);
  assert.equal(text.startsWith('oms00_'), false);
  assert.equal(new TextDecoder().decode(p.readApplication((await open(p.decodeText(text)!)).plain, 8).body), 'production writer');
  const exported = await encryptVaultData(b64(fixture.vaultJson), settings);
  assert.deepEqual(p.readApplication((await open(exported)).plain, 3).body, b64(fixture.vaultJson));
});
test('tampered headers, records, order, truncation, completion and trailing bytes fail', async () => {
  const bytes = b64(fixture.rsaFile), { header, key, records } = await open(bytes);
  const tampered = records.slice(); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(p.decryptRecords(header, key, tampered));
  await assert.rejects(p.decryptRecords(header, key, records.slice(0, -21)));
  await assert.rejects(p.decryptRecords(header, key, records.slice(0, -1)));
  await assert.rejects(p.decryptRecords(header, key, p.concat(records, new Uint8Array([0]))));
  const first = new DataView(p.buffer(records)).getUint32(0) + 5;
  const second = new DataView(p.buffer(records.slice(first))).getUint32(0) + 5;
  await assert.rejects(p.decryptRecords(header, key, p.concat(records.slice(first, first + second), records.slice(0, first), records.slice(first + second))));
  const modified = bytes.slice(); modified[9] ^= 1;
  await assert.rejects(p.decryptRecords(p.readHeader(modified).header, key, records));
  const future = bytes.slice(); future[5] = 2; assert.throws(() => p.decodeText(p.encodeText(future)));
  assert.equal(p.decodeText(Buffer.from('ordinary text').toString('base64')), null);
  assert.throws(() => p.readApplication(new Uint8Array([0, 8, 0, 2])));
});
test('Java password backup preserves 600000 iterations and non-ASCII passphrase', async () => {
  const { header, records } = p.readHeader(b64(fixture.backupV1)); assert.equal(header.iterations, 600000);
  const source = await crypto.subtle.importKey('raw', new TextEncoder().encode(fixture.password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: p.buffer(header.salt), iterations: header.iterations, hash: 'SHA-256' }, source, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const body = p.readApplication(await p.decryptRecords(header, key, records), 0).body, r = new p.Reader(body);
  assert.equal(new TextDecoder().decode(r.blob()), 'fixture – 🔐');
  assert.deepEqual(r.blob(), b64(fixture.privateKey)); assert.deepEqual(r.blob(), b64(fixture.publicKey)); r.end();
});
test('legacy Java CBC and historical double-padded PWA vaults remain readable', async () => {
  const key = await crypto.subtle.importKey('raw', p.buffer(b64(fixture.legacyVaultKey)), 'AES-CBC', false, ['decrypt']);
  for (const name of ['legacyVault', 'legacyPwaVault']) assert.deepEqual(await decryptEnvelope(parseRsaAesEnvelope(b64(fixture[name])), key), b64(fixture.vaultJson));
});
test('Nostr metadata binding, freshness, replay and persisted replay state', async () => {
  const bytes = b64(fixture.nostr), psk = b64(fixture.psk), time = Number(fixture.timestamp);
  assert.equal(await decryptTransport(bytes, psk, fixture.topic, fixture.sender, time, time), new TextDecoder().decode(b64(fixture.textBody)));
  await assert.rejects(decryptTransport(bytes, psk, fixture.topic, '33'.repeat(32), time, time));
  await assert.rejects(decryptTransport(bytes, psk, fixture.topic, fixture.sender, time + 1, time));
  await assert.rejects(decryptTransport(bytes, psk, fixture.topic, fixture.sender, time, time + 61));
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k), setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  const id = crypto.randomUUID(), replay = new ReplayWindow('fixture');
  assert.equal(replay.accept(id, time, time), true); assert.equal(replay.accept(id, time, time), false);
  assert.equal(new ReplayWindow('fixture').accept(id, time, time), false);
  assert.equal(replay.accept(crypto.randomUUID(), time + 31, time), false);
});
test('WebCrypto creates text and multi-chunk fixtures for the JVM reader', async () => {
  const fingerprint = await getFingerprint(publicKey);
  const text = await p.seal(publicKey, fingerprint, 8, b64(fixture.textBody));
  const file = await p.seal(publicKey, fingerprint, 3, b64(fixture.fileBody));
  assert.deepEqual(p.readApplication((await open(text.bytes)).plain, 8).body, b64(fixture.textBody));
  assert.deepEqual(p.readApplication((await open(file.bytes)).plain, 3).body, b64(fixture.fileBody));
  if (process.env.OMS_INTEROP_OUT) writeFileSync(process.env.OMS_INTEROP_OUT, JSON.stringify({ ...fixture, rsaText: Buffer.from(text.bytes).toString('base64'), rsaFile: Buffer.from(file.bytes).toString('base64') }, null, 2));
});
