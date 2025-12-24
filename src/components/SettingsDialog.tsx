import { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface SettingsDialogProps {
  publicKey: string;
  onSavePublicKey: (key: string) => void;
}

export function SettingsDialog({ publicKey, onSavePublicKey }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [keyValue, setKeyValue] = useState(publicKey);
  const { toast } = useToast();

  useEffect(() => {
    setKeyValue(publicKey);
  }, [publicKey]);

  const handleSave = () => {
    // Basic validation: check if it looks like base64
    if (keyValue.trim() && !/^[A-Za-z0-9+/=\s]+$/.test(keyValue.trim())) {
      toast({
        title: 'Invalid format',
        description: 'Public key must be base64 encoded.',
        variant: 'destructive',
      });
      return;
    }
    onSavePublicKey(keyValue.trim());
    toast({ title: 'Settings saved', description: 'Public key has been updated.' });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" title="Settings">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="publicKey">Public Key (X509, Base64 encoded)</Label>
            <Textarea
              id="publicKey"
              placeholder="Paste your base64-encoded X509 public key here..."
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              The public key will be used for encryption in a future update.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
