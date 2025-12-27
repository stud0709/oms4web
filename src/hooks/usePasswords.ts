import { useState, useEffect, useCallback } from 'react';
import { PasswordEntry } from '@/types/password';
import { EncryptionSettings, DEFAULT_ENCRYPTION_SETTINGS } from '@/lib/crypto';

const STORAGE_KEY = 'vault_data';

interface VaultData {
  entries: PasswordEntry[];
  publicKey: string;
  encryptionSettings: EncryptionSettings;
}

export function usePasswords() {
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [publicKey, setPublicKey] = useState<string>('');
  const [encryptionSettings, setEncryptionSettings] = useState<EncryptionSettings>(DEFAULT_ENCRYPTION_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Handle both old format (array) and new format (object with entries)
        if (Array.isArray(parsed)) {
          setEntries(parsed.map((e: PasswordEntry) => ({
            ...e,
            createdAt: new Date(e.createdAt),
            updatedAt: new Date(e.updatedAt),
          })));
        } else {
          const data = parsed as VaultData;
          setEntries((data.entries || []).map((e: PasswordEntry) => ({
            ...e,
            createdAt: new Date(e.createdAt),
            updatedAt: new Date(e.updatedAt),
          })));
          setPublicKey(data.publicKey || '');
          // Normalize encryption settings - if rsaTransformationIdx is not 1 or 2, reset to default
          const loadedSettings = data.encryptionSettings || DEFAULT_ENCRYPTION_SETTINGS;
          if (loadedSettings.rsaTransformationIdx !== 1 && loadedSettings.rsaTransformationIdx !== 2) {
            loadedSettings.rsaTransformationIdx = DEFAULT_ENCRYPTION_SETTINGS.rsaTransformationIdx;
          }
          setEncryptionSettings(loadedSettings);
        }
      } catch (e) {
        console.error('Failed to parse stored data', e);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      const data: VaultData = { entries, publicKey, encryptionSettings };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [entries, publicKey, encryptionSettings, isLoaded]);

  const addEntry = useCallback((entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newEntry: PasswordEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setEntries(prev => [newEntry, ...prev]);
    return newEntry;
  }, []);

  const updateEntry = useCallback((id: string, updates: Partial<Omit<PasswordEntry, 'id' | 'createdAt'>>) => {
    setEntries(prev => prev.map(entry => 
      entry.id === id 
        ? { ...entry, ...updates, updatedAt: new Date() }
        : entry
    ));
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setEntries(prev => prev.filter(entry => entry.id !== id));
  }, []);

  const getAllHashtags = useCallback(() => {
    const tags = new Set<string>();
    entries.forEach(entry => entry.hashtags.forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }, [entries]);

  const importEntries = useCallback((newEntries: PasswordEntry[], newPublicKey?: string, newEncryptionSettings?: EncryptionSettings) => {
    const processedEntries = newEntries.map(e => ({
      ...e,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
    }));
    setEntries(processedEntries);
    if (newPublicKey !== undefined) {
      setPublicKey(newPublicKey);
    }
    if (newEncryptionSettings !== undefined) {
      setEncryptionSettings(newEncryptionSettings);
    }
  }, []);

  const exportData = useCallback(() => {
    return { entries, publicKey, encryptionSettings };
  }, [entries, publicKey, encryptionSettings]);

  const updatePublicKey = useCallback((key: string) => {
    setPublicKey(key);
  }, []);

  const updateEncryptionSettings = useCallback((settings: EncryptionSettings) => {
    setEncryptionSettings(settings);
  }, []);

  return {
    entries,
    publicKey,
    encryptionSettings,
    isLoaded,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
    importEntries,
    exportData,
    updatePublicKey,
    updateEncryptionSettings,
  };
}
