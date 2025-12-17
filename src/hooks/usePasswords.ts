import { useState, useEffect, useCallback } from 'react';
import { PasswordEntry } from '@/types/password';

const STORAGE_KEY = 'vault_passwords';

export function usePasswords() {
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setEntries(parsed.map((e: PasswordEntry) => ({
          ...e,
          createdAt: new Date(e.createdAt),
          updatedAt: new Date(e.updatedAt),
        })));
      } catch (e) {
        console.error('Failed to parse stored passwords', e);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  }, [entries, isLoaded]);

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

  return {
    entries,
    isLoaded,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
  };
}
