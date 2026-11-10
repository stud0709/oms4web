import { encryptTransport, decryptTransport, ReplayWindow } from './nostrTransport';
import { decodeText, concat, u32, u16, blob, readApplication, Reader } from './protocol';
/**
 * Nostr Transport & Pairing Utilities for oms4web
 * 
 * PSK-Authenticated & Encrypted Nostr Pairing:
 * 1. Topic & 256-bit PSK generation; pairing message serialization (App ID 10)
 * 2. Multi-relay WebSocket connection & subscription (Kind 25000, #t tag filter)
 * 3. AES-256-GCM symmetric authenticated encryption for all event payloads using PSK
 * 4. Versioned transport authenticates topic, sender and timestamp; see docs/protocol-v1.md
 * 5. Automatic resilient WebSocket reconnection
 * 6. One-shot {"type": "paired"} handshake and encrypted request/response correlation
 */

import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import { AppSettings } from '@/types/types';
import {
  writeUnsignedShort,
  writeByteArray,
  readByteArray,
  readUnsignedShort,
  concatArrays,
  writeString,
  toArrayBuffer,
  createEncryptedMessage,
} from './crypto';
import { bytesToBase64 } from './base64';
import {
  APPLICATION_IDS,
  DEFAULT_NOSTR_RELAYS,
  DEFAULT_NOSTR_TTL,
  NOSTR_EVENT_KIND,
  OMS_PREFIX,
} from './constants';

export interface NostrPairingData {
  topicHex: string;
  psk: Uint8Array;
  ttl: number;
  relays: string[];
}

export type NostrSessionStatus =
  | 'connecting'
  | 'listening'
  | 'peer_connected'
  | 'transmitting'
  | 'completed'
  | 'error';

export interface NostrSessionEvents {
  onStatusChange?: (status: NostrSessionStatus, detail?: string) => void;
  onPaired?: () => void;
  onRequest?: (payload: string, reqId?: string) => void;
  onResponse?: (payload: string, reqId?: string) => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onRelayStatus?: (relayUrl: string, connected: boolean) => void;
}

/**
 * Generate a cryptographically random 256-bit (32-byte) hex topic ID
 */
export function generateTopic(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a cryptographically random 256-bit (32-byte) Pre-Shared Key (PSK)
 */
export function generatePsk(): Uint8Array {
  const psk = new Uint8Array(32);
  crypto.getRandomValues(psk);
  return psk;
}

/**
 * Create the inner binary payload for Nostr pairing (topicHex, psk, ttl, relays)
 */
export function createNostrPairingPayloadBytes(
  topicHex: string,
  psk: Uint8Array,
  relays: string[] = DEFAULT_NOSTR_RELAYS,
  ttl: number = DEFAULT_NOSTR_TTL
): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(topicHex) || psk.length !== 32 || ttl < 1 || ttl > 86400 || relays.length < 1 || relays.length > 32) throw new Error('Invalid pairing parameters');
  const topic = Uint8Array.from(topicHex.match(/../g)!, b => parseInt(b, 16));
  const urls = relays.map(relay => { const url = new URL(relay); if (url.protocol !== 'wss:' || url.username || url.password || !url.hostname || new TextEncoder().encode(relay).length > 2048) throw new Error('Invalid relay URL'); return blob(new TextEncoder().encode(relay)); });
  const payload = concat(new Uint8Array([1]), topic, psk, u32(ttl), u32(86400), u16(relays.length), ...urls);
  if (payload.length > 65536) throw new Error('Pairing payload too large');
  return payload;
    }

/**
 * Serialize and encrypt a Nostr pairing message.
 * When settings with a valid Master RSA Public Key is provided, wraps in APPLICATION_RSA_AES_GENERIC (6)
 * with inner APPLICATION_NOSTR_PAIRING (10).
 */
export async function createNostrPairingMessage(
  topicHex: string,
  psk: Uint8Array,
  relays: string[] = DEFAULT_NOSTR_RELAYS,
  ttl: number = DEFAULT_NOSTR_TTL,
  settings?: AppSettings
): Promise<string> {
  const innerPayload = createNostrPairingPayloadBytes(topicHex, psk, relays, ttl);

  if (settings?.publicKey) {
    return await createEncryptedMessage(innerPayload, settings, APPLICATION_IDS.NOSTR_PAIRING);
  }

  throw new Error('An RSA public key is required for pairing');
}

/**
 * Parse a decrypted application-10 payload (not an encrypted envelope)
 */
export function parseNostrPairingMessage(input: Uint8Array | string): NostrPairingData {
  const data = typeof input === 'string' ? decodeText(input) : input;
  if (!data) throw new Error('Not an OMS message');
  const { body } = readApplication(data, APPLICATION_IDS.NOSTR_PAIRING), r = new Reader(body);
  if (r.byte() !== 1) throw new Error('Recreate pairing with updated clients');
  const topicHex = Array.from(r.take(32), b => b.toString(16).padStart(2, '0')).join(''), psk = r.take(32), ttl = r.int(), sessionTtl = r.int(), count = r.short();
  if (ttl < 1 || ttl > 86400 || sessionTtl < 1 || sessionTtl > 604800 || count < 1 || count > 32) throw new Error('Invalid pairing parameters');
  const relays = Array.from({ length: count }, () => new TextDecoder().decode(r.blob(2048))); r.end();
  return { topicHex, psk, ttl, relays };
    }

/**
 * Robust Nostr Session Manager for oms4web
 * Handles PSK-encrypted multi-relay WebSocket connections, reconnects, message publishing, and filtering.
 */
export class NostrSession {
  public readonly topicHex: string;
  public readonly psk: Uint8Array;
  public readonly relays: string[];
  public readonly ttl: number;

  private secretKey: Uint8Array;
  public readonly publicKey: string;

  private sockets: Map<string, WebSocket> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private subId: string;
  private status: NostrSessionStatus = 'connecting';
  private events: NostrSessionEvents;

  private isDestroyed = false;
  private isStarted = false;
  private connectionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<string, number>();
  private connectionWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  private replay: ReplayWindow;
  private pendingRequests = new Map<string, number>();

  constructor(
    topicHex: string,
    psk: Uint8Array,
    relays: string[] = DEFAULT_NOSTR_RELAYS,
    ttl: number = DEFAULT_NOSTR_TTL,
    events: NostrSessionEvents = {},
    existingSecretKey?: Uint8Array
  ) {
    this.topicHex = topicHex;
    this.replay = new ReplayWindow(`oms4web_nostr_replay_${topicHex}`);
    this.psk = psk;
    this.relays = relays.length > 0 ? relays : DEFAULT_NOSTR_RELAYS;
    this.ttl = ttl > 0 ? ttl : DEFAULT_NOSTR_TTL;
    this.events = events;

    this.secretKey = existingSecretKey || generateSecretKey();
    this.publicKey = getPublicKey(this.secretKey);
    this.subId = 'oms_' + Math.random().toString(36).substring(2, 10);
  }

  public getSecretKey(): Uint8Array {
    return this.secretKey;
  }

  public getStatus(): NostrSessionStatus {
    return this.status;
  }

  private setStatus(status: NostrSessionStatus, detail?: string) {
    if (this.isDestroyed || this.status === status) return;
    this.status = status;
    this.events.onStatusChange?.(status, detail);
  }

  /**
   * Connect to all configured relays and subscribe to the topic filter
   */
  public start(): void {
    if (this.isDestroyed || this.isStarted) return;
    this.isStarted = true;

    this.setStatus('connecting');

    for (const relayUrl of this.relays) {
      this.connectRelay(relayUrl);
    }
  }

  private connectRelay(relayUrl: string): void {
    if (this.isDestroyed) return;

    try {
      const ws = new WebSocket(relayUrl);
      this.sockets.set(relayUrl, ws);
      this.connectionTimers.set(relayUrl, setTimeout(() => {
        if (this.sockets.get(relayUrl) === ws && ws.readyState === WebSocket.CONNECTING) ws.close();
      }, 10000));

      ws.onopen = () => {
        if (this.isDestroyed) {
          ws.close();
          return;
        }
        clearTimeout(this.connectionTimers.get(relayUrl));
        this.connectionTimers.delete(relayUrl);
        this.reconnectAttempts.delete(relayUrl);
        this.events.onRelayStatus?.(relayUrl, true);

        // Subscribe to topic filter ["REQ", subId, {"kinds": [25000], "#t": [topic]}]
        const filter = {
          kinds: [NOSTR_EVENT_KIND],
          '#t': [this.topicHex],
        };
        const reqMsg = JSON.stringify(['REQ', this.subId, filter]);
        ws.send(reqMsg);

        if (this.status === 'connecting' || this.status === 'error') {
          this.setStatus('listening', 'Connected to relay');
        }
        for (const waiter of this.connectionWaiters) waiter.resolve();
      };

      ws.onmessage = (event) => {
        if (this.isDestroyed) return;
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data) && data[0] === 'EVENT' && data[1] === this.subId) {
            const nostrEvent: NostrEvent = data[2];
            this.handleInboundEvent(nostrEvent);
          }
        } catch (err) {
          console.warn(`[NostrSession] Failed to parse relay message from ${relayUrl}:`, err);
        }
      };

      ws.onerror = (err) => {
        if (this.isDestroyed) return;
        console.warn(`[NostrSession] WebSocket error on ${relayUrl}:`, err);
        this.events.onRelayStatus?.(relayUrl, false);
      };

      ws.onclose = () => {
        clearTimeout(this.connectionTimers.get(relayUrl));
        this.connectionTimers.delete(relayUrl);
        if (this.isDestroyed) return;
        this.events.onRelayStatus?.(relayUrl, false);
        this.sockets.delete(relayUrl);

        this.scheduleReconnect(relayUrl);
      };
    } catch (err) {
      console.warn(`[NostrSession] Failed to connect to ${relayUrl}:`, err);
      this.events.onRelayStatus?.(relayUrl, false);
      this.scheduleReconnect(relayUrl);
    }
  }

  private scheduleReconnect(relayUrl: string): void {
    if (this.isDestroyed) return;
    const attempts = this.reconnectAttempts.get(relayUrl) ?? 0;
    if (attempts < 3) {
      this.reconnectAttempts.set(relayUrl, attempts + 1);
      this.reconnectTimers.set(relayUrl, setTimeout(() => {
        this.reconnectTimers.delete(relayUrl);
        this.connectRelay(relayUrl);
      }, 3000 * 2 ** attempts));
    }
    if (this.sockets.size === 0 && this.reconnectTimers.size === 0) {
      const error = new Error('Cannot connect to the configured Nostr relays. Check your network or choose another relay in Settings.');
      this.setStatus('error', error.message);
      this.events.onError?.(error);
      for (const waiter of this.connectionWaiters) waiter.reject(error);
    }
  }

  /** A restored pairing stays offline until an explicit send/unlock action. */
  private async waitForRelay(): Promise<void> {
    if (this.isDestroyed) throw new Error('Nostr session disconnected');
    if ([...this.sockets.values()].some(ws => ws.readyState === WebSocket.OPEN)) return;
    if (this.status === 'error') {
      // A new user action may retry a previously exhausted connection attempt.
      this.isStarted = false;
      this.reconnectAttempts.clear();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        resolve: () => { clearTimeout(timer); this.connectionWaiters.delete(waiter); resolve(); },
        reject: (error: Error) => { clearTimeout(timer); this.connectionWaiters.delete(waiter); reject(error); },
      };
      const timer = setTimeout(() => waiter.reject(new Error('No Nostr relay is reachable. Check your network or choose another relay in Settings.')), 10000);
      this.connectionWaiters.add(waiter);
      this.start();
    });
  }

  /**
   * Handle an incoming Nostr event received from relays
   */
  private async handleInboundEvent(event: NostrEvent): Promise<void> {
    if (!event || this.isDestroyed || !Array.isArray(event.tags) || typeof event.content !== 'string' || !Number.isSafeInteger(event.created_at)) return;

    // Ignore events sent by ourselves (echoed back by relays)
    if (event.pubkey && event.pubkey.toLowerCase() === this.publicKey.toLowerCase()) return;

    // Topic matching
    const topicTag = event.tags.find(t => Array.isArray(t) && t[0] === 't')?.[1];
    if (!topicTag || topicTag.toLowerCase() !== this.topicHex.toLowerCase()) return;

    const now = Math.floor(Date.now() / 1000);
    if (event.kind !== NOSTR_EVENT_KIND || event.content.length > 1500000 || event.created_at < now - 60 || event.created_at > now + 30 || !verifyEvent(event)) return;
    try {
      const combined = Uint8Array.from(atob(event.content), c => c.charCodeAt(0));
      const decryptedPlaintext = await decryptTransport(combined, this.psk, this.topicHex, event.pubkey, event.created_at);
      if (this.isDestroyed) return;
      const parsedMsg = JSON.parse(decryptedPlaintext);
      if (parsedMsg.v !== 1 || !this.replay.accept(parsedMsg.msg_id, event.created_at)) return;

      switch (parsedMsg.type) {
        case 'paired':
          if (this.status !== 'peer_connected') {
            this.setStatus('peer_connected', 'Peer paired via PSK');
          }
          this.events.onPaired?.();
          break;

        case 'request':
          this.setStatus('transmitting', 'Received request payload');
          this.events.onRequest?.(parsedMsg.payload || '', parsedMsg.req_id);
          break;

        case 'response':
          if (!parsedMsg.reply_to || !this.pendingRequests.has(parsedMsg.reply_to)) return;
          if (this.pendingRequests.get(parsedMsg.reply_to) < Date.now()) { this.pendingRequests.delete(parsedMsg.reply_to); return; }
          this.pendingRequests.delete(parsedMsg.reply_to);
          this.setStatus('peer_connected', 'Received response payload');
          this.events.onResponse?.(parsedMsg.payload || '', parsedMsg.reply_to || parsedMsg.req_id);
          break;

        case 'disconnect':
          this.events.onDisconnect?.();
          this.setStatus('completed', 'Peer disconnected');
          break;

        default:
          break;
      }
    } catch (err) {
      console.warn('[NostrSession] Failed to decrypt or process event payload:', err);
    }
  }

  /**
   * Publish a PSK-encrypted Nostr Kind 25000 event to all connected relays
   */
  public async publishEncrypted(jsonPayload: object): Promise<NostrEvent | null> {
    if (this.isDestroyed) return null;

    try {
      await this.waitForRelay();
      const plaintext = JSON.stringify({ ...jsonPayload, v: 1, msg_id: crypto.randomUUID() });
      const timestamp = Math.floor(Date.now() / 1000);
      const encryptedContent = bytesToBase64(await encryptTransport(plaintext, this.psk, this.topicHex, this.publicKey, timestamp));

      const eventTemplate = {
        kind: NOSTR_EVENT_KIND,
        created_at: timestamp,
        tags: [
          ['t', this.topicHex],
        ],
        content: encryptedContent,
      };

      const finalizedEvent = finalizeEvent(eventTemplate, this.secretKey);

      const eventMsg = JSON.stringify(['EVENT', finalizedEvent]);

      let sent = false;
      for (const [url, ws] of this.sockets.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(eventMsg);
            sent = true;
          } catch (err) {
            console.warn(`[NostrSession] Failed to send event to ${url}:`, err);
          }
        }
      }

      if (!sent) throw new Error('No connected Nostr relay could accept the message');
      return finalizedEvent;
    } catch (err) {
      console.error('[NostrSession] Failed to publish encrypted event:', err);
      return null;
    }
  }

  public async sendRequest(payload: string, reqId?: string): Promise<void> {
    await this.waitForRelay();
    this.setStatus('transmitting', 'Sending request payload');
    const id = reqId || crypto.randomUUID();
    for (const [key, expiry] of this.pendingRequests) if (expiry < Date.now()) this.pendingRequests.delete(key);
    this.pendingRequests.set(id, Date.now() + this.ttl * 1000);
    const sent = await this.publishEncrypted({
      type: 'request',
      req_id: id,
      payload,
    });
    if (!sent) { this.pendingRequests.delete(id); throw new Error('Nostr request could not be sent. Check the relay connection.'); }
  }

  public async sendResponse(payload: string, replyTo?: string): Promise<void> {
    this.setStatus('transmitting', 'Sending response payload');
    await this.publishEncrypted({
      type: 'response',
      reply_to: replyTo,
      payload,
    });
  }

  public async sendDisconnect(): Promise<void> {
    await this.publishEncrypted({
      type: 'disconnect',
    });
  }

  /**
   * Gracefully close subscriptions, WebSockets, and clear timers
   */
  public destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;

    for (const waiter of this.connectionWaiters) waiter.reject(new Error('Nostr session disconnected'));
    for (const timer of this.connectionTimers.values()) clearTimeout(timer);
    this.connectionTimers.clear();

    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    const closeMsg = JSON.stringify(['CLOSE', this.subId]);
    for (const ws of this.sockets.values()) {
      try {
        ws.onclose = null;
        ws.onerror = null;
        if (ws.readyState === WebSocket.OPEN) ws.send(closeMsg);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch (err) {
        console.warn('[NostrSession] Error while closing socket:', err);
      }
    }
    this.sockets.clear();
  }
}
