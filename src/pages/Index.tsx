import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Lock, Download, Upload, Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadVault, getTimestamp, isAndroid, isPWA, useEncryptedVault } from '@/hooks/useEncryptedVault';
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
import { OMS_PREFIX } from "@/lib/constants";
import { OMS_RESPONSE } from '@/lib/constants';

const Index = () => {
  const {
    vaultState,
    entries,
    publicKey,
    encryptionSettings,
    encryptionEnabled,
    vaultName,
    workspaceProtection,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
    importEntries,
    exportData,
    updatePublicKey,
    updateEncryptionSettings,
    updateEncryptionEnabled,
    updateVaultName,
    updateWorkspaceProtection,
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

  useEffect(()=>{
    console.log(`isAndroid: ${isAndroid()}, isPWA: ${isPWA()}`);
  },[]);

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

  const handleExport = async () => {
    const data = exportData();
    const jsonData = JSON.stringify(data, null, 2);

    // Generate filename: vaultName + local timestamp
    const name = vaultName.trim() || 'Untitled';
    // If workspace protection is activated and public key exists, export encrypted
    if (publicKey) {
      try {
        const encryptedBytes = await encryptVaultData(jsonData, publicKey, encryptionSettings);
        const blob = new Blob([new Uint8Array(encryptedBytes)], { type: 'application/octet-stream' });
        downloadVault(`${name}_${getTimestamp()}.json.oms00`, blob);
        toast({ title: 'Exported (encrypted)', description: `${entries.length} entries saved to encrypted file.` });
        return;
      } catch (err) {
        console.error('Failed to encrypt export:', err);
        toast({ title: 'Encryption failed', description: 'Falling back to JSON export.', variant: 'destructive' });
      }
    }

    // Fallback to plain JSON
    const blob = new Blob([jsonData], { type: 'application/json' });
    downloadVault(`${name}_${getTimestamp()}.json`, blob);
    toast({ title: 'Exported', description: `${entries.length} entries saved to file.` });
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

    // Handle text files (JSON or OMS text format)
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;

      // Check if it's encrypted data in text format
      if (content.startsWith(OMS_PREFIX)) {
        setImportDecryptData(content);
        return;
      }

      // Handle plain JSON
      try {
        const data = JSON.parse(content);
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

  const handleImportDecrypted = (decryptedJson: string) => {
    try {
      const data = JSON.parse(decryptedJson);
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
      toast({ title: 'Import failed', description: 'Invalid decrypted data format.', variant: 'destructive' });
    }
    setImportDecryptData(null);
  };

  //callback message handling
  useEffect(() => {
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === OMS_RESPONSE) {
        const receivedData = event.data.data;
        
        if (!receivedData) return;
  
        if (vaultState.status === 'encrypted') {
          loadDecryptedData(receivedData);
          toast({ title: "Decrypted", description: "Vault data decrypted successfully." });
        } else {
          console.log("Received unexpected callback data: %s", receivedData);
        }
      }
    };
  
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
    }
  
    return () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
      }
    };
  }, [vaultState.status, unlockPin, loadDecryptedData, toast]);
  

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
          settings={encryptionSettings}
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
                <p className="text-xs text-muted-foreground">{vaultName.trim() || 'Untitled'}</p>
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
              workspaceProtection !== 'none' && (<>
                <Button variant="outline" size="icon" onClick={lockVault} title="Lock Workspace">
                  <LockKeyhole className="h-4 w-4" />
                </Button>
              </>
              )}
            <SettingsDialog
              publicKey={publicKey}
              encryptionSettings={encryptionSettings}
              encryptionEnabled={encryptionEnabled}
              vaultName={vaultName}
              workspaceProtection={workspaceProtection}
              onSavePublicKey={updatePublicKey}
              onSaveEncryptionSettings={updateEncryptionSettings}
              onSaveEncryptionEnabled={updateEncryptionEnabled}
              onSaveVaultName={updateVaultName}
              onSaveWorkspaceProtection={updateWorkspaceProtection}
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
              {entries.length === 0 ? 'Your vault is empty' : 'No results found'}
            </h2>
            {entries.length === 0 && (
              <>
                <p className="text-muted-foreground mb-6 max-w-sm text-justify">
                  ⚠️ Your data is stored locally in your browser, so export it regularly. It will be lost when clearling browser cache.
                  Your data will be encrypted as soon as you have provided a public key.
                </p>
                <p className="text-muted-foreground mb-6 max-w-sm">
                  🚀 To start, go to Settings.
                </p>
                <Button onClick={() => setFormOpen(true)} size="lg" className="gap-2">
                  <Plus className="h-5 w-5" />
                  Create First Entry
                </Button>
              </>
            )}
            {entries.length > 0 && (
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
        publicKey={publicKey}
        encryptionSettings={encryptionSettings}
        encryptionEnabled={encryptionEnabled}
      />

      {/* Decrypt dialog for importing encrypted files */}
      {importDecryptData && (
        <DecryptQrDialog
          open={true}
          onOpenChange={(open) => !open && setImportDecryptData(null)}
          encryptedData={importDecryptData}
          onDecrypted={handleImportDecrypted}
          onSkip={() => setImportDecryptData(null)}
          settings={encryptionSettings}
        />
      )}
    </div>
  );
};

export default Index;
