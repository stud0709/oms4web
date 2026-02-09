import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getQrSequence } from '@/lib/qrUtil';
import { INTERVAL_QR_SEQUENCE } from "@/lib/constants";
import { QrChunk } from "@/types/types";

interface AirGapQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  password: string;
}

export function AirGapQrDialog({ open, onOpenChange, password }: AirGapQrDialogProps) {
  const [chunks, setChunks] = useState<QrChunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (open && password) {
      const qrChunks = getQrSequence(password);
      setChunks(qrChunks);
      setCurrentIndex(0);
    }
  }, [open, password]);

  useEffect(() => {
    if (!open || chunks.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % chunks.length);
    }, INTERVAL_QR_SEQUENCE);

    return () => clearInterval(interval);
  }, [open, chunks.length]);

  const currentChunk = chunks[currentIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Air Gap - QR Code
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          {currentChunk && (
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
              <p className="text-sm text-muted-foreground text-center">
                {chunks.length > 1 
                  ? 'Scan all QR codes in sequence to transfer the password'
                  : 'Scan this QR code to transfer the password securely'
                }
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
