import {
  useState,
  useMemo,
  useRef, useEffect
} from 'react';
import {
  Plus,
  Lock,
  Download,
  Upload,
  Loader2,
  LockKeyhole,
  ExternalLink,
  GitMerge
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  downloadVault,
  getTimestamp,
  useEncryptedVault,
  validateJson
} from '@/hooks/useEncryptedVault';
import { PasswordCard } from '@/components/PasswordCard';
import { PasswordForm } from '@/components/PasswordForm';
import { SearchBar } from '@/components/SearchBar';
import { HashtagFilter } from '@/components/HashtagFilter';
import { SettingsDialog } from '@/components/SettingsDialog';
import { DecryptQrDialog } from '@/components/DecryptQrDialog';
import { PinUnlockDialog } from '@/components/PinUnlockDialog';
import { PasswordEntry, VaultData } from '@/types/types';
import { useToast } from '@/hooks/use-toast';
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
import { Input } from '@/components/ui/input';
import { encryptVaultData } from '@/lib/fileEncryption';
import { toast as sonnerToast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { OMS4WEB_REF, PASSWORD_READONLY_PROPERTY_NAME } from '@/lib/constants';
import { JSONPath } from 'jsonpath-plus';

const Index = () => {
  const {
    vaultState,
    vaultData,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
    importEntries,
    mergeEntries,
    exportData,
    setSettings: updateSettings,
    loadDecryptedData,
    startWithEmptyVault,
    lockVault,
    unlockPin,
    applyRef,
    switchToQuickUnlock,
    isBackupRequired,
  } = useEncryptedVault();

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeFileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null);
  const [importDecryptData, setImportDecryptData] = useState<Uint8Array | null>(null);
  const [mergeDecryptData, setMergeDecryptData] = useState<Uint8Array | null>(null);
  const [mergeCandidateData, setMergeCandidateData] = useState<VaultData | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeTag, setMergeTag] = useState('');
  const allTags = getAllHashtags();

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (needRefresh) {
      sonnerToast('Update available', {
        id: 'sw-update-toast',
        description: 'A new version of the app is ready.',
        duration: Infinity,
        action: {
          label: 'Update',
          onClick: () => updateServiceWorker(true),
        },
        cancel: {
          label: 'Dismiss',
          onClick: () => setNeedRefresh(false),
        },
      });
    }
  }, [needRefresh, updateServiceWorker, setNeedRefresh]);

  const DELETED_TAG = 'deleted';

  const filteredEntries = useMemo(() => {
    if (search?.startsWith(OMS4WEB_REF)) {
      const path = search.substring(OMS4WEB_REF.length);
      try {
        const result = JSONPath({
          path: path,
          json: vaultData.entries
        }) as PasswordEntry[];
        if (result.length && PASSWORD_READONLY_PROPERTY_NAME in result[0]) {
          return result;
        }
        throw "Result is not PasswordEntry[]"
      } catch (err) {
        console.log(err);
        toast({ title: 'Invalid JSONPath query', description: `${err}` });

      }
    }
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
  }, [vaultData, search, selectedTag, toast]);

  const handleSave = (data: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt' | 'history'>) => {
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

  const handleSearchChange = (value: string) => {
    if (value.startsWith(OMS4WEB_REF)) {
      //clear tag selection
      setSelectedTag(null)
    }

    setSearch(value)
  }

  const downloadVaultSnapshot = async ({
    suffix,
    encryptedToast,
    plainToast,
    onEncryptError
  }: {
    suffix: string;
    encryptedToast: { title: string; description: string; variant?: 'destructive' };
    plainToast: { title: string; description: string; variant?: 'destructive' };
    onEncryptError?: () => void;
  }) => {
    const data = await exportData();
    const jsonData = JSON.stringify(data, null, 2);
    const name = vaultData.settings.vaultName.trim() || 'Untitled';

    if (vaultData.settings.publicKey) {
      try {
        const encryptedBytes = await encryptVaultData(new TextEncoder().encode(jsonData), vaultData.settings);
        const blob = new Blob([new Uint8Array(encryptedBytes)], { type: 'application/octet-stream' });
        downloadVault(`${name}${suffix}.json.oms00`, blob);
        toast(encryptedToast);
        return;
      } catch (err) {
        console.error('Failed to encrypt export:', err);
        onEncryptError?.();
      }
    }

    const blob = new Blob([jsonData], { type: 'application/json' });
    downloadVault(`${name}${suffix}.json`, blob);
    toast(plainToast);
  };

  const handleExport = async () => {
    const timestamp = getTimestamp();
    await downloadVaultSnapshot({
      suffix: `_${timestamp}`,
      encryptedToast: { title: 'Exported (encrypted)', description: `${vaultData.entries.length} entries saved to encrypted file.` },
      plainToast: { title: 'Exported', description: `${vaultData.entries.length} entries saved to file.` },
      onEncryptError: () => {
        toast({ title: 'Encryption failed', description: 'Falling back to JSON export.', variant: 'destructive' });
      }
    });
  };

  const backupCurrentVault = async () => {
    if (vaultData.entries.length === 0) return; // nothing to back up
    if (!(await isBackupRequired())) return; //contents have not changed since last export

    const timestamp = getTimestamp();
    await downloadVaultSnapshot({
      suffix: `_backup_${timestamp}`,
      encryptedToast: { title: 'Backup created', description: 'Encrypted backup has been downloaded before import.' },
      plainToast: { title: 'Backup created', description: 'Backup has been downloaded before import.' }
    });
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
        setImportDecryptData(bytes);
      };
      reader.readAsArrayBuffer(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Handle unencrypted JSON 
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;

      // Handle plain JSON
      try {
        const data = validateJson(JSON.parse(content));
        await backupCurrentVault();
        await importEntries(data);
        toast({ title: 'Imported', description: `${data.entries.length} entries loaded.` });
      } catch (err) {
        toast({ title: 'Import failed', description: 'Invalid JSON file format.', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImportDecrypted = async (vaultData: VaultData) => {
    try {
      await backupCurrentVault();
      await importEntries(vaultData);
      toast({ title: 'Imported', description: `${vaultData.entries.length} entries loaded.` });
    } catch (err) {
      toast({ title: 'Import failed', description: 'Invalid decrypted data format.', variant: 'destructive' });
    }
    setImportDecryptData(null);
  };

  const getMergeTagSuggestion = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `merged_${yyyy}_${mm}_${dd}`;
  };

  const openMergeDialog = (data: VaultData) => {
    setMergeCandidateData(data);
    setMergeTag(getMergeTagSuggestion());
    setMergeDialogOpen(true);
  };

  const handleMerge = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.oms00')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        setMergeDecryptData(new Uint8Array(arrayBuffer));
      };
      reader.readAsArrayBuffer(file);
      if (mergeFileInputRef.current) mergeFileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const data = validateJson(JSON.parse(content));
        openMergeDialog(data);
      } catch {
        toast({ title: 'unknown file format, cannot merge', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
    if (mergeFileInputRef.current) mergeFileInputRef.current.value = '';
  };

  const handleMergeDecrypted = async (vaultData: VaultData) => {
    try {
      openMergeDialog(vaultData);
    } catch {
      toast({ title: 'unknown file format, cannot merge', variant: 'destructive' });
    }
    setMergeDecryptData(null);
  };

  const confirmMerge = async () => {
    if (!mergeCandidateData) return;
    await mergeEntries(mergeCandidateData, mergeTag || getMergeTagSuggestion());
    setMergeDialogOpen(false);
    setMergeCandidateData(null);
    toast({ title: 'merge successful' });
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
    if (vaultState.quickUnlock) {
      //decrypt and immediately convert into pin-locked status
      switchToQuickUnlock(vaultState);
      return null;
    } else {
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

  const handleSelectedTag = (tag: string) => {
    if (search?.startsWith(OMS4WEB_REF)) {
      setSearch('');
    }
    setSelectedTag(tag);
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container max-w-4xl px-4 py-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0 max-w-[50%] sm:max-w-[30%]">
              <div className="min-w-0">
                <a href="https://github.com/stud0709/oms4web">
                  <h1 className="text-xl font-bold tracking-tight">oms4web</h1>
                </a>
                <p className="text-xs text-muted-foreground truncate">{vaultData.settings.vaultName.trim() || 'Untitled'}</p>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="flex items-center gap-2 flex-nowrap justify-end pr-1">
                <Button className="shrink-0" variant="outline" size="icon" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
                <Button className="shrink-0" variant="outline" size="icon" onClick={handleExport} title="Export">
                  <Download className="h-4 w-4" />
                </Button>
                <Button className="shrink-0" variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} title="Import">
                  <Upload className="h-4 w-4" />
                </Button>
                <Button className="shrink-0" variant="outline" size="icon" onClick={() => mergeFileInputRef.current?.click()} title="Merge">
                  <GitMerge className="h-4 w-4" />
                </Button>
                {//"Lock workspace" button to be shown only if workspace protection activated
                  vaultData.settings.workspaceProtection !== 'none' && (
                    <Button className="shrink-0" variant="outline" size="icon" onClick={lockVault} title="Lock Workspace">
                      <LockKeyhole className="h-4 w-4" />
                    </Button>
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
                <input
                  ref={mergeFileInputRef}
                  type="file"
                  accept=".json,.oms00"
                  className="hidden"
                  onChange={handleMerge}
                />
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          <SearchBar value={search} onChange={handleSearchChange} />
          {allTags.length > 0 && (
            <div className="mt-6">
              <HashtagFilter
                tags={allTags}
                selectedTag={selectedTag}
                onSelectTag={handleSelectedTag}
              />
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl px-4 py-6">
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
                  applyRef={applyRef}
                  setSearch={setSearch}
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
                    href="https://github.com/stud0709/oms4web/blob/main/getting_started.md">Getting Started Guide<ExternalLink className="h-5 w-5" /></a>
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

      <AlertDialog open={mergeDialogOpen} onOpenChange={(open) => {
        setMergeDialogOpen(open);
        if (!open) setMergeCandidateData(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ready to merge</AlertDialogTitle>
            <AlertDialogDescription>
              {mergeCandidateData ? `${mergeCandidateData.entries.length} entries will be added to the current vault.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tag for merged entries</label>
            <Input value={mergeTag} onChange={(e) => setMergeTag(e.target.value)} placeholder={getMergeTagSuggestion()} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setMergeCandidateData(null);
              setMergeDialogOpen(false);
            }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMerge}>Merge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Decrypt dialog for merging encrypted files */}
      {mergeDecryptData && (
        <DecryptQrDialog
          open={true}
          onOpenChange={(open) => !open && setMergeDecryptData(null)}
          encryptedData={mergeDecryptData}
          onDecrypted={handleMergeDecrypted}
          onSkip={() => setMergeDecryptData(null)}
        />
      )}
    </div>
  );
};

export default Index;
