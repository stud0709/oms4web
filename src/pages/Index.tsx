import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback
} from 'react';
import {
  Plus,
  Lock,
  Download,
  Upload,
  Loader2,
  LockKeyhole,
  ExternalLink,
  GitMerge,
  Tags
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { ManageTagsDialog } from '@/components/ManageTagsDialog';
import { DecryptQrDialog } from '@/components/DecryptQrDialog';
import { PinUnlockDialog } from '@/components/PinUnlockDialog';
import { CustomFieldProtection, PasswordEntry, VaultData } from '@/types/types';
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
import { DELETED_TAG, OMS4WEB_REF, OMS_FILETYPE, OMS_PREFIX, PASSWORD_READONLY_PROPERTY_NAME } from '@/lib/constants';
import { JSONPath } from 'jsonpath-plus';
import { createEncryptedMessage } from '@/lib/crypto';
import { normalizeTag } from '@/lib/tagUtils';

const Index = () => {
  const {
    vaultState,
    vaultData,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
    renameTag,
    deleteTagEverywhere,
    importEntries,
    mergeEntries,
    exportData,
    updateSettings,
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
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const INITIAL_RESULTS_RENDER = 50;
  const RESULTS_BATCH_SIZE = 50;
  const [visibleResultsCount, setVisibleResultsCount] = useState(INITIAL_RESULTS_RENDER);
  const resultsScrollRootRef = useRef<HTMLElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null);
  const [importDecryptData, setImportDecryptData] = useState<Uint8Array | null>(null);
  const [mergeDecryptData, setMergeDecryptData] = useState<Uint8Array | null>(null);
  const [mergeCandidateData, setMergeCandidateData] = useState<VaultData | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeTag, setMergeTag] = useState('');
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
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
        throw "Result is not PasswordEntry[]";
      } catch (err) {
        console.log(err);
        toast({ title: 'Invalid JSONPath query', description: `${err}` });

      }
    }

    const selectedTagsArr = Array.from(selectedTags);

    const searchLower = search.toLowerCase().trim();

    return vaultData.entries
      .map(e => applyRef(e))
      .filter(entry => {
        const matchesCustomFields = entry.customFields?.some(field => {
          if (field.label.toLowerCase().includes(searchLower)) return true;

          // For encrypted custom fields we can't search by plaintext value.
          if (!field.value || field.value.startsWith(OMS_PREFIX)) return false;
          return field.value.toLowerCase().includes(searchLower);
        }) ?? false;

        const matchesSearch = !search ||
          entry.title.toLowerCase().includes(searchLower) ||
          entry.username.toLowerCase().includes(searchLower) ||
          entry.url.toLowerCase().includes(searchLower) ||
          entry.notes.toLowerCase().includes(searchLower) ||
          entry.hashtags.some(tag => tag.includes(searchLower)) ||
          matchesCustomFields;

        const matchesTags = selectedTagsArr.length === 0 || selectedTagsArr.every(tag => entry.hashtags.includes(tag));

        // Hide deleted entries unless #deleted tag is explicitly selected
        const isDeleted = entry.hashtags.includes(DELETED_TAG);
        const showDeleted = selectedTags.has(DELETED_TAG);

        return matchesSearch && matchesTags && (!isDeleted || showDeleted);
      });
  }, [vaultData, search, selectedTags, toast]);

  useEffect(() => {
    setVisibleResultsCount(Math.min(INITIAL_RESULTS_RENDER, filteredEntries.length));
  }, [filteredEntries.length]);

  useEffect(() => {
    const rootEl = resultsScrollRootRef.current;
    const targetEl = loadMoreSentinelRef.current;

    if (!rootEl || !targetEl) return;
    if (visibleResultsCount >= filteredEntries.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleResultsCount(prev => Math.min(prev + RESULTS_BATCH_SIZE, filteredEntries.length));
      },
      {
        root: rootEl,
        rootMargin: '400px',
      }
    );

    observer.observe(targetEl);
    return () => observer.disconnect();
  }, [filteredEntries.length, visibleResultsCount]);

  const visibleEntries = useMemo(
    () => filteredEntries.slice(0, visibleResultsCount),
    [filteredEntries, visibleResultsCount]
  );

  const visibleTags = useMemo(() => {
    if (selectedTags.size === 0) return allTags;

    const tagsInResults = new Set<string>();
    for (const entry of filteredEntries) {
      for (const tag of entry.hashtags) {
        tagsInResults.add(tag);
      }
    }

    for (const tag of selectedTags) {
      tagsInResults.add(tag);
    }

    const ordered = allTags.filter(t => tagsInResults.has(t));
    for (const tag of selectedTags) {
      if (!ordered.includes(tag)) ordered.unshift(tag);
    }

    return ordered;
  }, [allTags, filteredEntries, selectedTags]);

  const handleSave = (data: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt' | 'history'>) => {
    if (editingEntry) {
      updateEntry(editingEntry.id, data);
    } else {
      addEntry(data);
      // Ensure the newly created entry is visible immediately
      setSearch('');
      setSelectedTags(new Set());
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

  const [purgeDeletedOpen, setPurgeDeletedOpen] = useState(false);

  const deletedEntryIds = useMemo(
    () => vaultData.entries.filter(e => e.hashtags.includes(DELETED_TAG)).map(e => e.id),
    [vaultData.entries]
  );

  const permanentlyDeleteAllDeleted = () => {
    for (const id of deletedEntryIds) {
      deleteEntry(id);
    }
    setPurgeDeletedOpen(false);
    if (deletedEntryIds.length > 0) {
      toast({ title: 'Deleted', description: `${deletedEntryIds.length} entries permanently deleted.` });
    }
  };

  const handleSearchChange = (value: string) => {
    if (value.startsWith(OMS4WEB_REF)) {
      //clear tag selection
      setSelectedTags(new Set());
    }

    setSearch(value);
  };

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
    if (file.name.endsWith(OMS_FILETYPE)) {
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

  const parseKeePassXml = useCallback(async (xml: string): Promise<VaultData> => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const parserError = doc.getElementsByTagName('parsererror')[0];
    if (parserError) throw new Error('Invalid XML');

    const root = doc.getElementsByTagName('KeePassFile')[0];
    if (!root) throw new Error('Not a KeePass XML file');

    const getChildText = (el: Element, tagName: string) => {
      const child = el.getElementsByTagName(tagName)[0];
      return child?.textContent ?? '';
    };

    const getDirectChildren = (el: Element, tagName: string) => {
      const expected = tagName.toLowerCase();
      return Array.from(el.children).filter(child => {
        const name = (child.localName || child.tagName).toLowerCase();
        return name === expected;
      });
    };

    const getDirectChild = (el: Element, tagName: string) =>
      getDirectChildren(el, tagName)[0] ?? null;

    const parseBool = (v: string | null) => v?.toLowerCase() === 'true';

    const maybeEncryptProtected = async (value: string, protectInMemory: boolean) => {
      if (!value) {
        return { value: '', readonly: false };
      }
      if (value.startsWith(OMS_PREFIX) || value.startsWith(OMS4WEB_REF)) {
        return { value, readonly: value.startsWith(OMS_PREFIX) };
      }
      if (!protectInMemory) {
        return { value, readonly: false };
      }

      if (!vaultData.settings.encryptionEnabled) {
        throw new Error('Encryption required');
      }

      const encrypted = await createEncryptedMessage(value, vaultData.settings);
      return { value: encrypted, readonly: true };
    };

    const getParentGroupTags = (entryEl: Element) => {
      const tags: string[] = [];
      let groupEl: Element | null = entryEl.closest('Group');
      while (groupEl) {
        const name = getChildText(groupEl, 'Name');
        const normalized = normalizeTag(name);
        if (normalized) tags.push(normalized);
        groupEl = groupEl.parentElement?.closest('Group') ?? null;
      }
      return tags;
    };

    const parseEntryData = async (entryEl: Element, entryId: string, extraHashtags: string[] = []) => {
      // Important: Entry contains nested <History><Entry>...</Entry></History>.
      // We must only parse *direct* children here, otherwise history fields may overwrite the main entry.
      const stringEls = getDirectChildren(entryEl, 'String');

      const kv = new Map<string, { value: string; protectInMemory: boolean }>();
      for (const stringEl of stringEls) {
        const key = getChildText(stringEl, 'Key');
        if (!key) continue;
        const valueEl = stringEl.getElementsByTagName('Value')[0];
        const value = valueEl?.textContent ?? '';
        const protectInMemory = parseBool(valueEl?.getAttribute('ProtectInMemory') ?? null);
        kv.set(key, { value, protectInMemory });
      }

      const title = kv.get('Title')?.value ?? 'Untitled';
      const username = kv.get('UserName')?.value ?? '';
      const url = kv.get('URL')?.value ?? '';
      const notes = kv.get('Notes')?.value ?? '';
      const passwordRes = await maybeEncryptProtected(kv.get('Password')?.value ?? '', kv.get('Password')?.protectInMemory ?? false);

      const tagsEl = getDirectChild(entryEl, 'Tags');
      const tagsRaw = (tagsEl?.textContent ?? '') || kv.get('Tags')?.value || '';
      const hashtags = Array.from(new Set([
        ...tagsRaw
          .split(/[,;\s]+/)
          .map(normalizeTag)
          .filter(Boolean),
        ...extraHashtags.map(normalizeTag).filter(Boolean),
      ]));

      const timesEl = getDirectChild(entryEl, 'Times');
      const createdAtStr = timesEl ? getChildText(timesEl, 'CreationTime') : '';
      const updatedAtStr = timesEl ? getChildText(timesEl, 'LastModificationTime') : '';
      const createdAt = createdAtStr ? new Date(createdAtStr) : new Date();
      const updatedAt = updatedAtStr ? new Date(updatedAtStr) : new Date();

      const standardKeys = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes', 'Tags']);
      const customFields = await Promise.all(
        Array.from(kv.entries())
          .filter(([key]) => !standardKeys.has(key))
          .map(async ([key, { value, protectInMemory }]) => {
            const res = await maybeEncryptProtected(value, protectInMemory);
            return {
              id: crypto.randomUUID(),
              label: key,
              value: res.value,
              protection: (res.value.startsWith(OMS_PREFIX) ? 'encrypted' : 'none') as CustomFieldProtection,
              readonly: res.readonly,
            };
          })
      );

      return {
        id: entryId,
        title: title.trim() || 'Untitled',
        username,
        password: passwordRes.value,
        passwordReadonly: passwordRes.value.startsWith(OMS_PREFIX),
        url,
        notes,
        hashtags,
        customFields,
        createdAt,
        updatedAt,
      };
    };

    const entries: PasswordEntry[] = [];

    // Important: <History> itself contains <Entry> tags. We only want "real" entries here,
    // and map the historical <Entry> versions into `history`.
    const entryEls = Array.from(doc.getElementsByTagName('Entry')).filter(el => !el.closest('History'));

    for (const entryEl of entryEls) {
      const id = crypto.randomUUID();

      const groupTags = getParentGroupTags(entryEl);
      const data = await parseEntryData(entryEl, id, groupTags);

      const historyEl = getDirectChild(entryEl, 'History');
      const historyEntryEls = historyEl ? getDirectChildren(historyEl, 'Entry') : [];

      const history = (await Promise.all(
        historyEntryEls.map(async (historyEntryEl) => {
          const historyData = await parseEntryData(historyEntryEl, id, groupTags);
          return {
            timestamp: historyData.updatedAt,
            data: historyData,
          };
        })
      ))
        .filter(h => !Number.isNaN(h.timestamp.getTime()))
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      entries.push({
        ...data,
        history,
      });
    }

    return {
      entries,
      settings: vaultData.settings,
    };
  }, [vaultData.settings]);

  const handleMerge = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith(OMS_FILETYPE)) {
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
    reader.onload = async (e) => {
      const content = e.target?.result as string;

      try {
        const data = validateJson(JSON.parse(content));
        openMergeDialog(data);
        return;
      } catch {
        // ignore and try other formats
      }

      try {
        const data = await parseKeePassXml(content);
        openMergeDialog(data);
        return;
      } catch (err) {
        if (`${err}`.includes('Encryption required')) {
          toast({
            title: 'Cannot merge KeePass XML',
            description: 'Enable "password generator & encryption" in Settings to import protected KeePass fields.',
            variant: 'destructive'
          });
          return;
        }
      }

      toast({ title: 'unknown file format, cannot merge', variant: 'destructive' });
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

  const handleToggleTag = (tag: string) => {
    if (search?.startsWith(OMS4WEB_REF)) {
      setSearch('');
    }

    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const handleRenameTag = (from: string, to: string) => {
    const normalized = normalizeTag(to);
    if (!normalized || normalized === from) return;

    renameTag(from, normalized);

    setSelectedTags(prev => {
      if (!prev.has(from)) return prev;
      const next = new Set(prev);
      next.delete(from);
      next.add(normalized);
      return next;
    });
  };

  const handleDeleteTag = (tag: string) => {
    deleteTagEverywhere(tag);

    setSelectedTags(prev => {
      if (!prev.has(tag)) return prev;
      const next = new Set(prev);
      next.delete(tag);
      return next;
    });
  };

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
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
              <TooltipProvider>
                <div className="flex items-center gap-2 flex-nowrap justify-end pr-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button className="shrink-0" variant="outline" size="icon" onClick={() => setFormOpen(true)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>New entry</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button className="shrink-0" variant="outline" size="icon" onClick={handleExport}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button className="shrink-0" variant="outline" size="icon" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Import</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button className="shrink-0" variant="outline" size="icon" onClick={() => mergeFileInputRef.current?.click()}>
                        <GitMerge className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Merge</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button className="shrink-0 gap-2" variant="outline" size="sm" onClick={() => setManageTagsOpen(true)}>
                        <Tags className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Manage tags</TooltipContent>
                  </Tooltip>

                  {//"Lock workspace" button to be shown only if workspace protection activated
                    vaultData.settings.workspaceProtection !== 'none' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button className="shrink-0" variant="outline" size="icon" onClick={lockVault}>
                            <LockKeyhole className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Lock workspace</TooltipContent>
                      </Tooltip>
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
                    accept=".json,.oms00,.xml"
                    className="hidden"
                    onChange={handleMerge}
                  />
                </div>
              </TooltipProvider>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            onClear={() => setSearch('')}
          />
          {visibleTags.length > 0 && (
            <div className="mt-6">
              <HashtagFilter
                tags={visibleTags}
                selectedTags={selectedTags}
                onToggleTag={handleToggleTag}
                onClear={() => setSelectedTags(new Set())}
              />

              {selectedTags.has(DELETED_TAG) && (
                <div className="mt-3">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setPurgeDeletedOpen(true)}
                    disabled={deletedEntryIds.length === 0}
                  >
                    Permanently delete all
                  </Button>

                  <AlertDialog open={purgeDeletedOpen} onOpenChange={setPurgeDeletedOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Permanently delete all</AlertDialogTitle>
                        <AlertDialogDescription>
                          {deletedEntryIds.length === 0
                            ? 'There are no deleted entries.'
                            : `Are you sure you want to permanently delete ${deletedEntryIds.length} deleted ${deletedEntryIds.length === 1 ? 'entry' : 'entries'}? This action cannot be undone.`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={permanentlyDeleteAllDeleted}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={deletedEntryIds.length === 0}
                        >
                          Delete permanently
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main ref={resultsScrollRootRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="container max-w-4xl px-4 py-6">
          {filteredEntries.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {visibleEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="animate-slide-up min-w-0"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <PasswordCard
                      entry={entry}
                      onEdit={handleEdit}
                      onDelete={deleteEntry}
                      onSoftDelete={handleSoftDelete}
                      onTagClick={handleToggleTag}
                      applyRef={applyRef}
                      setSearch={setSearch}
                    />
                  </div>
                ))}
              </div>

              {visibleResultsCount < filteredEntries.length && (
                <div ref={loadMoreSentinelRef} className="py-8 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </>
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
              {selectedTags.size > 0 && ` tagged ${Array.from(selectedTags).map(t => `#${t}`).join(' ')}`}
            </p>
          )}
        </div>
      </main>


      <PasswordForm
        open={formOpen}
        onOpenChange={handleFormClose}
        entry={editingEntry}
        onSave={handleSave}
        existingTags={allTags}
        settings={vaultData.settings}
      />

      <ManageTagsDialog
        open={manageTagsOpen}
        onOpenChange={setManageTagsOpen}
        tags={allTags.filter(t => t !== DELETED_TAG)}
        onRename={handleRenameTag}
        onDelete={handleDeleteTag}
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
