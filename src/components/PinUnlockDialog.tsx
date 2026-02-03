import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Lock, QrCode, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createEncryptedMessage, EncryptionSettings } from '@/lib/crypto';
import { getQrSequence, QrChunk, INTERVAL_QR_SEQUENCE } from '@/lib/qrUtil';
import crypto from "crypto"

interface PinUnlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicKey: string;
  encryptionSettings: EncryptionSettings;
  onUnlock: () => void;
  onSkip: () => void;
  hideCloseButton?: boolean;
}

function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function digest(message) {
  const msgUint8 = new TextEncoder().encode(message);                           
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);           
  const hashArray = Array.from(new Uint8Array(hashBuffer));                     
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function PinUnlockDialog({
  open,
  onOpenChange,
  publicKey,
  encryptionSettings,
  onUnlock,
  hideCloseButton,
}: PinUnlockDialogProps) {
  const [hashedPin, setHashedPin] = useState<string>('');
  const [encryptedPin, setEncryptedPin] = useState<string>('');
  const [chunks, setChunks] = useState<QrChunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Generate and encrypt PIN when dialog opens
  useEffect(() => {
    if (!open || !publicKey) return;

    const initPin = async () => {
      setIsLoading(true);
      const newPin = generatePin();
      //save pin's hash to compare later
      const hashedPin = await digest(newPin)
      setHashedPin(hashedPin);
      
      try {
        const encrypted = await createEncryptedMessage(`${newPin}\n`, publicKey, encryptionSettings);
        setEncryptedPin(encrypted);
        const qrChunks = getQrSequence(encrypted);
        setChunks(qrChunks);
        setCurrentIndex(0);
      } catch (err) {
        console.error('Failed to encrypt PIN:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initPin();
    setInputValue('');
    setError('');
  }, [open, publicKey, encryptionSettings]);

  // Cycle through QR chunks
  useEffect(() => {
    if (!open || chunks.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % chunks.length);
    }, INTERVAL_QR_SEQUENCE);

    return () => clearInterval(interval);
  }, [open, chunks.length]);

  const handleVerify = useCallback(async () => {
    const hashedInput = await digest(inputValue)
    if (hashedInput === hashedPin) {
      onUnlock();
    } else {
      setError('Incorrect PIN. Please try again.');
      setInputValue('');
    }
  }, [inputValue, hashedPin, onUnlock]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleVerify();
    }
  };

  const currentChunk = chunks[currentIndex];

  return (
    <Dialog open={open} onOpenChange={hideCloseButton ? undefined : onOpenChange}>
      <DialogContent 
        className="sm:max-w-md"
        onPointerDownOutside={(e) => hideCloseButton && e.preventDefault()}
        onEscapeKeyDown={(e) => hideCloseButton && e.preventDefault()}
        hideCloseButton={hideCloseButton}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Workspace Locked
          </DialogTitle>
          <DialogDescription>
            Scan the QR code with OMS Companion to decrypt the PIN, then enter it below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {isLoading ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generating secure PIN...</p>
            </div>
          ) : currentChunk ? (
            <>
              <div className="p-4 bg-white rounded-lg">
                <QRCodeSVG value={currentChunk.encoded} size={200} />
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
                        className={`w-2 h-2 rounded-full transition-colors ${
                          idx === currentIndex ? 'bg-primary' : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-4">
              <QrCode className="h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No public key configured</p>
            </div>
          )}

          <div className="w-full space-y-4 pt-4 border-t">
            <div className="space-y-2">
              <Label htmlFor="pin">Enter 6-digit PIN</Label>
              <Input
                id="pin"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                value={inputValue}
                onChange={(e) => {
                  setError('');
                  setInputValue(e.target.value.replace(/\D/g, ''));
                }}
                onKeyDown={handleKeyDown}
                className="text-center text-2xl tracking-widest font-mono"
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <div className="flex gap-2">
              <Button 
                className="flex-1"
                onClick={handleVerify}
                disabled={inputValue.length !== 6}
              >
                Unlock
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
