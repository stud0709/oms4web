import React, { createContext, useState, useRef, useCallback, useEffect } from 'react';
import {
  NostrSession,
  NostrSessionStatus,
  createNostrPairingMessage,
  generateTopic
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

interface StoredPairing {
  topicHex: string;
  relays: string[];
  secretKeyHex: string;
}

export interface NostrContextType {
  status: NostrSessionStatus | 'disconnected';
  isPaired: boolean;
  connectedRelaysCount: number;
  totalRelaysCount: number;
  topicHex: string;
  pairingChunks: QrChunk[];
  currentChunkIndex: number;
  startPairing: (relays?: string[]) => void;
  disconnect: () => void;
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
      if (stored.topicHex && stored.relays && stored.secretKeyHex) {
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
  const [status, setStatus] = useState<NostrSessionStatus | 'disconnected'>(() =>
    initialPairing ? 'peer_connected' : 'disconnected'
  );
  const [connectedRelaysCount, setConnectedRelaysCount] = useState(0);
  const [totalRelaysCount, setTotalRelaysCount] = useState(() =>
    initialPairing ? initialPairing.relays.length : DEFAULT_NOSTR_RELAYS.length
  );
  const [topicHex, setTopicHex] = useState(() => (initialPairing ? initialPairing.topicHex : ''));
  const [pairingChunks, setPairingChunks] = useState<QrChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

  const sessionRef = useRef<NostrSession | null>(null);
  const pendingUnlockResolveRef = useRef<((vaultData: VaultData) => void) | null>(null);
  const pendingUnlockRejectRef = useRef<((err: Error) => void) | null>(null);
  const pendingEncryptedDataRef = useRef<Uint8Array | null>(null);

  const isPaired = status === 'peer_connected' || status === 'transmitting';

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
    try {
      localStorage.removeItem(STORAGE_NOSTR_PAIRING);
    } catch {
      // ignore
    }
    if (sessionRef.current) {
      sessionRef.current.destroy();
      sessionRef.current = null;
    }
    if (pendingUnlockRejectRef.current) {
      pendingUnlockRejectRef.current(new Error('Nostr session disconnected'));
      pendingUnlockResolveRef.current = null;
      pendingUnlockRejectRef.current = null;
      pendingEncryptedDataRef.current = null;
    }
    setStatus('disconnected');
    setConnectedRelaysCount(0);
    setTopicHex('');
    setPairingChunks([]);
    setCurrentChunkIndex(0);
  }, []);

  const savePairingToStorage = useCallback((topic: string, relays: string[], sKey: Uint8Array) => {
    try {
      const stored: StoredPairing = {
        topicHex: topic,
        relays,
        secretKeyHex: bytesToHex(sKey),
      };
      localStorage.setItem(STORAGE_NOSTR_PAIRING, JSON.stringify(stored));
    } catch (err) {
      console.warn('[NostrContext] Could not persist pairing to localStorage:', err);
    }
  }, []);

  // Restore stored pairing session on startup without synchronous setState
  useEffect(() => {
    if (!initialPairing || sessionRef.current) return;

    const topic = initialPairing.topicHex;
    const relays = initialPairing.relays;
    const sKey = hexToBytes(initialPairing.secretKeyHex);
    const relayStatuses = new Map<string, boolean>();

    const session = new NostrSession(topic, relays, DEFAULT_NOSTR_TTL, {
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
      },
      onRelayStatus: (url, isConnected) => {
        relayStatuses.set(url, isConnected);
        let count = 0;
        for (const conn of relayStatuses.values()) {
          if (conn) count++;
        }
        setConnectedRelaysCount(count);
      },
      onPing: () => {
        if (pendingEncryptedDataRef.current) {
          try {
            const req = createKeyRequestPairing('vault', pendingEncryptedDataRef.current);
            session.sendRequest(req.base64Payload);
          } catch (err) {
            console.error('[NostrContext] Failed to send pending key request:', err);
          }
        }
      },
      onPong: () => {
        if (pendingEncryptedDataRef.current) {
          try {
            const req = createKeyRequestPairing('vault', pendingEncryptedDataRef.current);
            session.sendRequest(req.base64Payload);
          } catch (err) {
            console.error('[NostrContext] Failed to send pending key request:', err);
          }
        }
      },
      onResponse: async (responsePayload) => {
        if (pendingUnlockResolveRef.current && pendingEncryptedDataRef.current) {
          try {
            const req = createKeyRequestPairing('vault', pendingEncryptedDataRef.current);
            const dummyContext = {
              keyPair: {} as CryptoKeyPair,
              envelope: req.envelope,
              message: '',
            };
            const vaultData = await processKeyResponse(responsePayload, dummyContext);
            const resolve = pendingUnlockResolveRef.current;
            pendingUnlockResolveRef.current = null;
            pendingUnlockRejectRef.current = null;
            pendingEncryptedDataRef.current = null;
            resolve(vaultData);
          } catch (err) {
            if (pendingUnlockRejectRef.current) {
              const reject = pendingUnlockRejectRef.current;
              pendingUnlockResolveRef.current = null;
              pendingUnlockRejectRef.current = null;
              pendingEncryptedDataRef.current = null;
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      },
      onError: (err) => {
        console.error('[NostrContext] Session error:', err);
      },
    }, sKey);

    sessionRef.current = session;
    session.start();
  }, [initialPairing]);

  const startPairing = useCallback((customRelays?: string[]) => {
    if (sessionRef.current) {
      sessionRef.current.destroy();
      sessionRef.current = null;
    }

    const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_NOSTR_RELAYS;
    const topic = generateTopic();

    setTopicHex(topic);
    setTotalRelaysCount(relays.length);
    setStatus('connecting');
    setConnectedRelaysCount(0);

    const pairingMsg = createNostrPairingMessage(topic, relays, DEFAULT_NOSTR_TTL);
    const chunks = getQrSequence(pairingMsg);
    setPairingChunks(chunks);
    setCurrentChunkIndex(0);

    const relayStatuses = new Map<string, boolean>();

    const session = new NostrSession(topic, relays, DEFAULT_NOSTR_TTL, {
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        if (newStatus === 'peer_connected') {
          savePairingToStorage(topic, relays, session.getSecretKey());
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
      onPing: () => {
        savePairingToStorage(topic, relays, session.getSecretKey());
        if (pendingEncryptedDataRef.current) {
          try {
            const req = createKeyRequestPairing('vault', pendingEncryptedDataRef.current);
            session.sendRequest(req.base64Payload);
          } catch (err) {
            console.error('[NostrContext] Failed to send pending key request:', err);
          }
        }
      },
      onPong: () => {
        savePairingToStorage(topic, relays, session.getSecretKey());
        if (pendingEncryptedDataRef.current) {
          try {
            const req = createKeyRequestPairing('vault', pendingEncryptedDataRef.current);
            session.sendRequest(req.base64Payload);
          } catch (err) {
            console.error('[NostrContext] Failed to send pending key request:', err);
          }
        }
      },
      onResponse: async (responsePayload) => {
        savePairingToStorage(topic, relays, session.getSecretKey());
        if (pendingUnlockResolveRef.current && pendingEncryptedDataRef.current) {
          try {
            const req = createKeyRequestPairing('vault', pendingEncryptedDataRef.current);
            const dummyContext = {
              keyPair: {} as CryptoKeyPair,
              envelope: req.envelope,
              message: '',
            };
            const vaultData = await processKeyResponse(responsePayload, dummyContext);
            const resolve = pendingUnlockResolveRef.current;
            pendingUnlockResolveRef.current = null;
            pendingUnlockRejectRef.current = null;
            pendingEncryptedDataRef.current = null;
            resolve(vaultData);
          } catch (err) {
            if (pendingUnlockRejectRef.current) {
              const reject = pendingUnlockRejectRef.current;
              pendingUnlockResolveRef.current = null;
              pendingUnlockRejectRef.current = null;
              pendingEncryptedDataRef.current = null;
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      },
      onError: (err) => {
        console.error('[NostrContext] Session error:', err);
      },
    });

    sessionRef.current = session;
    session.start();
  }, [savePairingToStorage]);

  const requestVaultUnlock = useCallback(async (encryptedData: Uint8Array): Promise<VaultData> => {
    if (!sessionRef.current) {
      throw new Error('Nostr session is not active');
    }

    pendingEncryptedDataRef.current = encryptedData;

    return new Promise<VaultData>((resolve, reject) => {
      pendingUnlockResolveRef.current = resolve;
      pendingUnlockRejectRef.current = reject;

      try {
        const req = createKeyRequestPairing('vault', encryptedData);
        sessionRef.current?.sendRequest(req.base64Payload);
      } catch (err) {
        pendingEncryptedDataRef.current = null;
        pendingUnlockResolveRef.current = null;
        pendingUnlockRejectRef.current = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }, []);

  const sendSecret = useCallback(async (secretTextOrOms: string, settings?: AppSettings): Promise<void> => {
    if (!sessionRef.current) {
      throw new Error('No active Nostr pairing');
    }

    let base64Payload: string;

    if (secretTextOrOms.startsWith(OMS_PREFIX)) {
      base64Payload = secretTextOrOms.slice(OMS_PREFIX.length).replace(/\s+/g, '');
    } else if (settings?.publicKey) {
      const omsMsg = await createEncryptedMessage(secretTextOrOms, settings);
      base64Payload = (omsMsg.startsWith(OMS_PREFIX) ? omsMsg.slice(OMS_PREFIX.length) : omsMsg).replace(/\s+/g, '');
    } else {
      // Fallback: UTF-8 to Base64
      base64Payload = btoa(unescape(encodeURIComponent(secretTextOrOms)));
    }

    sessionRef.current.sendRequest(base64Payload);
    toast({
      title: 'Sent to OneMoreSecret',
      description: 'Secret transmitted securely over Nostr pairing.',
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.destroy();
        sessionRef.current = null;
      }
    };
  }, []);

  return (
    <NostrContext.Provider
      value={{
        status,
        isPaired,
        connectedRelaysCount,
        totalRelaysCount,
        topicHex,
        pairingChunks,
        currentChunkIndex,
        startPairing,
        disconnect,
        requestVaultUnlock,
        sendSecret,
      }}
    >
      {children}
    </NostrContext.Provider>
  );
};
