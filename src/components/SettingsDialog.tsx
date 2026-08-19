import {
  useState,
  useEffect,
  useMemo
} from 'react';
import { Settings, Plus, Trash2, RotateCcw, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
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
import { DEFAULT_NOSTR_RELAYS, RSA_TRANSFORMATIONS } from "@/lib/constants";
import {
  AppSettings,
  WorkspaceProtection
} from "@/types/types";
import { AES_KEY_LENGTHS } from "@/lib/constants";
import { AES_TRANSFORMATIONS } from "@/lib/constants";
import {
  RadioGroup,
  RadioGroupItem
} from '@/components/ui/radio-group';
import { downloadVaultBackupFromBytes, getEnvironment, validateSettings } from '@/hooks/useEncryptedVault';
import { oms4webDbPromise, STORAGE_KEY, VAULT_STORE_V3 } from '@/lib/db';

interface SettingsDialogProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onNewEmptyVault: () => void;
}

export function SettingsDialog({
  settings,
  onSaveSettings,
  onNewEmptyVault,
}: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [newSettings, setNewSettings] = useState(settings);
  const [newRelayInput, setNewRelayInput] = useState('');
  const { toast } = useToast();
  const [keyValid, setKeyValid] = useState(false);
  const env = useMemo(() => getEnvironment(), []);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setNewSettings(settings);
      setNewRelayInput('');
    }
    setOpen(newOpen);
  };

  const handleAddRelay = () => {
    const trimmed = newRelayInput.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('wss://') && !trimmed.startsWith('ws://')) {
      toast({
        title: 'Invalid relay URL',
        description: 'Relay URL must start with wss:// or ws://',
        variant: 'destructive',
      });
      return;
    }
    const currentRelays = newSettings.nostrRelays || DEFAULT_NOSTR_RELAYS;
    if (currentRelays.includes(trimmed)) {
      toast({
        title: 'Duplicate relay',
        description: 'This relay is already in the list',
        variant: 'destructive',
      });
      return;
    }
    setNewSettings({
      ...newSettings,
      nostrRelays: [...currentRelays, trimmed],
    });
    setNewRelayInput('');
  };

  const handleRemoveRelay = (urlToRemove: string) => {
    const currentRelays = newSettings.nostrRelays || DEFAULT_NOSTR_RELAYS;
    setNewSettings({
      ...newSettings,
      nostrRelays: currentRelays.filter(url => url !== urlToRemove),
    });
  };

  const handleResetRelays = () => {
    setNewSettings({
      ...newSettings,
      nostrRelays: [...DEFAULT_NOSTR_RELAYS],
    });
    toast({ title: 'Relays reset', description: 'Reset to default Nostr relays.' });
  };

  //validating the key
  useEffect(() => {
    (async () => {
      const valid = await validatePublicKey(newSettings.publicKey, newSettings.rsaTransformationIdx);
      setKeyValid(valid);
      if (!valid && newSettings.workspaceProtection !== 'none')
        setNewSettings({ ...newSettings, workspaceProtection: 'none' });
    })();
  }, [newSettings]);

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

    validateSettings(newSettings);

    onSaveSettings(newSettings);
    toast({ title: 'Settings saved', description: 'Settings have been updated.' });
    setOpen(false);
  };

  const resetVault = async () => {
    try {
      const db = await oms4webDbPromise;
      const stored = await db.get(VAULT_STORE_V3, STORAGE_KEY);

      if (stored?.vault) {
        const res = downloadVaultBackupFromBytes(stored.vault);
        toast({
          title: 'Backup created',
          description: `Downloaded ${res.isJson ? 'JSON' : 'encrypted'} vault backup before resetting.`
        });
      }
    } catch (e) {
      console.error('Failed to download backup before reset:', e);
    }

    onNewEmptyVault();
    toast({ title: 'New vault created', description: 'Local vault has been reset to an empty vault.' });
    setConfirmResetOpen(false);
    setOpen(false);
  };

  const TriggerButton = (
    <span className="inline-flex">
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
    </span>
  );

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            {TriggerButton}
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
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
            {keyValid && (
              <>
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
                    {(env.android === false || newSettings.workspaceProtection === 'quickUnlock') && (
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="quickUnlock" id="protection-qu" className="mt-1" />
                        <div>
                          <Label htmlFor="protection-qu" className="font-normal cursor-pointer">Quick Unlock</Label>
                          <p className="text-xs text-muted-foreground">{env.android ? "On Android, Encrypt mode is used instead" : "PIN on startup and to unlock workspace"}</p>
                        </div>
                      </div>)}
                    {(env.android === false || newSettings.workspaceProtection === 'pin') && (
                      <div className="flex items-start space-x-3">
                        <RadioGroupItem value="pin" id="protection-pin" className="mt-1" />
                        <div>
                          <Label htmlFor="protection-pin" className="font-normal cursor-pointer">Lock Workspace</Label>
                          <p className="text-xs text-muted-foreground">{env.android ? "On Android, Encrypt mode ist used instead" : "Decryption on start, PIN to unlock workspace"}</p>
                        </div>
                      </div>)}
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="encrypt" id="protection-encrypt" className="mt-1" />
                      <div>
                        <Label htmlFor="protection-encrypt" className="font-normal cursor-pointer">Encrypt Local Storage</Label>
                        <p className="text-xs text-muted-foreground">Decryption on start and to unlock workspace</p>
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
              </>
            )}

            <div className="flex items-center justify-between p-3">
              <Label htmlFor="expertModeEnabled" className="font-medium">
                Expert Mode
              </Label>
              <Switch
                id="expertModeEnabled"
                checked={newSettings.expertMode}
                onCheckedChange={expertMode => setNewSettings({ ...newSettings, expertMode })}
              />
            </div>

            {newSettings.expertMode && (
              <div className="space-y-4">
                <div className="space-y-3 p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5 pr-2">
                      <div className="flex items-center gap-2">
                        <Radio className="h-4 w-4 text-primary" />
                        <Label htmlFor="nostrPairingEnabled" className="font-medium cursor-pointer">
                          Nostr Relay Pairing
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Enables real-time wireless key exchange and pairing with OneMoreSecret via Nostr relays.
                      </p>
                    </div>
                    <Switch
                      id="nostrPairingEnabled"
                      checked={newSettings.enableNostrPairing !== false}
                      onCheckedChange={enableNostrPairing => setNewSettings({ ...newSettings, enableNostrPairing })}
                    />
                  </div>

                  {newSettings.enableNostrPairing !== false && (
                    <div className="space-y-3 pt-2 border-t border-border/50">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Preferred Relays
                        </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleResetRelays}
                          className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset Defaults
                        </Button>
                      </div>

                      <div className="space-y-1.5">
                        {(newSettings.nostrRelays || DEFAULT_NOSTR_RELAYS).map((relayUrl) => (
                          <div
                            key={relayUrl}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-background text-xs font-mono border border-border"
                          >
                            <span className="truncate mr-2">{relayUrl}</span>
                            {(newSettings.nostrRelays || DEFAULT_NOSTR_RELAYS).length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                                onClick={() => handleRemoveRelay(relayUrl)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <Input
                          placeholder="wss://relay.example.com"
                          value={newRelayInput}
                          onChange={(e) => setNewRelayInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddRelay();
                            }
                          }}
                          className="text-xs font-mono h-8"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleAddRelay}
                          className="h-8 text-xs gap-1 shrink-0"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {keyValid && (
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
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div>
                <p className="text-sm font-medium text-destructive">Danger Zone</p>
                <p className="text-xs text-muted-foreground">
                  Creates a new empty vault in this browser. Before resetting, a backup of your current vault will be downloaded.
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setConfirmResetOpen(true)}>
                New empty vault
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>

          <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>New empty vault</AlertDialogTitle>
                <AlertDialogDescription>
                  A backup file will be downloaded first. After that, your local vault will be replaced with an empty vault.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={resetVault}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Create empty vault
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
