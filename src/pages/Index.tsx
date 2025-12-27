import { useState, useMemo, useRef } from 'react';
import { Plus, Lock, Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePasswords } from '@/hooks/usePasswords';
import { PasswordCard } from '@/components/PasswordCard';
import { PasswordForm } from '@/components/PasswordForm';
import { SearchBar } from '@/components/SearchBar';
import { HashtagFilter } from '@/components/HashtagFilter';
import { SettingsDialog } from '@/components/SettingsDialog';
import { PasswordEntry } from '@/types/password';
import { useToast } from '@/hooks/use-toast';

const Index = () => {
  const { entries, publicKey, encryptionSettings, addEntry, updateEntry, deleteEntry, getAllHashtags, importEntries, exportData, updatePublicKey, updateEncryptionSettings } = usePasswords();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null);

  const allTags = getAllHashtags();

  const DELETED_TAG = 'deleted';

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      const matchesSearch = !search || 
        entry.title.toLowerCase().includes(search.toLowerCase()) ||
        entry.username.toLowerCase().includes(search.toLowerCase()) ||
        entry.url.toLowerCase().includes(search.toLowerCase()) ||
        entry.hashtags.some(tag => tag.includes(search.toLowerCase()));
      
      const matchesTag = !selectedTag || entry.hashtags.includes(selectedTag);
      
      // Hide deleted entries unless #deleted tag is explicitly selected
      const isDeleted = entry.hashtags.includes(DELETED_TAG);
      const showDeleted = selectedTag === DELETED_TAG;
      
      return matchesSearch && matchesTag && (!isDeleted || showDeleted);
    });
  }, [entries, search, selectedTag]);

  const handleSave = (data: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingEntry) {
      updateEntry(editingEntry.id, data);
    } else {
      addEntry(data);
      // Ensure the newly created entry is visible immediately
      setSearch('');
      setSelectedTag(null);
    }
    setEditingEntry(null);
  };

  const handleEdit = (entry: PasswordEntry) => {
    setEditingEntry(entry);
    setFormOpen(true);
  };

  const handleSoftDelete = (entry: PasswordEntry) => {
    const newHashtags = entry.hashtags.includes(DELETED_TAG) 
      ? entry.hashtags 
      : [...entry.hashtags, DELETED_TAG];
    updateEntry(entry.id, { hashtags: newHashtags });
  };

  const handleFormClose = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingEntry(null);
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(exportData(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vault-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: 'Exported', description: `${entries.length} entries saved to file.` });
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        // Support both old format (array) and new format (object with entries)
        if (Array.isArray(data)) {
          importEntries(data);
          toast({ title: 'Imported', description: `${data.length} entries loaded.` });
        } else if (data.entries && Array.isArray(data.entries)) {
          importEntries(data.entries, data.publicKey, data.encryptionSettings);
          toast({ title: 'Imported', description: `${data.entries.length} entries loaded.` });
        } else {
          throw new Error('Invalid format');
        }
      } catch (err) {
        toast({ title: 'Import failed', description: 'Invalid JSON file format.', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container max-w-4xl py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <img src="/favicon.png" alt="oms4web" className="h-10 w-10" />
              <div>
                <h1 className="text-xl font-bold tracking-tight">oms4web</h1>
                <p className="text-xs text-muted-foreground">Password Manager</p>
              </div>
            </div>
            <Button onClick={() => setFormOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Entry
            </Button>
            <Button variant="outline" size="icon" onClick={handleExport} title="Export">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} title="Import">
              <Upload className="h-4 w-4" />
            </Button>
            <SettingsDialog 
              publicKey={publicKey} 
              encryptionSettings={encryptionSettings}
              onSavePublicKey={updatePublicKey} 
              onSaveEncryptionSettings={updateEncryptionSettings}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
          </div>
          <SearchBar value={search} onChange={setSearch} />
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl py-6">
        {allTags.length > 0 && (
          <div className="mb-6">
            <HashtagFilter 
              tags={allTags} 
              selectedTag={selectedTag} 
              onSelectTag={setSelectedTag} 
            />
          </div>
        )}

        {filteredEntries.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredEntries.map((entry, index) => (
              <div 
                key={entry.id} 
                className="animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <PasswordCard
                  entry={entry}
                  onEdit={handleEdit}
                  onDelete={deleteEntry}
                  onSoftDelete={handleSoftDelete}
                  onTagClick={setSelectedTag}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="p-4 rounded-2xl bg-muted/50 mb-4">
              <Lock className="h-12 w-12 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {entries.length === 0 ? 'Your vault is empty' : 'No results found'}
            </h2>
            <p className="text-muted-foreground mb-6 max-w-sm">
              {entries.length === 0 
                ? 'Add your first password entry to get started. Your data is stored securely in your browser.'
                : 'Try adjusting your search or filters to find what you\'re looking for.'}
            </p>
            {entries.length === 0 && (
              <Button onClick={() => setFormOpen(true)} size="lg" className="gap-2">
                <Plus className="h-5 w-5" />
                Create First Entry
              </Button>
            )}
          </div>
        )}

        {filteredEntries.length > 0 && (
          <p className="text-center text-sm text-muted-foreground mt-8">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
            {selectedTag && ` tagged #${selectedTag}`}
          </p>
        )}
      </main>

      <PasswordForm
        open={formOpen}
        onOpenChange={handleFormClose}
        entry={editingEntry}
        onSave={handleSave}
        existingTags={allTags}
        publicKey={publicKey}
        encryptionSettings={encryptionSettings}
      />
    </div>
  );
};

export default Index;
