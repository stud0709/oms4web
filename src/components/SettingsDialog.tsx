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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  RSA_TRANSFORMATIONS,
  AES_TRANSFORMATIONS,
  AES_KEY_LENGTHS,
  EncryptionSettings,
  DEFAULT_ENCRYPTION_SETTINGS,
} from '@/lib/crypto';

interface SettingsDialogProps {
  publicKey: string;
  encryptionSettings: EncryptionSettings;
  onSavePublicKey: (key: string) => void;
  onSaveEncryptionSettings: (settings: EncryptionSettings) => void;
}

export function SettingsDialog({
  publicKey,
  encryptionSettings,
  onSavePublicKey,
  onSaveEncryptionSettings,
}: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [keyValue, setKeyValue] = useState(publicKey);
  const [rsaIdx, setRsaIdx] = useState(encryptionSettings.rsaTransformationIdx);
  const [aesKeyLen, setAesKeyLen] = useState(encryptionSettings.aesKeyLength);
  const [aesIdx, setAesIdx] = useState(encryptionSettings.aesTransformationIdx);
  const { toast } = useToast();

  useEffect(() => {
    setKeyValue(publicKey);
    setRsaIdx(encryptionSettings.rsaTransformationIdx);
    setAesKeyLen(encryptionSettings.aesKeyLength);
    setAesIdx(encryptionSettings.aesTransformationIdx);
  }, [publicKey, encryptionSettings]);

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
    onSaveEncryptionSettings({
      rsaTransformationIdx: rsaIdx,
      aesKeyLength: aesKeyLen,
      aesTransformationIdx: aesIdx,
    });
    toast({ title: 'Settings saved', description: 'Encryption settings have been updated.' });
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="rsaTransformation">RSA Transformation</Label>
            <Select value={String(rsaIdx)} onValueChange={(v) => setRsaIdx(Number(v))}>
              <SelectTrigger id="rsaTransformation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(RSA_TRANSFORMATIONS).map((t) => (
                  <SelectItem key={t.idx} value={String(t.idx)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aesKeyLength">AES Key Length</Label>
            <Select value={String(aesKeyLen)} onValueChange={(v) => setAesKeyLen(Number(v))}>
              <SelectTrigger id="aesKeyLength">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AES_KEY_LENGTHS.map((len) => (
                  <SelectItem key={len} value={String(len)}>
                    {len} bits
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aesTransformation">AES Transformation</Label>
            <Select value={String(aesIdx)} onValueChange={(v) => setAesIdx(Number(v))}>
              <SelectTrigger id="aesTransformation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AES_TRANSFORMATIONS.map((t) => (
                  <SelectItem key={t.idx} value={String(t.idx)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
