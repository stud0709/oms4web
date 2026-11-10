import { decodeText } from '@/lib/protocol';
import { bytesToBase64 } from '@/lib/base64';
import React, { createContext, useState, useRef, useCallback, useEffect } from 'react';
import {
  NostrSession,
  NostrSessionStatus,
  createNostrPairingMessage,
  generateTopic,
  generatePsk,
} from '@/lib/nostrUtil';
import { getQrSequence } from '@/lib/qrUtil';
import {
  DEFAULT_NOSTR_RELAYS,
  DEFAULT_NOSTR_TTL,
  INTERVAL_QR_SEQUENCE,
  OMS_PREFIX
} from '@/lib/constants';
import { AppSettings, QrChunk, VaultData } from '@/types/types';
import { createKeyRequestPairing, processKeyResponse } from '@/lib/keyRequest';
import { createEncryptedMessage } from '@/lib/crypto';
import { toast } from '@/hooks/use-toast';

const STORAGE_NOSTR_PAIRING = 'oms4web_nostr_pairing';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StoredPairing {
  transportVersion?: number;
  topicHex: string;
  pskHex: string;
  relays: string[];
  secretKeyHex: string;
  expiresAt?: number;
}

export interface NostrContextType {
  status: NostrSessionStatus | 'disconnected' | 'idle';
  error: string | null;
  isPaired: boolean;
  connectedRelaysCount: number;
  totalRelaysCount: number;
  topicHex: string;
  pairingChunks: QrChunk[];
  currentChunkIndex: number;
  startPairing: (settings?: AppSettings, relays?: string[]) => Promise<void>;
  disconnect: () => void;
  cancelPairing: () => void;
  requestVaultUnlock: (encryptedData: Uint8Array) => Promise<VaultData>;
  sendSecret: (secretTextOrOms: string, settings?: AppSettings) => Promise<void>;
}

export const NostrContext = createContext<NostrContextType | null>(null);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function getInitialPairing(): StoredPairing | null {
  try {
    const raw = localStorage.getItem(STORAGE_NOSTR_PAIRING);
    if (raw) {
      const stored: StoredPairing = JSON.parse(raw);
      if (stored.transportVersion !== 1 || (stored.expiresAt && Date.now() > stored.expiresAt)) {
        console.log('[NostrContext] Stored pairing expired after 24h. Clearing storage.');
        localStorage.removeItem(STORAGE_NOSTR_PAIRING);
        return null;
      }
      if (stored.topicHex && stored.pskHex && stored.relays && stored.secretKeyHex) {
        return stored;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export const NostrProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initialPairing] = useState<StoredPairing | null>(() => getInitialPairing());
  const [status, setStatus] = useState<NostrSessionStatus | 'disconnected' | 'idle'>(() =>
    initialPairing ? 'idle' : 'disconnected'
  );
  const [hasPairing, setHasPairing] = useState(Boolean(initialPairing));
  const [error, setError] = useState<string | null>(null);
  const [connectedRelaysCount, setConnectedRelaysCount] = useState(0);
  const [totalRelaysCount, setTotalRelaysCount] = useState(() =>
    initialPairing ? initialPairing.relays.length : DEFAULT_NOSTR_RELAYS.length
  );
  const [topicHex, setTopicHex] = useState(() => (initialPairing ? initialPairing.topicHex : ''));
  const [pairingChunks, setPairingChunks] = useState<QrChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

  const sessionRef = useRef<NostrSession | null>(null);
  const pairingGenerationRef = useRef(0);
  const pairingPendingRef = useRef(false);
  const invalidatePendingPairing = useCallback(() => { ++pairingGenerationRef.current; }, []);
  const pendingUnlockResolveRef = useRef<((vaultData: VaultData) => void) | null>(null);
  const pendingUnlockRejectRef = useRef<((err: Error) => void) | null>(null);
  const pendingRequestRef = useRef<ReturnType<typeof createKeyRequestPairing> | null>(null);
  const pendingEncryptedDataRef = useRef<Uint8Array | null>(null);
  const isUnlockRequestInFlightRef = useRef(false);
  const isSendingSecretRef = useRef(false);

  const isPaired = hasPairing;

  // Cycle animated QR chunk index during pairing
  useEffect(() => {
    if (pairingChunks.length <= 1 || status === 'disconnected' || isPaired) {
      return;
    }
    const timer = setInterval(() => {
      setCurrentChunkIndex(prev => (prev + 1) % pairingChunks.length);
    }, INTERVAL_QR_SEQUENCE);
    return () => clearInterval(timer);
  }, [pairingChunks.length, status, isPaired]);

  const disconnect = useCallback(() => {
    invalidatePendingPairing();
    pairingPendingRef.current = false;
    try {
      localStorage.removeItem(STORAGE_NOSTR_PAIRING);
    } catch {
      // ignore
    }
    if (sessionRef.current) {
      sessionRef.current.destroy();
      sessionRef.current = null;
    }
    isUnlockRequestInFlightRef.current = false;
    isSendingSecretRef.current = false;
    pendingRequestRef.current = null;
    if (pendingUnlockRejectRef.current) {
      pendingUnlockRejectRef.current(new Error('Nostr session disconnected'));
      pendingUnlockResolveRef.current = null;
      pendingUnlockRejectRef.current = null;
      pendingEncryptedDataRef.current = null;
    }
    setStatus('disconnected');
    setHasPairing(false);
    setError(null);
    setConnectedRelaysCount(0);
    setTopicHex('');
    setPairingChunks([]);
    setCurrentChunkIndex(0);
  }, [invalidatePendingPairing]);

  const cancelPairing = useCallback(() => {
    if (pairingPendingRef.current) disconnect();
  }, [disconnect]);

  useEffect(() => {
    const expireOnResume = () => { if (!document.hidden && hasPairing && sessionRef.current && !getInitialPairing()) disconnect(); };
    document.addEventListener('visibilitychange', expireOnResume);
    return () => document.removeEventListener('visibilitychange', expireOnResume);
  }, [disconnect, hasPairing]);

  const savePairingToStorage = useCallback((topic: string, psk: Uint8Array, relays: string[], sKey: Uint8Array) => {
    try {
      const stored: StoredPairing = {
        topicHex: topic,
        transportVersion: 1,
        pskHex: bytesToHex(psk),
        relays,
        secretKeyHex: bytesToHex(sKey),
        expiresAt: Date.now() + SESSION_TTL_MS,
      };
      localStorage.setItem(STORAGE_NOSTR_PAIRING, JSON.stringify(stored));
    } catch (err) {
      console.warn('[NostrContext] Could not persist pairing to localStorage:', err);
    }
  }, []);

  // Restore credentials on startup; sockets open only for an explicit Nostr action.
  useEffect(() => {
    if (!initialPairing || sessionRef.current) return;

    const topic = initialPairing.topicHex;
    const psk = hexToBytes(initialPairing.pskHex);
    const relays = initialPairing.relays;
    const sKey = hexToBytes(initialPairing.secretKeyHex);
    const relayStatuses = new Map<string, boolean>();

    const session = new NostrSession(topic, psk, relays, DEFAULT_NOSTR_TTL, {
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        if (newStatus !== 'error') setError(null);
      },
      onPaired: () => {
        setHasPairing(true);
        savePairingToStorage(topic, psk, relays, session.getSecretKey());
      },
      onRelayStatus: (url, isConnected) => {
        relayStatuses.set(url, isConnected);
        let count = 0;
        for (const conn of relayStatuses.values()) {
          if (conn) count++;
        }
        setConnectedRelaysCount(count);
      },
      onResponse: async (responsePayload) => {
        savePairingToStorage(topic, psk, relays, session.getSecretKey());
        if (pendingUnlockResolveRef.current && pendingEncryptedDataRef.current) {
          const encData = pendingEncryptedDataRef.current;
          const resolve = pendingUnlockResolveRef.current;
          const reject = pendingUnlockRejectRef.current;

          isUnlockRequestInFlightRef.current = false;
          pendingUnlockResolveRef.current = null;
          pendingUnlockRejectRef.current = null;
          pendingEncryptedDataRef.current = null;

          try {
            const req = pendingRequestRef.current;
            if (!req) throw new Error('No pending unlock request');
            pendingRequestRef.current = null;
            const dummyContext = {
              keyPair: {} as CryptoKeyPair,
              requestId: req.requestId,
              paired: true,
              envelope: req.envelope,
              message: '',
            };
            const vaultData = await processKeyResponse(responsePayload, dummyContext);
            resolve(vaultData);
          } catch (err) {
            if (reject) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      },
      onError: (err) => {
        setError(err.message);
        console.error('[NostrContext] Session error:', err);
      },
    }, sKey);

    sessionRef.current = session;
  }, [initialPairing, savePairingToStorage]);

  const startPairing = useCallback(async (settings?: AppSettings, customRelays?: string[]) => {
    const generation = ++pairingGenerationRef.current;
    pairingPendingRef.current = true;
    if (sessionRef.current) {
      sessionRef.current.destroy();
      sessionRef.current = null;
    }
    try { localStorage.removeItem(STORAGE_NOSTR_PAIRING); } catch { /* Storage may be unavailable. */ }
    setHasPairing(false);
    setError(null);
    setPairingChunks([]);
    if (!settings?.enableNostrPairing) {
      setStatus('error');
      setError('Enable Nostr Relay Pairing in Settings before pairing.');
      return;
    }

    const relays = customRelays && customRelays.length > 0
      ? customRelays
      : (settings?.nostrRelays && settings.nostrRelays.length > 0 ? settings.nostrRelays : DEFAULT_NOSTR_RELAYS);
    const topic = generateTopic();
    const psk = generatePsk();

    setTopicHex(topic);
    setTotalRelaysCount(relays.length);
    setStatus('connecting');
    setConnectedRelaysCount(0);

    try {
      const pairingMsg = await createNostrPairingMessage(topic, psk, relays, DEFAULT_NOSTR_TTL, settings);
      if (generation !== pairingGenerationRef.current) return;
      const chunks = getQrSequence(pairingMsg);
      setPairingChunks(chunks);
      setCurrentChunkIndex(0);
    } catch (err) {
      if (generation !== pairingGenerationRef.current) return;
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
      console.error('[NostrContext] Failed to generate pairing message:', err);
      return;
    }

    const relayStatuses = new Map<string, boolean>();

    const session = new NostrSession(topic, psk, relays, DEFAULT_NOSTR_TTL, {
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        if (newStatus !== 'error') setError(null);
      },
      onPaired: () => {
        pairingPendingRef.current = false;
        setHasPairing(true);
        savePairingToStorage(topic, psk, relays, session.getSecretKey());
        if (pendingEncryptedDataRef.current && !isUnlockRequestInFlightRef.current) {
          isUnlockRequestInFlightRef.current = true;
          try {
            const req = createKeyRequestPairing('vault', pendingEncryptedDataRef.current);
            pendingRequestRef.current = req;
            session.sendRequest(req.base64Payload);
          } catch (err) {
            isUnlockRequestInFlightRef.current = false;
            console.error('[NostrContext] Failed to send pending key request:', err);
          }
        }
      },
      onRelayStatus: (url, isConnected) => {
        relayStatuses.set(url, isConnected);
        let count = 0;
        for (const conn of relayStatuses.values()) {
          if (conn) count++;
        }
        setConnectedRelaysCount(count);
      },
      onResponse: async (responsePayload) => {
        savePairingToStorage(topic, psk, relays, session.getSecretKey());
        if (pendingUnlockResolveRef.current && pendingEncryptedDataRef.current) {
          const encData = pendingEncryptedDataRef.current;
          const resolve = pendingUnlockResolveRef.current;
          const reject = pendingUnlockRejectRef.current;

          isUnlockRequestInFlightRef.current = false;
          pendingUnlockResolveRef.current = null;
          pendingUnlockRejectRef.current = null;
          pendingEncryptedDataRef.current = null;

          try {
            const req = pendingRequestRef.current;
            if (!req) throw new Error('No pending unlock request');
            pendingRequestRef.current = null;
            const dummyContext = {
              keyPair: {} as CryptoKeyPair,
              requestId: req.requestId,
              paired: true,
              envelope: req.envelope,
              message: '',
            };
            const vaultData = await processKeyResponse(responsePayload, dummyContext);
            resolve(vaultData);
          } catch (err) {
            if (reject) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      },
      onError: (err) => {
        setError(err.message);
        console.error('[NostrContext] Session error:', err);
      },
    });

    sessionRef.current = session;
    session.start();
  }, [savePairingToStorage]);

  const requestVaultUnlock = useCallback(async (encryptedData: Uint8Array): Promise<VaultData> => {
    if (!getInitialPairing()) {
      disconnect();
      throw new Error('Nostr pairing expired. Pair with OneMoreSecret again.');
    }
    if (!sessionRef.current) {
      throw new Error('Nostr session is not active');
    }

    if (isUnlockRequestInFlightRef.current) {
      throw new Error('An unlock request is already in progress');
    }

    pendingEncryptedDataRef.current = encryptedData;
    isUnlockRequestInFlightRef.current = true;

    return new Promise<VaultData>((resolve, reject) => {
      pendingUnlockResolveRef.current = resolve;
      pendingUnlockRejectRef.current = reject;

      try {
        const req = createKeyRequestPairing('vault', encryptedData);
        pendingRequestRef.current = req;
        sessionRef.current?.sendRequest(req.base64Payload).catch(err => {
          isUnlockRequestInFlightRef.current = false;
          pendingRequestRef.current = null;
          pendingEncryptedDataRef.current = null;
          pendingUnlockResolveRef.current = null;
          pendingUnlockRejectRef.current = null;
          reject(err instanceof Error ? err : new Error(String(err)));
        });
        const activeRequest = req.requestId;
        setTimeout(() => {
          if (pendingRequestRef.current?.requestId === activeRequest) {
            isUnlockRequestInFlightRef.current = false;
            pendingRequestRef.current = null;
            pendingEncryptedDataRef.current = null;
            pendingUnlockResolveRef.current = null;
            pendingUnlockRejectRef.current = null;
            reject(new Error('Nostr unlock request timed out'));
          }
        }, DEFAULT_NOSTR_TTL * 1000);
      } catch (err) {
        isUnlockRequestInFlightRef.current = false;
        pendingEncryptedDataRef.current = null;
        pendingUnlockResolveRef.current = null;
        pendingUnlockRejectRef.current = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }, [disconnect]);

  const sendSecret = useCallback(async (secretTextOrOms: string, settings?: AppSettings): Promise<void> => {
    if (!getInitialPairing()) {
      disconnect();
      throw new Error('Nostr pairing expired. Pair with OneMoreSecret again.');
    }
    if (!sessionRef.current) {
      throw new Error('No active Nostr pairing');
    }

    if (isSendingSecretRef.current) {
      console.warn('[NostrContext] Secret transmission already in flight, ignoring duplicate call');
      return;
    }

    isSendingSecretRef.current = true;

    try {
      let base64Payload: string;

      const decoded = decodeText(secretTextOrOms);
      if (decoded) {
        base64Payload = bytesToBase64(decoded);
      } else if (settings?.publicKey) {
        const omsMsg = await createEncryptedMessage(secretTextOrOms, settings);
        base64Payload = (omsMsg.startsWith(OMS_PREFIX) ? omsMsg.slice(OMS_PREFIX.length) : omsMsg).replace(/\s+/g, '');
      } else {
        // Fallback: UTF-8 to Base64
        throw new Error('An RSA public key is required to send a secret');
      }

      await sessionRef.current.sendRequest(base64Payload);
      toast({
        title: 'Sent to OneMoreSecret',
        description: 'Secret transmitted securely over Nostr pairing.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast({ title: 'Nostr send failed', description: message, variant: 'destructive' });
    } finally {
      setTimeout(() => {
        isSendingSecretRef.current = false;
      }, 500);
    }
  }, [disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      invalidatePendingPairing();
      if (sessionRef.current) {
        sessionRef.current.destroy();
        sessionRef.current = null;
      }
    };
  }, [invalidatePendingPairing]);

  return (
    <NostrContext.Provider
      value={{
        status,
        error,
        isPaired,
        connectedRelaysCount,
        totalRelaysCount,
        topicHex,
        pairingChunks,
        currentChunkIndex,
        startPairing,
        disconnect,
        cancelPairing,
        requestVaultUnlock,
        sendSecret,
      }}
    >
      {children}
    </NostrContext.Provider>
  );
};
