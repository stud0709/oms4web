/**
 * Nostr Transport & Pairing Utilities for oms4web
 * 
 * Aligned with oms_companion (Java) implementation:
 * 1. Topic generation & pairing message serialization matching OmsDataOutputStream (App ID 10)
 * 2. Multi-relay WebSocket connection & subscription (Kind 25000, #t tag filter)
 * 3. Ephemeral Schnorr keypair signing (via nostr-tools/pure)
 * 4. Ping/pong heartbeats (30s interval), request/response exchange (with req_id/reply_to tags),
 *    and graceful disconnect propagation
 */

import { generateSecretKey, getPublicKey, finalizeEvent, type Event as NostrEvent } from 'nostr-tools/pure';
import {
  writeUnsignedShort,
  writeByteArray,
  readByteArray,
  readUnsignedShort,
  concatArrays,
  writeString,
} from './crypto';
import { bytesToBase64 } from './base64';
import {
  APPLICATION_IDS,
  DEFAULT_NOSTR_HEARTBEAT_INTERVAL_MS,
  DEFAULT_NOSTR_RELAYS,
  DEFAULT_NOSTR_TTL,
  NOSTR_EVENT_KIND,
  OMS_PREFIX,
} from './constants';

export interface NostrPairingData {
  topicHex: string;
  ttl: number;
  relays: string[];
}

export type NostrSessionStatus =
  | 'connecting'
  | 'listening'
  | 'peer_connected'
  | 'transmitting'
  | 'completed'
  | 'timeout'
  | 'error';

export interface NostrSessionEvents {
  onStatusChange?: (status: NostrSessionStatus, detail?: string) => void;
  onPing?: () => void;
  onPong?: () => void;
  onRequest?: (payload: string, reqId?: string) => void;
  onResponse?: (payload: string, reqId?: string) => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onRelayStatus?: (relayUrl: string, connected: boolean) => void;
  onTtlTick?: (remainingSeconds: number) => void;
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
 * Serialize a Nostr pairing message matching OmsDataOutputStream structure:
 * (1) Application ID = APPLICATION_NOSTR_PAIRING (10)
 * (2) Topic ID (hex string)
 * (3) TTL in seconds (unsigned short)
 * (4) Relay count (unsigned short)
 * (5) Relay URLs (string list)
 */
export function createNostrPairingMessage(
  topicHex: string,
  relays: string[] = DEFAULT_NOSTR_RELAYS,
  ttl: number = DEFAULT_NOSTR_TTL
): string {
  const parts: Uint8Array[] = [
    writeUnsignedShort(APPLICATION_IDS.NOSTR_PAIRING), // (1) Application ID 10
    writeString(topicHex),                             // (2) Topic hex
    writeUnsignedShort(ttl),                           // (3) TTL
    writeUnsignedShort(relays.length),                 // (4) Relay count
  ];

  for (const relay of relays) {
    parts.push(writeString(relay));                    // (5) Relay URL string
  }

  const messageBytes = concatArrays(...parts);
  return OMS_PREFIX + bytesToBase64(messageBytes);
}

/**
 * Parse a Nostr pairing message from raw bytes or oms00_ base64 string
 */
export function parseNostrPairingMessage(input: Uint8Array | string): NostrPairingData {
  let data: Uint8Array;
  if (typeof input === 'string') {
    const clean = input.startsWith(OMS_PREFIX) ? input.slice(OMS_PREFIX.length) : input;
    data = Uint8Array.from(atob(clean.replace(/\s+/g, '')), c => c.charCodeAt(0));
  } else {
    data = input;
  }

  let offset = 0;
  // (1) Application ID
  const applicationId = readUnsignedShort(data, offset);
  offset += 2;

  if (applicationId !== APPLICATION_IDS.NOSTR_PAIRING) {
    throw new Error(
      `Invalid application ID for Nostr pairing: expected ${APPLICATION_IDS.NOSTR_PAIRING}, got ${applicationId}`
    );
  }

  // (2) Topic ID
  const [topicBytes, offsetTopic] = readByteArray(data, offset);
  offset = offsetTopic;
  const topicHex = new TextDecoder().decode(topicBytes);

  // (3) TTL
  const ttl = readUnsignedShort(data, offset);
  offset += 2;

  // (4) Relay count
  const relayCount = readUnsignedShort(data, offset);
  offset += 2;

  // (5) Relays
  const relays: string[] = [];
  for (let i = 0; i < relayCount; i++) {
    const [relayBytes, offsetRelay] = readByteArray(data, offset);
    offset = offsetRelay;
    relays.push(new TextDecoder().decode(relayBytes));
  }

  return { topicHex, ttl, relays };
}

/**
 * Nostr Session Manager
 * Handles multi-relay WebSocket connections, subscriptions to Kind 25000,
 * event signing, and ping/pong/payload message exchanges.
 */
export class NostrSession {
  public readonly topicHex: string;
  public readonly relays: string[];
  public readonly ttl: number;

  private secretKey: Uint8Array;
  public readonly publicKey: string;

  private sockets: Map<string, WebSocket> = new Map();
  private subId: string;
  private status: NostrSessionStatus = 'connecting';
  private events: NostrSessionEvents;

  private remainingSeconds: number;
  private ttlTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;
  private seenEventIds: Set<string> = new Set();
  private lastActivityTimestamp = Date.now();

  constructor(
    topicHex: string,
    relays: string[] = DEFAULT_NOSTR_RELAYS,
    ttl: number = DEFAULT_NOSTR_TTL,
    events: NostrSessionEvents = {}
  ) {
    this.topicHex = topicHex;
    this.relays = relays.length > 0 ? relays : DEFAULT_NOSTR_RELAYS;
    this.ttl = ttl > 0 ? ttl : DEFAULT_NOSTR_TTL;
    this.remainingSeconds = this.ttl;
    this.events = events;

    // Generate ephemeral Schnorr keypair for this session
    this.secretKey = generateSecretKey();
    this.publicKey = getPublicKey(this.secretKey);
    this.subId = 'oms_' + Math.random().toString(36).substring(2, 10);
  }

  public getStatus(): NostrSessionStatus {
    return this.status;
  }

  public getRemainingSeconds(): number {
    return this.remainingSeconds;
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
    if (this.isDestroyed) return;

    this.setStatus('connecting');
    this.startTtlCountdown();

    const filter = {
      kinds: [NOSTR_EVENT_KIND],
      '#t': [this.topicHex],
    };

    let connectedRelaysCount = 0;

    for (const relayUrl of this.relays) {
      try {
        const ws = new WebSocket(relayUrl);
        this.sockets.set(relayUrl, ws);

        ws.onopen = () => {
          if (this.isDestroyed) {
            ws.close();
            return;
          }
          connectedRelaysCount++;
          this.events.onRelayStatus?.(relayUrl, true);

          // Subscribe to topic filter ["REQ", subId, {"kinds": [25000], "#t": [topic]}]
          const reqMsg = JSON.stringify(['REQ', this.subId, filter]);
          ws.send(reqMsg);

          if (this.status === 'connecting') {
            this.setStatus('listening', `Connected to ${connectedRelaysCount} relay(s)`);
          }
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
          console.warn(`[NostrSession] WebSocket error on ${relayUrl}:`, err);
          this.events.onRelayStatus?.(relayUrl, false);
        };

        ws.onclose = () => {
          this.events.onRelayStatus?.(relayUrl, false);
        };
      } catch (err) {
        console.warn(`[NostrSession] Failed to connect to ${relayUrl}:`, err);
        this.events.onRelayStatus?.(relayUrl, false);
      }
    }
  }

  private startTtlCountdown(): void {
    if (this.ttlTimer) clearInterval(this.ttlTimer);

    this.ttlTimer = setInterval(() => {
      if (this.isDestroyed) return;

      this.remainingSeconds--;
      this.events.onTtlTick?.(this.remainingSeconds);

      if (this.remainingSeconds <= 0) {
        this.setStatus('timeout', 'Session timed out');
        this.destroy();
      }
    }, 1000);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (this.isDestroyed || this.status === 'completed' || this.status === 'timeout') return;
      this.sendPing();
    }, DEFAULT_NOSTR_HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Handle an incoming Nostr event received from relays
   */
  private handleInboundEvent(event: NostrEvent): void {
    if (!event || this.isDestroyed) return;

    // Ignore events sent by ourselves (echoed back by relays)
    if (event.pubkey && event.pubkey.toLowerCase() === this.publicKey.toLowerCase()) return;

    // Topic matching
    const topicTag = event.tags.find(t => t[0] === 't')?.[1];
    if (!topicTag || topicTag.toLowerCase() !== this.topicHex.toLowerCase()) return;

    // Deduplicate events received across multiple relays
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);

    this.lastActivityTimestamp = Date.now();

    // Extract type from tags or payload
    let messageType = event.tags.find(t => t[0] === 'type')?.[1];
    let parsedContent: { type?: string; payload?: string; [key: string]: unknown } = {};

    try {
      if (event.content && event.content.trim().startsWith('{')) {
        parsedContent = JSON.parse(event.content);
      }
    } catch {
      // Content is raw payload string
    }

    if (!messageType && parsedContent.type) {
      messageType = parsedContent.type;
    } else if (!messageType && event.content) {
      if (event.content.includes('"ping"')) messageType = 'ping';
      else if (event.content.includes('"pong"')) messageType = 'pong';
      else if (event.content.includes('"disconnect"')) messageType = 'disconnect';
      else if (event.content.includes('"response"')) messageType = 'response';
      else if (event.content.includes('"request"')) messageType = 'request';
    }

    const reqId = event.tags.find(t => t[0] === 'reply_to')?.[1] || event.tags.find(t => t[0] === 'req_id')?.[1];
    const payload = parsedContent.payload || event.content;

    switch (messageType) {
      case 'ping':
        if (this.status !== 'peer_connected' && this.status !== 'transmitting') {
          this.setStatus('peer_connected', 'Peer connected via Nostr');
          this.startHeartbeat();
        }
        this.events.onPing?.();
        // Automatically answer ping with pong
        this.sendPong();
        break;

      case 'pong':
        if (this.status !== 'peer_connected' && this.status !== 'transmitting') {
          this.setStatus('peer_connected', 'Peer confirmed connection');
          this.startHeartbeat();
        }
        this.events.onPong?.();
        break;

      case 'request':
        this.setStatus('transmitting', 'Received request payload');
        this.events.onRequest?.(payload, reqId);
        break;

      case 'response':
        this.setStatus('transmitting', 'Received response payload');
        this.events.onResponse?.(payload, reqId);
        break;

      case 'disconnect':
      case 'bye':
        this.events.onDisconnect?.();
        this.setStatus('completed', 'Peer disconnected');
        break;

      default:
        // If content has an OMS prefix or Base64 payload, treat as response
        if (event.content.startsWith(OMS_PREFIX) || event.content.length > 20) {
          this.events.onResponse?.(event.content, reqId);
        }
        break;
    }
  }

  /**
   * Publish a signed Nostr event to all connected relays
   */
  public publishEvent(type: string, content: string, extraTags: string[][] = []): NostrEvent | null {
    if (this.isDestroyed) return null;

    const expiration = String(Math.floor(Date.now() / 1000) + Math.max(this.remainingSeconds, 10));

    const eventTemplate = {
      kind: NOSTR_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', this.topicHex],
        ['type', type],
        ['expiration', expiration],
        ...extraTags,
      ],
      content,
    };

    const finalizedEvent = finalizeEvent(eventTemplate, this.secretKey);
    this.seenEventIds.add(finalizedEvent.id);

    const eventMsg = JSON.stringify(['EVENT', finalizedEvent]);

    for (const [url, ws] of this.sockets.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(eventMsg);
        } catch (err) {
          console.warn(`[NostrSession] Failed to send event to ${url}:`, err);
        }
      }
    }

    return finalizedEvent;
  }

  public sendPing(): void {
    this.publishEvent('ping', JSON.stringify({ type: 'ping', ts: Date.now() }));
  }

  public sendPong(): void {
    this.publishEvent('pong', JSON.stringify({ type: 'pong', ts: Date.now() }));
  }

  public sendRequest(payload: string, reqId?: string): void {
    this.setStatus('transmitting', 'Sending request payload');
    const id = reqId || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2));
    this.publishEvent('request', payload, [['req_id', id]]);
  }

  public sendResponse(payload: string, replyTo?: string): void {
    this.setStatus('transmitting', 'Sending response payload');
    const extraTags = replyTo ? [['reply_to', replyTo]] : [];
    this.publishEvent('response', payload, extraTags);
  }

  public sendDisconnect(): void {
    this.publishEvent('disconnect', JSON.stringify({ type: 'disconnect' }));
  }

  /**
   * Gracefully close subscriptions, WebSockets, and clear timers
   */
  public destroy(): void {
    if (this.isDestroyed) return;

    // Send disconnect notification to peer before closing
    try {
      this.sendDisconnect();
    } catch {
      // ignore
    }

    this.isDestroyed = true;

    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close subscriptions and sockets
    const closeMsg = JSON.stringify(['CLOSE', this.subId]);
    for (const ws of this.sockets.values()) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(closeMsg);
          ws.close();
        }
      } catch (err) {
        console.warn('[NostrSession] Error while closing socket:', err);
      }
    }
    this.sockets.clear();
  }
}
