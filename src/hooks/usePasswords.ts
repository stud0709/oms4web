import { useState, useEffect, useCallback } from 'react';
import { PasswordEntry } from '@/types/password';

const STORAGE_KEY = 'vault_data';

interface VaultData {
  entries: PasswordEntry[];
  publicKey: string;
}

export function usePasswords() {
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [publicKey, setPublicKey] = useState<string>('');
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
        }
      } catch (e) {
        console.error('Failed to parse stored data', e);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      const data: VaultData = { entries, publicKey };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [entries, publicKey, isLoaded]);

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

  const importEntries = useCallback((newEntries: PasswordEntry[], newPublicKey?: string) => {
    const processedEntries = newEntries.map(e => ({
      ...e,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
    }));
    setEntries(processedEntries);
    if (newPublicKey !== undefined) {
      setPublicKey(newPublicKey);
    }
  }, []);

  const exportData = useCallback(() => {
    return { entries, publicKey };
  }, [entries, publicKey]);

  const updatePublicKey = useCallback((key: string) => {
    setPublicKey(key);
  }, []);

  return {
    entries,
    publicKey,
    isLoaded,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
    importEntries,
    exportData,
    updatePublicKey,
  };
}
