import {
  useState,
  useEffect,
  useCallback
} from 'react';

import { PasswordEntry } from '@/types/password';

import {
  EncryptionSettings,
  DEFAULT_ENCRYPTION_SETTINGS,
  OMS_PREFIX,
  RSA_TRANSFORMATIONS,
  AES_TRANSFORMATIONS,
  AES_KEY_LENGTHS,
  WorkspaceProtection,
  generateIv,
  toArrayBuffer,
  generateKeyFromPassword,
  createEncryptedMessage,
  APPLICATION_IDS
} from '@/lib/crypto';

import {encryptVaultData} from '@/lib/fileEncryption';

const STORAGE_KEY = 'vault_data';

export interface VaultData {
  entries: PasswordEntry[];
  publicKey: string;
  encryptionSettings: EncryptionSettings;
  encryptionEnabled: boolean;
  vaultName: string;
  workspaceProtection: WorkspaceProtection;
}

const EMPTY_VAULT: VaultData = {
  entries: [],
  publicKey: '',
  encryptionSettings: DEFAULT_ENCRYPTION_SETTINGS,
  encryptionEnabled: false,
  vaultName: '',
  workspaceProtection: 'none',
};

export type VaultState =
  | { status: 'loading' }
  | { status: 'encrypted'; encryptedData: string }
  | { status: 'pin-locked', aesKey: CryptoKey, salt: Uint8Array<ArrayBuffer>, iv: Uint8Array, encrypted: ArrayBuffer, omsMessage: string }
  | { status: 'ready' };

export function useEncryptedVault() {
  const [vaultState, setVaultState] = useState<VaultState>({ status: 'loading' });
  const [vaultData, setVaultData] = useState<VaultData>(EMPTY_VAULT);

  const encryptAndLock = useCallback(() => {
    const encoded = new TextEncoder().encode(JSON.stringify(vaultData));
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    createEncryptedMessage(
      `${pin}\n`,
      vaultData.publicKey,
      vaultData.encryptionSettings,
      APPLICATION_IDS.ENCRYPTED_OTP
    ).then(omsMessage => {
      generateKeyFromPassword(pin)
        .then(({ aesKey, salt }) => {
          const iv = generateIv(12);
          crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: toArrayBuffer(iv)
            },
            aesKey,
            encoded
          ).then(cipherText => {
            setVaultState({
              status: 'pin-locked',
              aesKey: aesKey,
              salt: salt,
              iv: iv,
              encrypted: cipherText,
              omsMessage: omsMessage
            });
            setVaultData(EMPTY_VAULT);
          });
        });
    });
  }, [vaultData]);

  // Load vault on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setVaultState({ status: 'ready' });
      setVaultData(EMPTY_VAULT);
      return;
    }

    // Check if data is encrypted (only for 'encrypt' protection mode)
    if (stored.startsWith(OMS_PREFIX)) {
      setVaultState({ status: 'encrypted', encryptedData: stored });
      return;
    }

    // Try to parse as plain JSON
    try {
      const parsed = JSON.parse(stored);
      const data = parseVaultData(parsed);
      setVaultData(data);
      setVaultState({ status: 'ready' });
    } catch (e) {
      console.error('Failed to parse stored data, starting with empty vault', e);
      setVaultState({ status: 'ready' });
      setVaultData(EMPTY_VAULT);
      throw new Error('Failed to parse stored data, starting with empty vault');
    }
  }, []);

  // Save vault when data changes 
  useEffect(() => {
    if (vaultState.status !== 'ready') return;

    (async () => {
      const jsonData = JSON.stringify(vaultData);

      // Only encrypt if we have a valid public key
      if (vaultData.publicKey) {
        try {
          const encryptedBytes = await encryptVaultData(
            jsonData,
            vaultData.publicKey,
            vaultData.encryptionSettings
          );
          // Encode as OMS text format for localStorage
          const encoded = OMS_PREFIX + btoa(String.fromCharCode(...encryptedBytes));
          localStorage.setItem(STORAGE_KEY, encoded);
          return;
        } catch (e) {
          console.error('Failed to encrypt vault, saving as plain JSON', e);
          throw new Error('Failed to encrypt vault, saving as plain JSON');
        }
      }

      // Save as plain JSON for 'none' and 'pin' modes, or as fallback
      localStorage.setItem(STORAGE_KEY, jsonData);
    })();
  }, [vaultData, vaultState.status]);

  const loadDecryptedData = useCallback((jsonData: string) => {
    try {
      const parsed = JSON.parse(jsonData);
      const data = parseVaultData(parsed);
      setVaultData(data);
      setVaultState({ status: 'ready' });
    } catch (e) {
      console.error('Failed to parse decrypted data', e);
      throw new Error('Invalid decrypted data format');
    }
  }, []);

  const startWithEmptyVault = useCallback(() => {
    setVaultData(EMPTY_VAULT);
    setVaultState({ status: 'ready' });
    // Save empty vault
    localStorage.setItem(STORAGE_KEY, JSON.stringify(EMPTY_VAULT));
  }, []);

  const lockVault = useCallback(() => {
    // Re-read from storage and reset state to trigger unlock flow
    const stored = localStorage.getItem(STORAGE_KEY);

    // Check if data should be encrypted - if so, require decryption
    if (vaultData.workspaceProtection === 'encrypt') {
      setVaultState({ status: 'encrypted', encryptedData: stored });
      setVaultData(EMPTY_VAULT);
      return;
    }

    // Parse the stored data to check protection mode
    encryptAndLock();
  }, [vaultData]);

  const unlockPin = useCallback(async (inputValue: string) => {
    if (vaultState.status !== 'pin-locked') return false;

    try {
      const { aesKey } = await generateKeyFromPassword(inputValue, vaultState.salt);
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(vaultState.iv)
        },
        aesKey,
        vaultState.encrypted
      );
      const decoded = new TextDecoder().decode(decrypted);
      const data = JSON.parse(decoded);

      // PIN was verified, transition to ready state
      setVaultData(data);
      setVaultState({ status: 'ready' });
      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  }, [vaultState]);

  const setEntries = useCallback((entries: PasswordEntry[] | ((prev: PasswordEntry[]) => PasswordEntry[])) => {
    setVaultData(prev => ({
      ...prev,
      entries: typeof entries === 'function' ? entries(prev.entries) : entries
    }));
  }, []);

  const setPublicKey = useCallback((publicKey: string) => {
    setVaultData(prev => ({ ...prev, publicKey }));
  }, []);

  const setEncryptionSettings = useCallback((encryptionSettings: EncryptionSettings) => {
    setVaultData(prev => ({ ...prev, encryptionSettings }));
  }, []);

  const setEncryptionEnabled = useCallback((encryptionEnabled: boolean) => {
    setVaultData(prev => ({ ...prev, encryptionEnabled }));
  }, []);

  const setVaultName = useCallback((vaultName: string) => {
    setVaultData(prev => ({ ...prev, vaultName }));
  }, []);

  const setWorkspaceProtection = useCallback((workspaceProtection: WorkspaceProtection) => {
    setVaultData(prev => ({ ...prev, workspaceProtection }));
  }, []);

  const addEntry = useCallback((entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newEntry: PasswordEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setEntries(prev => [newEntry, ...prev]);
    return newEntry;
  }, [setEntries]);

  const updateEntry = useCallback((id: string, updates: Partial<Omit<PasswordEntry, 'id' | 'createdAt'>>) => {
    setEntries(prev => prev.map(entry =>
      entry.id === id
        ? { ...entry, ...updates, updatedAt: new Date() }
        : entry
    ));
  }, [setEntries]);

  const deleteEntry = useCallback((id: string) => {
    setEntries(prev => prev.filter(entry => entry.id !== id));
  }, [setEntries]);

  const getAllHashtags = useCallback(() => {
    const tags = new Set<string>();
    vaultData.entries.forEach(entry => entry.hashtags.forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }, [vaultData.entries]);

  const importEntries = useCallback((
    newEntries: PasswordEntry[],
    newPublicKey?: string,
    newEncryptionSettings?: EncryptionSettings
  ) => {
    const processedEntries = newEntries.map(e => ({
      ...e,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
    }));

    setVaultData(prev => ({
      ...prev,
      entries: processedEntries,
      ...(newPublicKey !== undefined && { publicKey: newPublicKey }),
      ...(newEncryptionSettings !== undefined && { encryptionSettings: newEncryptionSettings }),
    }));
  }, []);

  const exportData = useCallback(() => {
    return vaultData;
  }, [vaultData]);

  return {
    vaultState,
    entries: vaultData.entries,
    publicKey: vaultData.publicKey,
    encryptionSettings: vaultData.encryptionSettings,
    encryptionEnabled: vaultData.encryptionEnabled,
    vaultName: vaultData.vaultName,
    workspaceProtection: vaultData.workspaceProtection,
    isLoaded: vaultState.status === 'ready',
    loadDecryptedData,
    startWithEmptyVault,
    lockVault,
    unlockPin,
    addEntry,
    updateEntry,
    deleteEntry,
    getAllHashtags,
    importEntries,
    exportData,
    updatePublicKey: setPublicKey,
    updateEncryptionSettings: setEncryptionSettings,
    updateEncryptionEnabled: setEncryptionEnabled,
    updateVaultName: setVaultName,
    updateWorkspaceProtection: setWorkspaceProtection,
  };
}

function parseVaultData(parsed: unknown): VaultData {
  const data = parsed as VaultData;
  const entries = (data.entries || []).map((e: PasswordEntry) => ({
    ...e,
    createdAt: new Date(e.createdAt),
    updatedAt: new Date(e.updatedAt),
  }));

  // Normalize encryption settings
  const loadedSettings = data.encryptionSettings || DEFAULT_ENCRYPTION_SETTINGS;

  if (!RSA_TRANSFORMATIONS[loadedSettings.rsaTransformationIdx])
    loadedSettings.rsaTransformationIdx = DEFAULT_ENCRYPTION_SETTINGS.rsaTransformationIdx;

  if (!AES_TRANSFORMATIONS[loadedSettings.aesTransformationIdx])
    loadedSettings.aesTransformationIdx = DEFAULT_ENCRYPTION_SETTINGS.aesTransformationIdx;

  if (!AES_KEY_LENGTHS[loadedSettings.aesKeyLength])
    loadedSettings.aesKeyLength = DEFAULT_ENCRYPTION_SETTINGS.aesKeyLength;

  let workspaceProtection = data.workspaceProtection;
  if (!workspaceProtection || !['none', 'encrypt', 'pin'].includes(workspaceProtection)) {
    workspaceProtection = 'none';
  }

  return {
    entries,
    publicKey: data.publicKey || '',
    encryptionSettings: loadedSettings,
    encryptionEnabled: data.encryptionEnabled !== false,
    vaultName: data.vaultName || '',
    workspaceProtection,
  };
}
