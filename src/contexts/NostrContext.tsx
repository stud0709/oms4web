import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
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

export interface NostrContextType {
  status: NostrSessionStatus | 'disconnected';
  isPaired: boolean;
  connectedRelaysCount: number;
  totalRelaysCount: number;
  topicHex: string;
  remainingSeconds: number;
  pairingChunks: QrChunk[];
  currentChunkIndex: number;
  startPairing: (relays?: string[], ttl?: number) => void;
  disconnect: () => void;
  requestVaultUnlock: (encryptedData: Uint8Array) => Promise<VaultData>;
  sendSecret: (secretTextOrOms: string, settings?: AppSettings) => Promise<void>;
}

export const NostrContext = createContext<NostrContextType | null>(null);

export const NostrProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<NostrSessionStatus | 'disconnected'>('disconnected');
  const [connectedRelaysCount, setConnectedRelaysCount] = useState(0);
  const [totalRelaysCount, setTotalRelaysCount] = useState(DEFAULT_NOSTR_RELAYS.length);
  const [topicHex, setTopicHex] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(DEFAULT_NOSTR_TTL);
  const [pairingChunks, setPairingChunks] = useState<QrChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

  const sessionRef = useRef<NostrSession | null>(null);
  const pendingUnlockResolveRef = useRef<((vaultData: VaultData) => void) | null>(null);
  const pendingUnlockRejectRef = useRef<((err: Error) => void) | null>(null);
  const pendingEncryptedDataRef = useRef<Uint8Array | null>(null);

  const isPaired = status === 'peer_connected' || status === 'transmitting';

  // Cycle animated QR chunk index
  useEffect(() => {
    if (pairingChunks.length <= 1 || status === 'disconnected' || isPaired || status === 'timeout') {
      return;
    }
    const timer = setInterval(() => {
      setCurrentChunkIndex(prev => (prev + 1) % pairingChunks.length);
    }, INTERVAL_QR_SEQUENCE);
    return () => clearInterval(timer);
  }, [pairingChunks.length, status, isPaired]);

  const disconnect = useCallback(() => {
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

  const startPairing = useCallback((customRelays?: string[], customTtl?: number) => {
    if (sessionRef.current) {
      sessionRef.current.destroy();
      sessionRef.current = null;
    }

    const relays = customRelays && customRelays.length > 0 ? customRelays : DEFAULT_NOSTR_RELAYS;
    const ttl = customTtl || DEFAULT_NOSTR_TTL;
    const topic = generateTopic();

    setTopicHex(topic);
    setTotalRelaysCount(relays.length);
    setRemainingSeconds(ttl);
    setStatus('connecting');
    setConnectedRelaysCount(0);

    const pairingMsg = createNostrPairingMessage(topic, relays, ttl);
    const chunks = getQrSequence(pairingMsg);
    setPairingChunks(chunks);
    setCurrentChunkIndex(0);

    const relayStatuses = new Map<string, boolean>();

    const session = new NostrSession(topic, relays, ttl, {
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
      onTtlTick: (rem) => {
        setRemainingSeconds(rem);
      },
      onPing: () => {
        // If an unlock request was pending before pairing handshake, dispatch it now
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
    });

    sessionRef.current = session;
    session.start();
  }, []);

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
        remainingSeconds,
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
