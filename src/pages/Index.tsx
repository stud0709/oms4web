import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Lock, Download, Upload, Loader2, LockKeyhole, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadVault, getTimestamp, useEncryptedVault } from '@/hooks/useEncryptedVault';
import { PasswordCard } from '@/components/PasswordCard';
import { PasswordForm } from '@/components/PasswordForm';
import { SearchBar } from '@/components/SearchBar';
import { HashtagFilter } from '@/components/HashtagFilter';
import { SettingsDialog } from '@/components/SettingsDialog';
import { DecryptQrDialog } from '@/components/DecryptQrDialog';
import { PinUnlockDialog } from '@/components/PinUnlockDialog';
import { PasswordEntry } from '@/types/types';
import { useToast } from '@/hooks/use-toast';
import { encryptVaultData } from '@/lib/fileEncryption';
import { useRegisterSW } from 'virtual:pwa-register/react';

const Index = () => {
  const {
    vaultState,
    vaultData,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
    importEntries,
    exportData,
    updateSettings,
    loadDecryptedData,
    startWithEmptyVault,
    lockVault,
    unlockPin,
  } = useEncryptedVault();

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null);
  const [importDecryptData, setImportDecryptData] = useState<string | null>(null);
  const allTags = getAllHashtags();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const DELETED_TAG = 'deleted';

  const filteredEntries = useMemo(() => {
    return vaultData.entries.filter(entry => {
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
  }, [vaultData, search, selectedTag]);

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

  const handleExport = async () => {
    const data = exportData();
    const jsonData = JSON.stringify(data, null, 2);

    // Generate filename: vaultName + local timestamp
    const name = vaultData.settings.vaultName.trim() || 'Untitled';
    // If workspace protection is activated and public key exists, export encrypted
    if (vaultData.settings.publicKey) {
      try {
        const encryptedBytes = await encryptVaultData(jsonData, vaultData.settings);
        const blob = new Blob([new Uint8Array(encryptedBytes)], { type: 'application/octet-stream' });
        downloadVault(`${name}_${getTimestamp()}.json.oms00`, blob);
        toast({ title: 'Exported (encrypted)', description: `${vaultData.entries.length} entries saved to encrypted file.` });
        return;
      } catch (err) {
        console.error('Failed to encrypt export:', err);
        toast({ title: 'Encryption failed', description: 'Falling back to JSON export.', variant: 'destructive' });
      }
    }

    // Fallback to plain JSON
    const blob = new Blob([jsonData], { type: 'application/json' });
    downloadVault(`${name}_${getTimestamp()}.json`, blob);
    toast({ title: 'Exported', description: `${vaultData.entries.length} entries saved to file.` });
  };

  const backupCurrentVault = async () => {
    if (vaultData.entries.length === 0) return; // nothing to back up
    const data = exportData();
    const jsonData = JSON.stringify(data, null, 2);
    const name = vaultData.settings.vaultName.trim() || 'Untitled';

    if (vaultData.settings.publicKey) {
      try {
        const encryptedBytes = await encryptVaultData(jsonData, vaultData.settings);
        const blob = new Blob([new Uint8Array(encryptedBytes)], { type: 'application/octet-stream' });
        downloadVault(`${name}_backup_${getTimestamp()}.json.oms00`, blob);
        toast({ title: 'Backup created', description: 'Encrypted backup has been downloaded before import.' });
        return;
      } catch (err) {
        console.error('Failed to encrypt backup:', err);
      }
    }

    const blob = new Blob([jsonData], { type: 'application/json' });
    downloadVault(`${name}_backup_${getTimestamp()}.json`, blob);
    toast({ title: 'Backup created', description: 'Backup has been downloaded before import.' });
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Handle .oms00 files as binary
    if (file.name.endsWith('.oms00')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        // Convert raw binary to OMS format (oms00_ prefix + base64)
        const base64 = btoa(String.fromCharCode(...bytes));
        const omsData = `oms00_${base64}`;
        setImportDecryptData(omsData);
      };
      reader.readAsArrayBuffer(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Handle unencrypted JSON 
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;

      // Handle plain JSON
      try {
        const data = JSON.parse(content);
        if (!data.entries || !Array.isArray(data.entries)) {
          throw new Error('Invalid format');
        }
        backupCurrentVault().then(() => {
          importEntries(data);
          toast({ title: 'Imported', description: `${data.entries.length} entries loaded.` });
        });
      } catch (err) {
        toast({ title: 'Import failed', description: 'Invalid JSON file format.', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImportDecrypted = async (decryptedJson: string) => {
    try {
      const data = JSON.parse(decryptedJson);
      if (!data.entries || !Array.isArray(data.entries)) {
        throw new Error('Invalid format');
      }
      await backupCurrentVault();
      importEntries(data);
      toast({ title: 'Imported', description: `${data.entries.length} entries loaded.` });
    } catch (err) {
      toast({ title: 'Import failed', description: 'Invalid decrypted data format.', variant: 'destructive' });
    }
    setImportDecryptData(null);
  };

  // Show loading state
  if (vaultState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading vault...</p>
        </div>
      </div>
    );
  }

  // Show decrypt dialog if vault is encrypted
  if (vaultState.status === 'encrypted') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <DecryptQrDialog
          open={true}
          onOpenChange={() => { }}
          encryptedData={vaultState.encryptedData}
          onDecrypted={loadDecryptedData}
          onSkip={startWithEmptyVault}
          hideCloseButton
        />
      </div>
    );
  }

  // Show PIN unlock dialog if vault is pin-locked
  if (vaultState.status === 'pin-locked') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PinUnlockDialog
          open={true}
          onOpenChange={() => { }}
          vaultState={vaultState}
          onUnlock={unlockPin}
          onSkip={startWithEmptyVault}
          hideCloseButton
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container max-w-4xl px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div>
                <a href="https://github.com/stud0709/oms4web">
                  <h1 className="text-xl font-bold tracking-tight">oms4web</h1>
                </a>
                <p className="text-xs text-muted-foreground">{vaultData.settings.vaultName.trim() || 'Untitled'}</p>
              </div>
            </div>
            <Button variant="outline" size="icon" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleExport} title="Export">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} title="Import">
              <Upload className="h-4 w-4" />
            </Button>
            {//"Lock workspace" button to be shown only if workspace protection activated
              vaultData.settings.workspaceProtection !== 'none' && (<>
                <Button variant="outline" size="icon" onClick={lockVault} title="Lock Workspace">
                  <LockKeyhole className="h-4 w-4" />
                </Button>
              </>
              )}
            <SettingsDialog
              settings={vaultData.settings}
              onSaveSettings={updateSettings}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.oms00"
              className="hidden"
              onChange={handleImport}
            />
          </div>
          <SearchBar value={search} onChange={setSearch} />
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl px-4 py-6">
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
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
            <div className="p-4 rounded-2xl bg-muted/50 mb-4">
              <Lock className="h-12 w-12 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {vaultData.entries.length === 0 ? 'Your vault is empty' : 'No results found'}
            </h2>
            {vaultData.entries.length === 0 && (
              <>
                <p className="text-muted-foreground mb-6 max-w-sm text-justify">
                  ⚠️ Your data is stored locally in your browser, so export it regularly. It may be lost when clearling browser cache.
                </p>
                <p className="text-muted-foreground mb-6 max-w-sm">
                  🚀 To start, follow the <a
                   target="_blank" 
                   className="inline-flex items-center gap-1 text-primary hover:opacity-80 transition-opacity"
                   href="https://github.com/stud0709/oms4web/blob/main/getting_started.md">Getting Started Guide<ExternalLink className="h-5 w-5"/></a>
                </p>
                <Button onClick={() => setFormOpen(true)} size="lg" className="gap-2">
                  <Plus className="h-5 w-5" />
                  Create First Entry
                </Button>
              </>
            )}
            {vaultData.entries.length > 0 && (
              <>
                <p className="text-muted-foreground mb-6 max-w-sm">
                  Try adjusting your search or filters to find what you\'re looking for.
                </p>
              </>
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
        settings={vaultData.settings}
      />

      {/* Decrypt dialog for importing encrypted files */}
      {importDecryptData && (
        <DecryptQrDialog
          open={true}
          onOpenChange={(open) => !open && setImportDecryptData(null)}
          encryptedData={importDecryptData}
          onDecrypted={handleImportDecrypted}
          onSkip={() => setImportDecryptData(null)}
        />
      )}
    </div>
  );
};

export default Index;
