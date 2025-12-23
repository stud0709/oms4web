import { useState, useEffect } from 'react';
import { PasswordEntry, CustomField } from '@/types/password';
import { Plus, Trash2, Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { PasswordGenerator } from '@/components/PasswordGenerator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface PasswordFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: PasswordEntry | null;
  onSave: (entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
  existingTags: string[];
}

export function PasswordForm({ open, onOpenChange, entry, onSave, existingTags }: PasswordFormProps) {
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  useEffect(() => {
    if (entry) {
      setTitle(entry.title);
      setUsername(entry.username);
      setPassword(entry.password);
      setUrl(entry.url);
      setNotes(entry.notes);
      setHashtags(entry.hashtags);
      setCustomFields(entry.customFields);
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
  };

  const handlePasswordGenerated = (generatedPassword: string) => {
    setPassword(generatedPassword);
    setShowPassword(true);
  };

  const addTag = (tag: string) => {
    const cleanTag = tag.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
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
      { id: crypto.randomUUID(), label: '', value: '', isSecret: false },
    ]);
  };

  const updateCustomField = (id: string, updates: Partial<CustomField>) => {
    setCustomFields(customFields.map(f => (f.id === id ? { ...f, ...updates } : f)));
  };

  const removeCustomField = (id: string) => {
    setCustomFields(customFields.filter(f => f.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      title: title.trim() || 'Untitled',
      username,
      password,
      url,
      notes,
      hashtags,
      customFields: customFields.filter(f => f.label.trim()),
    });
    onOpenChange(false);
    resetForm();
  };

  const suggestedTags = existingTags.filter(
    tag => !hashtags.includes(tag) && tag.includes(tagInput.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit Entry' : 'New Entry'}</DialogTitle>
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
              <div className="relative flex-1">
                <Input
                  id="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="pr-10 font-mono"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <PasswordGenerator onGenerate={handlePasswordGenerated} />
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
                placeholder="Type and press Enter to add..."
              />
              {tagInput && suggestedTags.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg z-10 max-h-32 overflow-y-auto">
                  {suggestedTags.slice(0, 5).map(tag => (
                    <button
                      key={tag}
                      type="button"
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
                  <Input
                    value={field.value}
                    onChange={e => updateCustomField(field.id, { value: e.target.value })}
                    placeholder="Value"
                    type={field.isSecret ? 'password' : 'text'}
                    className="h-8 font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={field.isSecret}
                      onCheckedChange={checked => updateCustomField(field.id, { isSecret: checked })}
                      id={`secret-${field.id}`}
                    />
                    <Label htmlFor={`secret-${field.id}`} className="text-xs text-muted-foreground">
                      Secret field
                    </Label>
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{entry ? 'Save Changes' : 'Create Entry'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
