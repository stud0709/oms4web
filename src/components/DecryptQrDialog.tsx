import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  QrCode,
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  Webhook,
  Copy,
  KeyRound,
  Radio,
  RefreshCw,
  Clock,
  Layers,
  Smartphone,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { getQrSequence } from '@/lib/qrUtil';
import {
  APPLICATION_IDS,
  DEFAULT_NOSTR_RELAYS,
  DEFAULT_NOSTR_TTL,
  INTERVAL_QR_SEQUENCE,
} from "@/lib/constants";
import { AppSettings, QrChunk, VaultData } from "@/types/types";
import { createKeyRequest, createKeyRequestPairing, processKeyResponse } from '@/lib/keyRequest';
import { KeyRequestContext } from '@/types/types';
import {
  createNostrPairingMessage,
  generateTopic,
  NostrSession,
  NostrSessionStatus,
} from '@/lib/nostrUtil';

import { toast } from '@/hooks/use-toast';
import {
  downloadVaultBackupFromBytes,
  getEnvironment,
  handleIntent
} from '@/hooks/useEncryptedVault';
import { useSearchParams } from 'react-router-dom';
import { KEY_REQUEST_STORE, oms4webDbPromise } from '@/lib/db';

const LATEST_CONTEXT = 'latest_context';

interface DecryptQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encryptedData: Uint8Array;
  onDecrypted: (vaultData: VaultData) => void;
  onSkip?: () => void;
  hideCloseButton?: boolean;
  settings?: AppSettings;
}

type Step = 'loading' | 'display' | 'input' | 'processing' | 'success' | 'error';
type DisplayMode = 'nostr' | 'airgap';

export function DecryptQrDialog({
  open,
  encryptedData,
  ...props
}: DecryptQrDialogProps) {
  const sessionKey = open ? `${encryptedData.byteLength}-${encryptedData[0] ?? 0}` : 'closed';
  return (
    <DecryptQrDialogContent
      key={sessionKey}
      open={open}
      encryptedData={encryptedData}
      {...props}
    />
  );
}

function DecryptQrDialogContent({
  open,
  onOpenChange,
  encryptedData,
  onDecrypted,
  onSkip,
  hideCloseButton = false,
  settings,
}: DecryptQrDialogProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [chunks, setChunks] = useState<QrChunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<Step>('loading');
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keyRequestContext = useRef<KeyRequestContext | null>(null);
  const env = useMemo(() => getEnvironment(), []);

  // Nostr pairing state
  const isNostrEnabled = Boolean(settings?.enableNostrPairing);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    !env.android && isNostrEnabled ? 'nostr' : 'airgap'
  );
  const [topicHex, setTopicHex] = useState<string>('');
  const [nostrChunks, setNostrChunks] = useState<QrChunk[]>([]);
  const [nostrCurrentIndex, setNostrCurrentIndex] = useState(0);
  const [nostrStatus, setNostrStatus] = useState<NostrSessionStatus>('connecting');
  const [nostrDetail, setNostrDetail] = useState<string>('');
  const [connectedRelaysCount, setConnectedRelaysCount] = useState<number>(0);
  const nostrSessionRef = useRef<NostrSession | null>(null);

  const persistKeyPair = useCallback(async (context: KeyRequestContext) => {
    if (!env.android) return;
    try {
      const db = await oms4webDbPromise;
      await db.put(KEY_REQUEST_STORE, context, LATEST_CONTEXT);
    } catch (err) {
      console.error('Failed to serialize unlock key:', err);
    }
  }, [env.android]);

  const handleSubmitDecrypted = useCallback(async (keyResponse?: string) => {
    if (!keyResponse && !inputValue.trim()) {
      setError('Please paste the key response from your device');
      return;
    }

    if (!keyRequestContext.current) {
      setError('Key request context not available');
      return;
    }

    setStep('processing');
    setError(null);

    try {
      // Process the KEY_RESPONSE to decrypt the vault
      const vaultData = await processKeyResponse(
        (keyResponse ?? inputValue).trim(),
        keyRequestContext.current
      );

      setStep('success');
      setTimeout(() => {
        onDecrypted(vaultData);
        onOpenChange(false);
      }, 1000);
    } catch (err) {
      console.error('Decryption failed:', err);
      setError(
        err instanceof Error
          ? `Decryption failed: ${err.message}`
          : 'Decryption failed. Please ensure you pasted the complete key response.'
      );
      setStep('input');
      return;
    } finally {
      setSearchParams({});
    }
  }, [inputValue, onDecrypted, onOpenChange, setSearchParams]);

  // Initialize or restart Nostr pairing session
  const initNostrSession = useCallback(() => {
    if (env.android || !open) return;

    if (nostrSessionRef.current) {
      nostrSessionRef.current.destroy();
      nostrSessionRef.current = null;
    }

    const topicHex = generateTopic();
    setTopicHex(topicHex);
    const relays = settings?.nostrRelays && settings.nostrRelays.length > 0
      ? settings.nostrRelays
      : DEFAULT_NOSTR_RELAYS;
    const ttl = DEFAULT_NOSTR_TTL;

    const pairingMessage = createNostrPairingMessage(topicHex, relays, ttl);
    const pChunks = getQrSequence(pairingMessage);
    setNostrChunks(pChunks);
    setNostrCurrentIndex(0);
    setNostrStatus('connecting');
    setNostrDetail('Connecting to Nostr relays...');
    setConnectedRelaysCount(0);

    const relayStatuses = new Map<string, boolean>();

    let hasSentKeyRequest = false;
    const sendKeyRequestPairing = () => {
      if (hasSentKeyRequest || !encryptedData) return;
      hasSentKeyRequest = true;
      try {
        const pairingReq = createKeyRequestPairing('vault', encryptedData);
        session.sendRequest(pairingReq.base64Payload);
      } catch (err) {
        console.error('[DecryptQrDialog] Failed to build KEY_REQUEST_PAIRING:', err);
      }
    };

    const session = new NostrSession(topicHex, relays, ttl, {
      onStatusChange: (status, detail) => {
        setNostrStatus(status);
        if (detail) setNostrDetail(detail);
      },
      onRelayStatus: (relayUrl, isConnected) => {
        relayStatuses.set(relayUrl, isConnected);
        let count = 0;
        for (const connected of relayStatuses.values()) {
          if (connected) count++;
        }
        setConnectedRelaysCount(count);
      },
      onPing: () => {
        // Peer scanned QR code and sent ping - transmit our KEY_REQUEST_PAIRING message
        sendKeyRequestPairing();
      },
      onPong: () => {
        // Connected to peer
        sendKeyRequestPairing();
      },
      onResponse: (responsePayload) => {
        // Received KEY_RESPONSE over Nostr
        handleSubmitDecrypted(responsePayload);
      },
      onError: (err) => {
        console.error('[DecryptQrDialog] Nostr session error:', err);
      },
    });

    nostrSessionRef.current = session;
    session.start();
  }, [env.android, open, settings?.nostrRelays, handleSubmitDecrypted, encryptedData]);

  // Clean up Nostr session on unmount or dialog close
  useEffect(() => {
    return () => {
      if (nostrSessionRef.current) {
        nostrSessionRef.current.destroy();
        nostrSessionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (open && encryptedData && step === 'loading' && !searchParams.has("data")) {
      // Create KEY_REQUEST message
      createKeyRequest(
        'vault',
        encryptedData,
        (env.android && env.pwaMode) ? APPLICATION_IDS.OMS4WEB_CALLBACK_REQUEST : APPLICATION_IDS.KEY_REQUEST
      )
        .then((context) => {
          keyRequestContext.current = context;
          // Split the KEY_REQUEST message into QR chunks for air-gap fallback
          const qrChunks = getQrSequence(context.message);
          setChunks(qrChunks);
          setCurrentIndex(0);
          setStep('display');
          persistKeyPair(keyRequestContext.current);

          if (!env.android && isNostrEnabled) {
            initNostrSession();
          }
        })
        .catch((err) => {
          console.error('Failed to create key request: ', err);
          setError('Failed to parse encrypted data: ' + err.message);
          setStep('error');
        });
    }
  }, [open, encryptedData, env.android, env.pwaMode, persistKeyPair, step, searchParams, isNostrEnabled, initNostrSession]);

  useEffect(() => {
    if (!open || chunks.length <= 1 || step !== 'display' || displayMode !== 'airgap') return;

    setInputValue('');

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % chunks.length);
    }, INTERVAL_QR_SEQUENCE);

    return () => clearInterval(interval);
  }, [open, chunks.length, step, displayMode]);

  // Cycle Nostr pairing QR code sequence
  useEffect(() => {
    if (!open || nostrChunks.length <= 1 || step !== 'display' || displayMode !== 'nostr') return;

    const interval = setInterval(() => {
      setNostrCurrentIndex((prev) => (prev + 1) % nostrChunks.length);
    }, INTERVAL_QR_SEQUENCE);

    return () => clearInterval(interval);
  }, [open, nostrChunks.length, step, displayMode]);

  const handleProceedToInput = useCallback(() => {
    setStep('input');
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  // Decrypt when reloading (Android Intent return)
  useEffect(() => {
    if (!searchParams.has("data")) return;

    (async () => {
      const db = await oms4webDbPromise;
      const dbEntry = await db.get(KEY_REQUEST_STORE, LATEST_CONTEXT);
      if (!dbEntry) {
        setSearchParams({});
        return;
      }
      db.delete(KEY_REQUEST_STORE, LATEST_CONTEXT);

      keyRequestContext.current = dbEntry;
      handleSubmitDecrypted(searchParams.get("data"));
    })();
  }, [searchParams, handleSubmitDecrypted, setSearchParams]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmitDecrypted();
    }
  }, [handleSubmitDecrypted]);

  const handleSkip = useCallback(() => {
    if (encryptedData) {
      try {
        downloadVaultBackupFromBytes(encryptedData);
        toast({ title: 'Backup created', description: 'Encrypted vault data has been downloaded as a backup.' });
      } catch (e) {
        console.error('Failed to download backup:', e);
      }
    }
    onSkip?.();
    onOpenChange(false);
  }, [onSkip, onOpenChange, encryptedData]);

  const currentChunk = chunks[currentIndex];

  if (searchParams.has("data"))
    return null;

  const totalRelays = settings?.nostrRelays?.length || DEFAULT_NOSTR_RELAYS.length;

  const isPairingWaitingUnlock =
    displayMode === 'nostr' && (nostrStatus === 'peer_connected' || nostrStatus === 'transmitting');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`w-[calc(100vw-2rem)] max-w-lg ${hideCloseButton ? '[&>button]:hidden' : ''}`}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {env.android ? (
              <KeyRound className="h-5 w-5" />
            ) : displayMode === 'nostr' ? (
              <Radio className="h-5 w-5 text-primary" />
            ) : (
              <QrCode className="h-5 w-5" />
            )}
            Decrypt Vault Data
          </DialogTitle>
          <DialogDescription>
            {step === 'loading' && 'Preparing decryption request...'}
            {step === 'display' && (
              env.android
                ? 'Send the key request to OneMoreSecret, then press UNLOCK or paste the key response below.'
                : displayMode === 'nostr'
                  ? isPairingWaitingUnlock
                    ? 'Pairing successful! Please confirm the unlock request on OneMoreSecret.'
                    : 'Scan the QR code with OneMoreSecret to pair and decrypt automatically via Nostr.'
                  : 'Scan the animated QR code(s) with OneMoreSecret to get the decryption key.'
            )}
            {step === 'input' && 'Paste the key response from your device'}
            {step === 'processing' && 'Decrypting vault data...'}
            {step === 'success' && 'Decryption successful!'}
            {step === 'error' && 'Failed to prepare decryption request'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {step === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Creating key request...</p>
            </div>
          )}

          {step === 'display' && (
            <>
              {env.android ? (
                <div className="flex flex-col items-center gap-3 w-full">
                  <Button
                    onClick={() => {
                      if (keyRequestContext.current) {
                        handleIntent(keyRequestContext.current.message);
                      }
                    }}
                    className="w-full gap-2"
                  >
                    <Webhook className="h-4 w-4" />
                    Open in OneMoreSecret
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (keyRequestContext.current) {
                        navigator.clipboard.writeText(keyRequestContext.current.message);
                        toast({ title: 'Copied', description: 'Key request copied to clipboard.' });
                      }
                    }}
                    className="w-full gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy to Clipboard
                  </Button>
                </div>
              ) : displayMode === 'nostr' ? (
                <div className="flex flex-col items-center gap-3 w-full">
                  {isPairingWaitingUnlock ? (
                    <div className="w-full p-6 bg-muted/40 rounded-xl flex flex-col items-center gap-4 text-center border">
                      <div className="relative flex items-center justify-center my-2">
                        <div className="absolute h-16 w-16 rounded-full bg-primary/20 animate-ping" />
                        <div className="relative h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                          <Smartphone className="h-7 w-7" />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-semibold text-base">Pairing Successful</h4>
                        <p className="text-sm text-muted-foreground">
                          Waiting for unlock authorization on your phone...
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground/80 max-w-xs bg-background/50 px-3 py-2 rounded-md border">
                        Please review and confirm the decryption request in OneMoreSecret.
                      </p>
                    </div>
                  ) : nostrChunks.length > 0 && nostrStatus !== 'timeout' ? (
                    <>
                      <div className="p-4 bg-white rounded-lg shadow-sm border">
                        <QRCodeSVG
                          value={nostrChunks[nostrCurrentIndex]?.encoded || ''}
                          size={220}
                        />
                      </div>
                      {nostrChunks.length > 1 && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">
                            {nostrCurrentIndex + 1} / {nostrChunks.length}
                          </span>
                          <div className="flex gap-1">
                            {nostrChunks.map((_, idx) => (
                              <div
                                key={idx}
                                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                                  idx === nostrCurrentIndex ? 'bg-primary' : 'bg-muted'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                      {topicHex && (
                        <div className="flex items-center gap-1.5 text-xs font-mono bg-muted/60 px-3 py-1.5 rounded-md border text-muted-foreground">
                          <span className="font-semibold text-foreground">Topic Prefix:</span>
                          <span className="font-bold tracking-wider text-primary">{topicHex.substring(0, 8)}...</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="p-8 bg-muted/40 rounded-lg flex flex-col items-center gap-3 text-center border">
                      <Clock className="h-10 w-10 text-muted-foreground" />
                      <p className="text-sm font-medium">Nostr pairing session expired</p>
                      <Button size="sm" onClick={initNostrSession} className="gap-1.5">
                        <RefreshCw className="h-4 w-4" />
                        Restart Pairing
                      </Button>
                    </div>
                  )}

                  {/* Status & Live Indicators */}
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                    {nostrStatus === 'connecting' && (
                      <Badge variant="outline" className="gap-1.5 py-1">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        Connecting to relays ({connectedRelaysCount}/{totalRelays})
                      </Badge>
                    )}
                    {nostrStatus === 'listening' && (
                      <Badge variant="secondary" className="gap-1.5 py-1 bg-primary/10 text-primary">
                        <Radio className="h-3 w-3 animate-pulse text-primary" />
                        Listening on {connectedRelaysCount} relay(s)
                      </Badge>
                    )}
                    {(nostrStatus === 'peer_connected' || nostrStatus === 'transmitting') && (
                      <Badge variant="secondary" className="gap-1.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                        <CheckCircle className="h-3 w-3" />
                        OneMoreSecret paired
                      </Badge>
                    )}
                    {nostrStatus === 'transmitting' && (
                      <Badge variant="secondary" className="gap-1.5 py-1 bg-primary/10 text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Waiting for unlock...
                      </Badge>
                    )}
                  </div>

                  {nostrDetail && (
                    <p className="text-xs text-muted-foreground text-center">
                      {nostrDetail}
                    </p>
                  )}

                  <div className="flex gap-2 w-full pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisplayMode('airgap')}
                      className="flex-1 gap-1.5 text-xs"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Air-Gap QR (Offline)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleProceedToInput}
                      className="flex-1 gap-1.5 text-xs"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Paste Key Response
                    </Button>
                  </div>
                </div>
              ) : (
                /* Air-gap Sequential QR Display */
                <>
                  {currentChunk && (
                    <div className="p-4 bg-white rounded-lg shadow-sm border">
                      <QRCodeSVG value={currentChunk.encoded} size={220} />
                    </div>
                  )}
                  {chunks.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-muted-foreground">
                        {currentIndex + 1} / {chunks.length}
                      </span>
                      <div className="flex gap-1">
                        {chunks.map((_, idx) => (
                          <div
                            key={idx}
                            className={`w-2 h-2 rounded-full transition-colors ${
                              idx === currentIndex ? 'bg-primary' : 'bg-muted'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 w-full">
                    {isNostrEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDisplayMode('nostr');
                          initNostrSession();
                        }}
                        className="flex-1 gap-1.5 text-xs"
                      >
                        <Radio className="h-3.5 w-3.5 text-primary" />
                        Nostr Relay Pairing
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleProceedToInput}
                      className="flex-1 gap-1.5 text-xs"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Enter Key Response
                    </Button>
                  </div>
                </>
              )}

              {onSkip && (
                <Button variant="ghost" size="sm" onClick={handleSkip}>
                  Skip (start with empty vault)
                </Button>
              )}
            </>
          )}

          {step === 'input' && (
            <>
              <div className="w-full space-y-3">
                <Textarea
                  ref={textareaRef}
                  value={inputValue}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setError(null);
                  }}
                  placeholder="Paste the key response here..."
                  className="min-h-[150px] font-mono text-xs"
                />
                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                  </div>
                )}
              </div>
              <div className="flex gap-2 w-full">
                <Button variant="outline" onClick={() => setStep('display')} className="flex-1">
                  Back
                </Button>
                <Button onClick={() => handleSubmitDecrypted()} className="flex-1 gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Decrypt Vault
                </Button>
              </div>
            </>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Decrypting vault data...</p>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm font-medium">Vault decrypted successfully!</p>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <p className="text-sm text-destructive text-center">{error}</p>
              {onSkip && (
                <Button variant="outline" size="sm" onClick={handleSkip}>
                  Start with empty vault
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
