import { useState, useEffect, useMemo } from 'react';
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
  validatePublicKey,
} from '@/lib/crypto';
import { RSA_TRANSFORMATIONS } from "@/lib/constants";
import { AppSettings, WorkspaceProtection } from "@/types/types";
import { AES_KEY_LENGTHS } from "@/lib/constants";
import { AES_TRANSFORMATIONS } from "@/lib/constants";
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getEnvironment } from '@/hooks/useEncryptedVault';

interface SettingsDialogProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
}

export function SettingsDialog({
  settings,
  onSaveSettings,
}: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [newSettings, setNewSettings] = useState(settings);
  const { toast } = useToast();
  const [keyValid, setKeyValid] = useState(false);
  const env = useMemo(() => getEnvironment(), []);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) setNewSettings(settings);
    setOpen(newOpen);
  };

  //validating the key
  useEffect(() => {
    (async () => {
      const valid = await validatePublicKey(newSettings.publicKey, newSettings.rsaTransformationIdx);
      setKeyValid(valid);
      if (!valid && newSettings.workspaceProtection !== 'none')
        setNewSettings({ ...newSettings, workspaceProtection: 'none' });
    })();
  }, [newSettings.publicKey, newSettings.rsaTransformationIdx]);

  const handleSave = () => {
    // Validate public key format for encrypt and pin modes
    if (newSettings.publicKey && !keyValid) {
      toast({
        title: 'Invalid public key',
        description: 'This requires a base64-encoded X509 public key',
        variant: 'destructive',
      });
      return;
    }
    onSaveSettings(newSettings);
    toast({ title: 'Settings saved', description: 'Settings have been updated.' });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              value={newSettings.vaultName}
              onChange={(e) => setNewSettings({ ...newSettings, vaultName: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Displayed in the header and used as export filename
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="publicKey">Public Key (X509, Base64 encoded)</Label>
            <Textarea
              id="publicKey"
              placeholder={`Go to OneMoreSecret Settings - Private Keys, select the key, ${env.android ? 'copy your public key to the clipboard and paste it here' : 'press TYPE'}`}
              value={newSettings.publicKey}
              onChange={(e) => setNewSettings({ ...newSettings, publicKey: e.target.value })}
              rows={6}
              className="font-mono text-sm"
            />
          </div>
          {keyValid && (<>
            <div className="space-y-3 p-3 rounded-lg bg-muted/50">
              <Label className="font-medium">Workspace Protection</Label>
              <RadioGroup
                value={newSettings.workspaceProtection}
                onValueChange={(v) => setNewSettings({ ...newSettings, workspaceProtection: v as WorkspaceProtection })}>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="none" id="protection-none" className="mt-1" />
                  <div>
                    <Label htmlFor="protection-none" className="font-normal cursor-pointer">⚠️ None</Label>
                    <p className="text-xs text-muted-foreground">Local storage file not encrypted</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="encrypt" id="protection-encrypt" className="mt-1" />
                  <div>
                    <Label htmlFor="protection-encrypt" className="font-normal cursor-pointer">Encrypt Local Storage</Label>
                    <p className="text-xs text-muted-foreground">Clears memory, displays encryption dialog</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value="pin" id="protection-pin" className="mt-1" />
                  <div>
                    <Label htmlFor="protection-pin" className="font-normal cursor-pointer">Lock Workspace</Label>
                    <p className="text-xs text-muted-foreground">Requires PIN via QR code to unlock</p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            <div className="flex items-center justify-between p-3">
              <Label htmlFor="encryptionEnabled" className="font-medium">
                Password generator & encryption
              </Label>
              <Switch
                id="encryptionEnabled"
                checked={newSettings.encryptionEnabled}
                onCheckedChange={encryptionEnabled => setNewSettings({ ...newSettings, encryptionEnabled })}
              />
            </div>
          </>)}

          <div className="flex items-center justify-between p-3">
            <Label htmlFor="encryptionEnabled" className="font-medium">
              Expert Mode
            </Label>
            <Switch
              id="expertModeEnabled"
              checked={newSettings.expertMode}
              onCheckedChange={expertMode => setNewSettings({ ...newSettings, expertMode })}
            />
          </div>

          {//Expert Mode Settings
            newSettings.expertMode && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rsaTransformation">RSA Transformation</Label>
                  <Select
                    value={String(newSettings.rsaTransformationIdx)}
                    onValueChange={v => setNewSettings({ ...newSettings, rsaTransformationIdx: Number(v) })}>
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
                  <Select
                    value={String(newSettings.aesKeyLength)}
                    onValueChange={v => setNewSettings({ ...newSettings, aesKeyLength: Number(v) })}>
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
                  <Select
                    value={String(newSettings.aesTransformationIdx)}
                    onValueChange={v => setNewSettings({ ...newSettings, aesTransformationIdx: Number(v) })}>
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
                </div></>)}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
