import { useState, useEffect, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Camera, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getQrSequence, QrChunk } from '@/lib/qrUtil';

interface DecryptQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  encryptedData: string;
  onDecrypted: (data: string) => void;
  onSkip?: () => void;
}

type Step = 'display' | 'input' | 'success';

export function DecryptQrDialog({ 
  open, 
  onOpenChange, 
  encryptedData,
  onDecrypted,
  onSkip
}: DecryptQrDialogProps) {
  const [chunks, setChunks] = useState<QrChunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<Step>('display');
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && encryptedData) {
      const qrChunks = getQrSequence(encryptedData);
      setChunks(qrChunks);
      setCurrentIndex(0);
      setStep('display');
      setInputValue('');
      setError(null);
    }
  }, [open, encryptedData]);

  useEffect(() => {
    if (!open || chunks.length <= 1 || step !== 'display') return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % chunks.length);
    }, 500);

    return () => clearInterval(interval);
  }, [open, chunks.length, step]);

  const handleProceedToInput = useCallback(() => {
    setStep('input');
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const handleSubmitDecrypted = useCallback(() => {
    if (!inputValue.trim()) {
      setError('Please paste the decrypted data');
      return;
    }

    try {
      // Validate JSON
      JSON.parse(inputValue.trim());
      setStep('success');
      setTimeout(() => {
        onDecrypted(inputValue.trim());
        onOpenChange(false);
      }, 1000);
    } catch {
      setError('Invalid JSON format. Please ensure you pasted the complete decrypted data.');
    }
  }, [inputValue, onDecrypted, onOpenChange]);

  const handleSkip = useCallback(() => {
    onSkip?.();
    onOpenChange(false);
  }, [onSkip, onOpenChange]);

  const currentChunk = chunks[currentIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Decrypt Vault Data
          </DialogTitle>
          <DialogDescription>
            {step === 'display' && 'Scan the QR code(s) with your device to decrypt the vault'}
            {step === 'input' && 'Paste the decrypted data from your device'}
            {step === 'success' && 'Decryption successful!'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {step === 'display' && currentChunk && (
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
                        className={`w-2 h-2 rounded-full transition-colors ${
                          idx === currentIndex ? 'bg-primary' : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                {chunks.length > 1 
                  ? 'Scan all QR codes in sequence with OMS Companion to decrypt the vault data'
                  : 'Scan this QR code with OMS Companion to decrypt the vault data'
                }
              </p>
              <div className="flex gap-2 w-full">
                <Button onClick={handleProceedToInput} className="flex-1 gap-2">
                  <Upload className="h-4 w-4" />
                  I've Scanned - Enter Decrypted Data
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
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Camera className="h-4 w-4" />
                  Paste the decrypted JSON data from your device
                </div>
                <Textarea
                  ref={textareaRef}
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    setError(null);
                  }}
                  placeholder='{"entries": [...], "publicKey": "...", ...}'
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
                <Button onClick={handleSubmitDecrypted} className="flex-1 gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Load Data
                </Button>
              </div>
            </>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-sm font-medium">Vault loaded successfully!</p>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
