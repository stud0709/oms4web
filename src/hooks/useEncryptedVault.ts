import {
  useState,
  useEffect,
  useCallback
} from 'react';

import {
  AppSettings,
  CustomField,
  PasswordEntry,
  VaultData,
  VaultState
} from '@/types/types';

import {
  generateIv,
  toArrayBuffer,
  generateKeyFromPassword,
  createEncryptedMessage
} from '@/lib/crypto';
import {
  OMS_PREFIX,
  DEFAULT_SETTINGS,
  APPLICATION_IDS,
  OMS4WEB_REF,
  customFieldProtectionPropertyName
} from "@/lib/constants";
import { encryptVaultData } from '@/lib/fileEncryption';
import {
  oms4webDbPromise,
  STORAGE_KEY,
  VAULT_STORE
} from '@/lib/db';
import { JSONPath } from 'jsonpath-plus';

const EMPTY_VAULT: VaultData = {
  entries: [],
  settings: DEFAULT_SETTINGS,
};

export const getEnvironment:
  () => {
    android: boolean,
    pwaMode: boolean
  } =
  () => ({
    android: /Android/i.test(navigator.userAgent),
    pwaMode: ['standalone', 'fullscreen', 'minimal-ui'].some(mode => window.matchMedia(`(display-mode: ${mode}`).matches)
  });

const getIntentUrl = (message: string) => {
  const packageName = "com.onemoresecret";
  const baseUrl = "stud0709.github.io/oms_intent/";
  //const fallbackUrl = `https://${baseUrl}#data=${encodeURIComponent(message)}`;
  return [
    `intent://${baseUrl}#Intent`,
    "scheme=https",
    `package=${packageName}`,
    `S.m=${message}`,
    `S.browser_fallback_url=${encodeURIComponent(baseUrl)}`,
    "end"
  ].join(';');
}

export const handleIntent = (message: string) => {
  const intentUrl = getIntentUrl(message);
  console.log(`Created intentUrl: ${intentUrl}`);
  window.location.href = intentUrl;
};

export const getTimestamp = () =>
  new Date().toISOString()
    .replace(/[:.]/g, '-') // Swap colons and dots for dashes
    .replace('T', '_')     // Swap the 'T' separator for an underscore
    .slice(0, 19);         // Remove the milliseconds and 'Z'


export const downloadVault = (vaultName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = vaultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function useEncryptedVault() {
  const [vaultState, setVaultState] = useState<VaultState>({ status: 'loading' });
  const [vaultData, setVaultData] = useState<VaultData>(EMPTY_VAULT);

  const encryptAndLock = useCallback(() => {
    const encoded = new TextEncoder().encode(JSON.stringify(vaultData));
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    createEncryptedMessage(
      `${pin}\n`,
      vaultData.settings,
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
    (async () => {
      //request persistent storage             
      const isPersisted = await navigator?.storage?.persisted();
      if (isPersisted) {
        console.log("Persistent storage already granted");
      } else {
        const isGranted = await navigator?.storage?.persist();
        if (isGranted) {
          console.log("Persistent storage has been granted");
        } else {
          console.log("Storage may be cleared under storage pressure.");
        }
      }

      const db = await oms4webDbPromise;
      const stored = await db.get(VAULT_STORE, STORAGE_KEY);

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
        setVaultData(JSON.parse(stored));
        setVaultState({ status: 'ready' });
      } catch (e) {
        console.error('Failed to parse stored data, starting with empty vault', e);
        setVaultState({ status: 'ready' });
        setVaultData(EMPTY_VAULT);
        throw new Error('Failed to parse stored data, starting with empty vault');
      }
    })();
  }, []);

  // Save vault when data changes 
  useEffect(() => {
    if (vaultState.status !== 'ready') return;

    (async () => {
      const jsonData = JSON.stringify(vaultData);
      const db = await oms4webDbPromise;

      // Only encrypt if we have a valid public key, and workspace protection is activated
      if (vaultData.settings.publicKey
        && vaultData.settings.workspaceProtection !== 'none') {
        try {
          const encryptedBytes = await encryptVaultData(
            jsonData,
            vaultData.settings
          );
          // Encode as OMS text format for indexDb
          const encoded = OMS_PREFIX + btoa(String.fromCharCode(...encryptedBytes));
          await db.put(VAULT_STORE, encoded, STORAGE_KEY);
          return;
        } catch (e) {
          console.error('Failed to encrypt vault, saving as plain JSON', e);
          throw new Error('Failed to encrypt vault, saving as plain JSON');
        }
      }

      // Save as plain JSON for 'none' and 'pin' modes, or as fallback
      await db.put(VAULT_STORE, jsonData, STORAGE_KEY);
    })();
  }, [vaultData, vaultState.status]);

  const loadDecryptedData = useCallback((jsonData: string) => {
    try {
      setVaultData(JSON.parse(jsonData));
      setVaultState({ status: 'ready' });
    } catch (e) {
      console.error('Failed to parse decrypted data', e);
      throw new Error('Invalid decrypted data format');
    }
  }, []);

  const startWithEmptyVault = useCallback(async () => {
    setVaultData(EMPTY_VAULT);
    setVaultState({ status: 'ready' });
    // Save empty vault
    const db = await oms4webDbPromise;
    db.put(VAULT_STORE, STORAGE_KEY, JSON.stringify(EMPTY_VAULT));
  }, []);

  const lockVault = useCallback(() => {
    (async () => {
      // Re-read from storage and reset state to trigger unlock flow
      const db = await oms4webDbPromise;
      const stored = await db.get(VAULT_STORE, STORAGE_KEY);

      // Encrypt on Lock
      if (vaultData.settings.workspaceProtection === 'encrypt' ||
        //enforce this mode on android device if PIN has been configured
        (vaultData.settings.workspaceProtection === 'pin' && getEnvironment().android)
      ) {
        setVaultState({ status: 'encrypted', encryptedData: stored });
        setVaultData(EMPTY_VAULT);
        return;
      }

      // PIN protection (desktop only)
      encryptAndLock();
    })();
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

  const setSettings = useCallback((settings: AppSettings) => {
    setVaultData(prev => ({ ...prev, settings }));
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

  const importEntries = useCallback((data: VaultData) => {
    setVaultData(data);
  }, []);

  const exportData = useCallback(() => {
    return vaultData;
  }, [vaultData]);

  const applyRef = useCallback((entry: PasswordEntry) => {
    const deepMap = (obj: any) => {
      // Handle Arrays
      if (Array.isArray(obj)) {
        return obj.map(item => deepMap(item));
      }

      // Handle Objects
      if (typeof obj === 'object' && obj !== null) {
        const copy = {};
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            copy[key] = deepMap(obj[key]);
          }
        }
        if (customFieldProtectionPropertyName in obj) {
          const customField = obj as CustomField;
          if (customField.value.startsWith(OMS4WEB_REF)) {
            //inherit protection mode as well
            const path = customField.value.substring(OMS4WEB_REF.length);
            (copy as CustomField).protection = (query(path, vaultData) as CustomField)?.protection || customField.protection;
          }
        }
        return copy;
      }

      if (typeof obj !== 'string')
        return obj;

      if (!obj.startsWith(OMS4WEB_REF)) return obj;

      const path = obj.substring(OMS4WEB_REF.length);
      const result = query(path, vaultData.entries) ?? '(invalid reference)';

      if (typeof result === 'string') return result;
      return (result as CustomField).value;
    }

    const query = (path: string, json: any) => {
      try {
        return JSONPath({
          path: path,
          json: vaultData.entries
        })?.[0]
      } catch (err) {
        console.log(err)
      }
    }

    return deepMap(entry) as PasswordEntry
  }, [vaultData]);

  return {
    vaultState,
    vaultData: vaultData,
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
    updateSettings: setSettings,
    applyRef
  };
}
