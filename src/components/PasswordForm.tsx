import {
  useState,
  useEffect,
  useCallback
} from 'react';
import {
  PasswordEntry,
  CustomField,
  CustomFieldProtection,
  AppSettings,
  PasswordEntryHistoryItem
} from '@/types/types';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  X,
  QrCode,
  Eraser,
  Copy,
  History
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
import { OMS4WEB_REF, OMS_PREFIX } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface PasswordFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: PasswordEntry | null;
  onSave: (entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt' | 'history'>) => void;
  existingTags: string[];
  settings: AppSettings;
  readOnly?: boolean;
  historyItems?: PasswordEntryHistoryItem[];
  onSelectHistory?: (historyEntry: PasswordEntryHistoryItem | null) => void;
}

interface ProtectionOption {
  id: CustomFieldProtection;
  Icon: React.ComponentType<{ className?: string }>;
}

export function PasswordForm({
  open,
  onOpenChange,
  entry,
  onSave,
  existingTags,
  settings,
  readOnly = false,
  historyItems,
  onSelectHistory
}: PasswordFormProps) {
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
  const historyEntries = historyItems ?? [];
  const formatTimestamp = (timestamp: Date) => new Date(timestamp).toLocaleString();

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
    if (readOnly) return;
    setIsSubmitting(true);

    try {
      let finalPassword = password;

      // Check if password needs encryption
      if (password && !password.startsWith(OMS_PREFIX) && !password.startsWith(OMS4WEB_REF)) {
        if (settings.encryptionEnabled) {          
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
            if (field.value.startsWith(OMS4WEB_REF)) return field; //reference to another value 

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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <DialogTitle>{readOnly ? 'Entry History' : entry ? 'Edit Entry' : 'New Entry'}</DialogTitle>
          {entry && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="Entry history">
                  <History className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>History</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onSelectHistory?.(null)}>
                  Current version
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {historyEntries.length > 0 ? (
                  historyEntries.map((historyEntry, index) => (
                    <DropdownMenuItem
                      key={`${historyEntry.timestamp}-${index}`}
                      onClick={() => onSelectHistory?.(historyEntry)}
                      className="flex flex-col items-start"
                    >
                      <span className="text-sm">{formatTimestamp(historyEntry.timestamp)}</span>
                      <span className="text-xs text-muted-foreground truncate w-full">{historyEntry.data.title}</span>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>No history yet</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g., Gmail, Netflix, Bank..."
            autoFocus
            disabled={readOnly}
          />
        </div>

          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={readOnly}
          />
        </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username / Email</Label>
          <Input
            id="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="your@email.com"
            disabled={readOnly}
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
                  disabled={readOnly || passwordReadonly}
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
                    {!readOnly && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" onClick={() => erasePassword()}>
                            <Eraser className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Erase</TooltipContent>
                      </Tooltip>
                    )}
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
              {!readOnly && settings.encryptionEnabled && <PasswordGenerator onGenerate={handlePasswordGenerated} />}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Hashtags</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {hashtags.map(tag => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  #{tag}
                  {!readOnly && (
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  )}
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
                disabled={readOnly}
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
              disabled={readOnly}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Custom Fields</Label>
              {!readOnly && (
                <Button type="button" variant="outline" size="sm" onClick={addCustomField}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Field
                </Button>
              )}
            </div>
            {customFields.map(field => (
              <div key={field.id} className="flex gap-2 items-start p-3 rounded-lg bg-muted/50">
                <div className="flex-1 space-y-2">
                  <Input
                    value={field.label}
                    onChange={e => updateCustomField(field.id, { label: e.target.value })}
                    placeholder="Field name"
                    className="h-8"
                    disabled={readOnly}
                  />
                  <div className="flex gap-1">
                    <Input
                      value={field.value}
                      onChange={e => updateCustomField(field.id, { value: e.target.value })}
                      placeholder="Value"
                      type={field.protection !== 'none' ? 'password' : 'text'}
                      className="h-8 font-mono flex-1"
                      disabled={readOnly || field.readonly}
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
                        {!readOnly && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateCustomField(field.id, { value: '', readonly: false, protection: 'none' })}>
                                <Eraser className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Erase</TooltipContent>
                          </Tooltip>
                        )}
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
                      disabled={readOnly || field.readonly}
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
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCustomField(field.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || readOnly}>
              {isSubmitting ? 'Encrypting...' : entry ? 'Save Changes' : 'Create Entry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
