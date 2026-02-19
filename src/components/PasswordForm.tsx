import {
  useState,
  useEffect,
  useCallback
} from 'react';
import {
  PasswordEntry,
  CustomField,
  CustomFieldProtection,
  AppSettings
} from '@/types/types';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  X,
  QrCode,
  Eraser,
  Copy
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PasswordGenerator } from '@/components/PasswordGenerator';
import { useToast } from '@/hooks/use-toast';
import { createEncryptedMessage } from '@/lib/crypto';
import { OMS_PREFIX } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';

interface PasswordFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: PasswordEntry | null;
  onSave: (entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
  existingTags: string[];
  settings: AppSettings;
}

interface ProtectionOption {
  id: CustomFieldProtection;
  Icon: React.ComponentType<{ className?: string }>;
}

export function PasswordForm({ open, onOpenChange, entry, onSave, existingTags, settings }: PasswordFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  }, [toast]);
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [passwordReadonly, setPasswordReadonly] = useState(false);

  useEffect(() => {
    if (entry) {
      setTitle(entry.title);
      setUsername(entry.username);
      setPassword(entry.password);
      setUrl(entry.url);
      setNotes(entry.notes);
      setHashtags(entry.hashtags);
      setCustomFields(entry.customFields);
      setPasswordReadonly(entry.passwordReadonly);
    } else {
      resetForm();
    }
  }, [entry, open]);

  const resetForm = () => {
    setTitle('');
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setUrl('');
    setNotes('');
    setHashtags([]);
    setTagInput('');
    setCustomFields([]);
    setPasswordReadonly(false);
  };

  const handlePasswordGenerated = (generatedPassword: string) => {
    setPassword(generatedPassword);
    setShowPassword(true);
    setPasswordReadonly(false);
  };

  const erasePassword = useCallback(() => {
    setPassword('');
    if (entry) {
      setPasswordReadonly(false);
    }
  }, [entry]);

  const addTag = (tag: string) => {
    const cleanTag = tag.trim().replace(/[^a-zA-Z0-9-]/g, '');
    if (cleanTag && !hashtags.includes(cleanTag)) {
      setHashtags([...hashtags, cleanTag]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setHashtags(hashtags.filter(t => t !== tag));
  };

  const addCustomField = () => {
    setCustomFields([
      ...customFields,
      { id: crypto.randomUUID(), label: '', value: '', protection: 'none', readonly: false },
    ]);
  };

  const updateCustomField = (id: string, updates: Partial<CustomField>) => {
    setCustomFields(customFields.map(f => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeCustomField = (id: string) => {
    setCustomFields(customFields.filter(f => f.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      let finalPassword = password;

      // Check if password needs encryption
      if (password && !password.startsWith(OMS_PREFIX)) {
        if (settings.encryptionEnabled) {
          // Encryption is required
          if (!settings.publicKey) {
            toast({
              title: 'Cannot save entry',
              description: 'Encryption is enabled but no public key is configured. Please add your public key in Settings.',
              variant: 'destructive',
            });
            setIsSubmitting(false);
            return;
          }
          try {
            finalPassword = await createEncryptedMessage(password, settings);
          } catch (err) {
            toast({
              title: 'Encryption failed',
              description: 'Could not encrypt password. Please check your public key settings.',
              variant: 'destructive',
            });
            setIsSubmitting(false);
            return;
          }
        } else {
          // Encryption is disabled - block saving plain text passwords
          toast({
            title: 'Cannot save plain text passwords',
            description: 'Enable "password generator & encryption" in Settings to save password entries.',
            variant: 'destructive',
          });
          setIsSubmitting(false);
          return;
        }
      }

      //check if custom fields need encryption
      const finalCustomFields = await Promise.all(
        customFields
          .filter(f => f.label.trim())
          .map(async field => {
            if (!field.value.trim()) {
              field.protection = 'none'; //reset protection settings
              return field; //empty
            }
            if (field.value.startsWith(OMS_PREFIX)) {
              field.protection = 'encrypted';
              field.readonly = true;
              return field; //already encrypted
            }
            if (field.protection !== 'encrypted') return field; //plain text            

            // Encryption is required
            field.value = await createEncryptedMessage(field.value, settings);
            field.readonly = true; //encrypted value cannot be changed manually
            return field;
          }));

      onSave({
        title: title.trim() || 'Untitled',
        username,
        password: finalPassword,
        passwordReadonly: finalPassword.startsWith(OMS_PREFIX),
        url,
        notes,
        hashtags,
        customFields: finalCustomFields,
      });
      onOpenChange(false);
      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const suggestedTags = existingTags.filter(
    tag => !hashtags.some(h => h.toLowerCase() === tag.toLowerCase()) && tag.toLowerCase().includes(tagInput.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit Entry' : 'New Entry'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Gmail, Netflix, Bank..."
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com"
              type="url"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username / Email</Label>
            <Input
              id="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="flex gap-2">
              <div className="flex flex-1 gap-1">
                <Input
                  id="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="flex-1 font-mono"
                  disabled={passwordReadonly}
                />
                {passwordReadonly && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" onClick={() => copyToClipboard(password)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" onClick={() => erasePassword()}>
                          <Eraser className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Erase</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {!passwordReadonly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                )}
              </div>
              {settings.encryptionEnabled && <PasswordGenerator onGenerate={handlePasswordGenerated} />}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Hashtags</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {hashtags.map(tag => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  #{tag}
                  <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="relative">
              <Input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                onBlur={(e) => {
                  const related = e.relatedTarget as HTMLElement | null;
                  if (related?.closest('[data-tag-suggestion]')) return;
                  if (tagInput.trim()) {
                    addTag(tagInput);
                  }
                }}
                placeholder="Type and press Enter to add..."
              />
              {tagInput && suggestedTags.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-10 max-h-32 overflow-y-auto">
                  {suggestedTags.slice(0, 5).map(tag => (
                    <button
                      key={tag}
                      type="button"
                      data-tag-suggestion
                      className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                      onClick={() => addTag(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional notes, recovery codes, security questions..."
              rows={3}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Custom Fields</Label>
              <Button type="button" variant="outline" size="sm" onClick={addCustomField}>
                <Plus className="h-4 w-4 mr-1" />
                Add Field
              </Button>
            </div>
            {customFields.map(field => (
              <div key={field.id} className="flex gap-2 items-start p-3 rounded-lg bg-muted/50">
                <div className="flex-1 space-y-2">
                  <Input
                    value={field.label}
                    onChange={e => updateCustomField(field.id, { label: e.target.value })}
                    placeholder="Field name"
                    className="h-8"
                  />
                  <div className="flex gap-1">
                    <Input
                      value={field.value}
                      onChange={e => updateCustomField(field.id, { value: e.target.value })}
                      placeholder="Value"
                      type={field.protection !== 'none' ? 'password' : 'text'}
                      className="h-8 font-mono flex-1"
                      disabled={field.readonly}
                    />
                    {field.readonly && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(field.value)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateCustomField(field.id, { value: '', readonly: false, protection: 'none' })}>
                              <Eraser className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Erase</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* The "Label" is now just a subtle text prefix or you can remove it entirely */}
                    <span className="text-xs font-semibold text-muted-foreground tracking-wider">
                      Protection:
                    </span>

                    <RadioGroup
                      className="flex flex-row gap-1"
                      value={field.protection}
                      onValueChange={v => updateCustomField(field.id, { protection: v as CustomFieldProtection })}
                      disabled={field.readonly}
                    >
                      {([
                        { id: 'none', Icon: Eye },
                        { id: 'secret', Icon: EyeOff },
                        { id: 'encrypted', Icon: QrCode },
                      ] as ProtectionOption[])
                        .filter(option => (settings.encryptionEnabled) || option.id !== 'encrypted')
                        .map(({ id, Icon }) => (
                          <div key={id} className="relative">
                            <RadioGroupItem
                              value={id}
                              id={`${id}-${field.id}`}
                              className="peer sr-only"
                            />
                            <Label
                              htmlFor={`${id}-${field.id}`}
                              className="flex h-8 w-8 items-center justify-center rounded-sm cursor-pointer transition-all 
                     text-muted-foreground 
                     hover:bg-background/50 hover:text-foreground
                     peer-data-[state=checked]:bg-background 
                     peer-data-[state=checked]:text-primary 
                     peer-data-[state=checked]:shadow-sm"
                            >
                              <Icon className="h-4 w-4" />
                            </Label>
                          </div>
                        ))}
                    </RadioGroup>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCustomField(field.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          </div>
          <DialogFooter className="pt-4 border-t border-border shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Encrypting...' : entry ? 'Save Changes' : 'Create Entry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
