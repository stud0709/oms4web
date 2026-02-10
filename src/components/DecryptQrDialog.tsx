import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Upload, CheckCircle, AlertCircle, Loader2, Webhook, Copy, KeyRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getQrSequence } from '@/lib/qrUtil';
import { APPLICATION_IDS, DB_NAME, DB_VERSION, INTERVAL_QR_SEQUENCE, } from "@/lib/constants";
import { QrChunk } from "@/types/types";
import { createKeyRequest, processKeyResponse } from '@/lib/keyRequest';
import { KeyRequestContext } from '@/types/types';
import { OMS_PREFIX } from "@/lib/constants";
import { EncryptionSettings } from "@/types/types";
import { toast } from '@/hooks/use-toast';
import { downloadVault, getTimestamp, getEnvironment, handleIntent } from '@/hooks/useEncryptedVault';
import { useSearchParams } from 'react-router-dom';
import { openDB, IDBPDatabase, DBSchema } from 'idb';
const KEY_REQUEST_STORE = 'key_request_store', LATEST_CONTEXT = 'latest_context';

interface DecryptQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encryptedData: string;
  onDecrypted: (data: string) => void;
  onSkip?: () => void;
  hideCloseButton?: boolean;
  settings: EncryptionSettings;
}

interface KeyRequestDB extends DBSchema {
  [KEY_REQUEST_STORE]: {
    key: string;
    value: { id: string; keyRequestContext: KeyRequestContext };
  };
}

type Step = 'loading' | 'display' | 'input' | 'processing' | 'success' | 'error';

const dbPromise = openDB<KeyRequestDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(KEY_REQUEST_STORE)) {
      db.createObjectStore(KEY_REQUEST_STORE, { keyPath: 'id' });
    }
  },
});

export function DecryptQrDialog({
  open,
  onOpenChange,
  encryptedData,
  onDecrypted,
  onSkip,
  hideCloseButton = false,
  settings
}: DecryptQrDialogProps) {
  const [chunks, setChunks] = useState<QrChunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<Step>('loading');
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keyRequestContext = useRef<KeyRequestContext | null>(null);
  const env = useMemo(() => getEnvironment(), []);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (open && encryptedData) {
      setStep('loading');
      setInputValue('');
      setError(null);

      // Create KEY_REQUEST message
      createKeyRequest(
        'vault',
        encryptedData,
        settings,
        (env.android && env.pwaMode) ? APPLICATION_IDS.OMS4WEB_CALLBACK_REQUEST : APPLICATION_IDS.KEY_REQUEST)
        .then((context) => {
          keyRequestContext.current = context;
          // Split the KEY_REQUEST message into QR chunks
          const qrChunks = getQrSequence(context.message);
          setChunks(qrChunks);
          setCurrentIndex(0);
          setStep('display');
          persistKeyPair(dbPromise, keyRequestContext.current);
        })
        .catch((err) => {
          console.error('Failed to create key request: ', err);
          setError('Failed to parse encrypted data: ' + err.message);
          setStep('error');
        });
    }
  }, [open, encryptedData]);

  const persistKeyPair = async (db: Promise<IDBPDatabase<KeyRequestDB>>, keyRequestContext: KeyRequestContext) => {
    if (!env.android) return;
    try {
      const db = await dbPromise;
      await db.put(KEY_REQUEST_STORE, { id: LATEST_CONTEXT, keyRequestContext });
    } catch (err) {
      console.error('Failed to serialize unlock key:', err);
    }
  }

  useEffect(() => {
    if (!open || chunks.length <= 1 || step !== 'display') return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % chunks.length);
    }, INTERVAL_QR_SEQUENCE);

    return () => clearInterval(interval);
  }, [open, chunks.length, step]);

  const handleProceedToInput = useCallback(() => {
    setStep('input');
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

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
      const decryptedData = await processKeyResponse(
        (keyResponse ?? inputValue).trim(),
        keyRequestContext.current,
        settings
      );

      // Validate JSON
      JSON.parse(decryptedData);

      setStep('success');
      setTimeout(() => {
        onDecrypted(decryptedData);
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
    }
  }, [inputValue, onDecrypted, onOpenChange]);

  //decrypt when reloading
  useEffect(() => {
    if (!searchParams.has("data")) return;

    (async () => {
      const db = await dbPromise;
      const entry = await db.get(KEY_REQUEST_STORE, LATEST_CONTEXT);
      if (!entry) return;
      (await dbPromise).delete(KEY_REQUEST_STORE, LATEST_CONTEXT);

      keyRequestContext.current = entry.keyRequestContext;
      handleSubmitDecrypted(searchParams.get("data"));
      setSearchParams({});
    })();

  }, [searchParams, setSearchParams, handleSubmitDecrypted]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmitDecrypted();
    }
  }, [handleSubmitDecrypted]);

  const handleSkip = useCallback(() => {
    // Download backup of encrypted vault data before replacing
    if (encryptedData) {
      const dataUrl = `data:application/octet-stream;base64,${encryptedData.substring(OMS_PREFIX.length)}`;
      (async () => {
        try {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          downloadVault(`Vault backup_${getTimestamp()}.json.oms00`, blob);
          toast({ title: 'Backup created', description: 'Encrypted vault data has been downloaded as a backup.' });
        } catch (e) {
          console.error('Failed to download backup:', e);
        }
      })();
    }
    onSkip?.();
    onOpenChange(false);
  }, [onSkip, onOpenChange, encryptedData]);

  const currentChunk = chunks[currentIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-[calc(100vw-2rem)] sm:max-w-lg ${hideCloseButton ? '[&>button]:hidden' : ''}`} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {env.android && (<KeyRound className="h-5 w-5" />)}
            {!env.android && (<QrCode className="h-5 w-5" />)}
            Decrypt Vault Data
          </DialogTitle>
          <DialogDescription>
            {step === 'loading' && 'Preparing decryption request...'}
            {step === 'display' && (env.android
              ? 'Send the key request to OneMoreSecret, then press UNLOCK or paste the key response below.'
              : 'Scan the QR code(s) with OneMoreSecret to get the decryption key')}
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

          {step === 'display' && currentChunk && (
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
              ) : (
                <>
                  <div className="p-4 bg-white rounded-lg">
                    <QRCodeSVG value={currentChunk.encoded} size={220} />
                  </div>
                  {chunks.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-muted-foreground">
                        {currentIndex + 1} / {chunks.length}
                      </span>
                      <div className="flex gap-1">
                        {chunks.map((_, idx) => (
                          <div
                            key={idx}
                            className={`w-2 h-2 rounded-full transition-colors ${idx === currentIndex ? 'bg-primary' : 'bg-muted'}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2 w-full">
                <Button onClick={handleProceedToInput} className="flex-1 gap-2">
                  <Upload className="h-4 w-4" />
                  Enter Key Response
                </Button>
              </div>
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
