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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
  WorkspaceProtection,
} from '@/lib/crypto';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface SettingsDialogProps {
  publicKey: string;
  encryptionSettings: EncryptionSettings;
  encryptionEnabled: boolean;
  vaultName: string;
  workspaceProtection: WorkspaceProtection;
  onSavePublicKey: (key: string) => void;
  onSaveEncryptionSettings: (settings: EncryptionSettings) => void;
  onSaveEncryptionEnabled: (enabled: boolean) => void;
  onSaveVaultName: (name: string) => void;
  onSaveWorkspaceProtection: (protection: WorkspaceProtection) => void;
}

export function SettingsDialog({
  publicKey,
  encryptionSettings,
  encryptionEnabled,
  vaultName,
  workspaceProtection,
  onSavePublicKey,
  onSaveEncryptionSettings,
  onSaveEncryptionEnabled,
  onSaveVaultName,
  onSaveWorkspaceProtection,
}: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [keyValue, setKeyValue] = useState(publicKey);
  const [rsaIdx, setRsaIdx] = useState(encryptionSettings.rsaTransformationIdx);
  const [aesKeyLen, setAesKeyLen] = useState(encryptionSettings.aesKeyLength);
  const [aesIdx, setAesIdx] = useState(encryptionSettings.aesTransformationIdx);
  const [encEnabled, setEncEnabled] = useState(encryptionEnabled);
  const [nameValue, setNameValue] = useState(vaultName);
  const [protection, setProtection] = useState<WorkspaceProtection>(workspaceProtection);
  const { toast } = useToast();

  useEffect(() => {
    setKeyValue(publicKey);
    setRsaIdx(encryptionSettings.rsaTransformationIdx);
    setAesKeyLen(encryptionSettings.aesKeyLength);
    setAesIdx(encryptionSettings.aesTransformationIdx);
    setEncEnabled(encryptionEnabled);
    setNameValue(vaultName);
    setProtection(workspaceProtection);
  }, [publicKey, encryptionSettings, encryptionEnabled, vaultName, workspaceProtection]);

  const handleSave = () => {
    // Validate public key format for encrypt and pin modes
    if ((protection === 'encrypt' || protection === 'pin') && keyValue.trim() && !/^[A-Za-z0-9+/=\s]+$/.test(keyValue.trim())) {
      toast({
        title: 'Invalid format',
        description: 'Public key must be base64 encoded.',
        variant: 'destructive',
      });
      return;
    }
    // Warn if encrypt/pin mode but no key
    if ((protection === 'encrypt' || protection === 'pin') && !keyValue.trim()) {
      toast({
        title: 'Warning',
        description: 'No public key set. Encryption features will not work properly.',
        variant: 'destructive',
      });
    }
    onSavePublicKey(keyValue.trim());
    onSaveEncryptionSettings({
      rsaTransformationIdx: rsaIdx,
      aesKeyLength: aesKeyLen,
      aesTransformationIdx: aesIdx,
    });
    onSaveEncryptionEnabled(encEnabled);
    onSaveVaultName(nameValue.trim());
    onSaveWorkspaceProtection(protection);
    toast({ title: 'Settings saved', description: 'Settings have been updated.' });
    setOpen(false);
  };

  const showEncryptionSettings = protection === 'encrypt' || protection === 'pin';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" title="Settings">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="vaultName">Vault Name</Label>
            <Input
              id="vaultName"
              placeholder="Enter vault name..."
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Displayed in the header and used as export filename
            </p>
          </div>

          <div className="space-y-3 p-3 rounded-lg bg-muted/50">
            <Label className="font-medium">Workspace Protection</Label>
            <RadioGroup value={protection} onValueChange={(v) => setProtection(v as WorkspaceProtection)}>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="none" id="protection-none" className="mt-1" />
                <div>
                  <Label htmlFor="protection-none" className="font-normal cursor-pointer">None</Label>
                  <p className="text-xs text-muted-foreground">Local storage file not encrypted</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="encrypt" id="protection-encrypt" className="mt-1" />
                <div>
                  <Label htmlFor="protection-encrypt" className="font-normal cursor-pointer">Encrypt Local Storage</Label>
                  <p className="text-xs text-muted-foreground">Full encryption of local storage using your public key</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="pin" id="protection-pin" className="mt-1" />
                <div>
                  <Label htmlFor="protection-pin" className="font-normal cursor-pointer">Lock Workspace</Label>
                  <p className="text-xs text-muted-foreground">Local file not encrypted, but requires PIN via QR code to access</p>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="space-y-0.5">
              <Label htmlFor="encryptionEnabled" className="font-medium">
                Enable password generator & encryption
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, passwords will be encrypted and the generator will be available
              </p>
            </div>
            <Switch
              id="encryptionEnabled"
              checked={encEnabled}
              onCheckedChange={setEncEnabled}
            />
          </div>

          {showEncryptionSettings && (
            <>
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
            </>
          )}
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
