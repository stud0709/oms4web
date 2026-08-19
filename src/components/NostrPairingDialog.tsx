import React, { useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Radio,
  Clock,
  RefreshCw,
  Loader2,
  Smartphone,
  Unplug
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNostr } from '@/hooks/useNostr';
import { AppSettings } from '@/types/types';
import { toast } from '@/hooks/use-toast';

interface NostrPairingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings?: AppSettings;
}

export const NostrPairingDialog: React.FC<NostrPairingDialogProps> = ({
  open,
  onOpenChange,
  settings,
}) => {
  const {
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
  } = useNostr();

  // Always initiate a fresh pairing session whenever the dialog opens while not paired
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (open && !prevOpenRef.current && !isPaired) {
      startPairing(settings?.nostrRelays);
    }
    prevOpenRef.current = open;
  }, [open, isPaired, startPairing, settings?.nostrRelays]);

  // When pairing succeeds, show toast and close dialog automatically
  useEffect(() => {
    if (open && isPaired) {
      toast({
        title: 'Successfully connected',
        description: 'Connected to OneMoreSecret via Nostr.',
      });
      onOpenChange(false);
    }
  }, [open, isPaired, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            Nostr Relay Pairing
          </DialogTitle>
          <DialogDescription>
            {isPaired
              ? 'OneMoreSecret is paired wirelessly with oms4web.'
              : 'Scan the animated QR code with OneMoreSecret to pair.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-3">
          {isPaired ? (
            <div className="w-full p-6 bg-muted/40 rounded-xl flex flex-col items-center gap-4 text-center border">
              <div className="relative flex items-center justify-center my-2">
                <div className="absolute h-16 w-16 rounded-full bg-green-500/20 animate-ping" />
                <div className="relative h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 dark:text-green-400 border border-green-500/20">
                  <Smartphone className="h-7 w-7" />
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="font-semibold text-base">Pairing Active</h4>
                <p className="text-sm text-muted-foreground">
                  OneMoreSecret is paired and ready.
                </p>
              </div>
              <p className="text-xs text-muted-foreground/80 max-w-xs bg-background/50 px-3 py-2 rounded-md border">
                You can now send passwords directly to your phone and unlock your workspace wirelessly.
              </p>
              <div className="flex gap-2 w-full pt-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    disconnect();
                    onOpenChange(false);
                  }}
                  className="flex-1 gap-1.5"
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  className="flex-1"
                >
                  Done
                </Button>
              </div>
            </div>
          ) : pairingChunks.length > 0 && status !== 'timeout' ? (
            <>
              <div className="p-4 bg-white rounded-lg shadow-sm border">
                <QRCodeSVG
                  value={pairingChunks[currentChunkIndex]?.encoded || ''}
                  size={220}
                />
              </div>

              {pairingChunks.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {currentChunkIndex + 1} / {pairingChunks.length}
                  </span>
                  <div className="flex gap-1">
                    {pairingChunks.map((_, idx) => (
                      <div
                        key={idx}
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${
                          idx === currentChunkIndex ? 'bg-primary' : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {topicHex && (
                <div className="flex items-center gap-1.5 text-xs font-mono bg-muted/60 px-3 py-1.5 rounded-md border text-muted-foreground">
                  <span className="font-semibold text-foreground">Topic Prefix:</span>
                  <span className="font-bold tracking-wider text-primary">
                    {topicHex.substring(0, 8)}...
                  </span>
                </div>
              )}

              {/* Status Badges */}
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                {status === 'connecting' && (
                  <Badge variant="outline" className="gap-1.5 py-1">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    Connecting to relays ({connectedRelaysCount}/{totalRelaysCount})
                  </Badge>
                )}
                {status === 'listening' && (
                  <Badge variant="secondary" className="gap-1.5 py-1 bg-primary/10 text-primary">
                    <Radio className="h-3 w-3 animate-pulse text-primary" />
                    Listening on {connectedRelaysCount} relay(s)
                  </Badge>
                )}
                {status !== 'timeout' && (
                  <Badge variant="outline" className="gap-1 py-1 font-mono text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {remainingSeconds}s
                  </Badge>
                )}
              </div>
            </>
          ) : (
            <div className="p-8 bg-muted/40 rounded-lg flex flex-col items-center gap-3 text-center border w-full">
              <Clock className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">Nostr pairing session expired</p>
              <Button
                size="sm"
                onClick={() => startPairing(settings?.nostrRelays)}
                className="gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                Restart Pairing
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
