import {
  useState,
  useEffect,
  useCallback
} from 'react';

import {
  AppSettings,
  CustomField,
  OmsDbSchema,
  PasswordEntry,
  PasswordEntryHistoryItem,
  QuickUnlockData,
  VaultData,
  VaultState,
  WorkspaceProtection
} from '@/types/types';

import {
  generateIv,
  toArrayBuffer,
  generateKeyFromPassword,
  createEncryptedMessage,
  generateAesKey,
  aesDecryptData,
  parseRsaAesEnvelope
} from '@/lib/crypto';
import {
  OMS_PREFIX,
  DEFAULT_SETTINGS,
  APPLICATION_IDS,
  OMS4WEB_REF,
  CUSTOM_FIELD_PROTECTION_PROPERTY_NAME,
  ENTRIES_PROPERTY_NAME,
  SETTINGS_PROPERTY_NAME
} from "@/lib/constants";
import { encryptVaultData } from '@/lib/fileEncryption';
import {
  oms4webDbPromise,
  QUICK_UNLOCK_STORE,
  STORAGE_KEY,
  VAULT_STORE_V1,
  VAULT_STORE_V2,
  VAULT_STORE_V3,
} from '@/lib/db';
import { JSONPath } from 'jsonpath-plus';
import { IDBPDatabase } from 'idb';

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

export const setQuickUnlock = async (
  vaultAesKeyRaw: Uint8Array,
  workspaceProtection: WorkspaceProtection) => {

  const db = await oms4webDbPromise;

  if (workspaceProtection === 'quickUnlock' && !getEnvironment().android) {
    //create wrapper key (AES)
    const wrapperKey = await generateAesKey(256, 'AES-GCM', false);
    const wrapperIv = generateIv(12);

    //encrypt vault key
    const encryptedVaultKey = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: toArrayBuffer(wrapperIv)
    },
      wrapperKey,
      vaultAesKeyRaw.slice().buffer);

    //set data
    await db.put(
      QUICK_UNLOCK_STORE,
      {
        wrapperKey,
        wrapperIv,
        encryptedVaultKey: new Uint8Array(encryptedVaultKey)
      },
      STORAGE_KEY
    );
  } else {
    await db.delete(QUICK_UNLOCK_STORE, STORAGE_KEY);
  }
};

export const validateJson = (data: unknown) => {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid format');

  const vd = data as VaultData;

  if (!(ENTRIES_PROPERTY_NAME in vd) || !Array.isArray(vd.entries)) {
    throw new Error('Invalid format');
  }

  if (!(SETTINGS_PROPERTY_NAME in vd)) throw new Error('Invalid format');

  validateSettings(vd.settings);

  vd.entries = vd.entries.map(entry => ({
    ...entry,
    history: entry.history ?? []
  }));

  return vd;
}

export const validateSettings = (settings: AppSettings) => {
  settings = { ...DEFAULT_SETTINGS, ...settings };

  if (!settings.publicKey) {
    settings.workspaceProtection = 'none';
    settings.encryptionEnabled = false;
  }
}

const _encryptAndLock = (vaultData: VaultData, andThen: (vaultState: VaultState) => void) => {
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
        ).then(encryptedData => {
          andThen({
            status: 'pin-locked',
            aesKey,
            salt,
            iv,
            encryptedData,
            omsMessage
          });
        });
      });
  });
};

export function useEncryptedVault() {
  const [vaultState, setVaultState] = useState<VaultState>({ status: 'loading' });
  const [vaultData, setVaultData] = useState<VaultData>(EMPTY_VAULT);

  /** OLD FORMAT, REMOVE */
  const parseObsoleteStorage = useCallback(async (db: IDBPDatabase<OmsDbSchema>, quickUnlock: QuickUnlockData) => {
    if (!db.objectStoreNames.contains(VAULT_STORE_V1)) return false;
    const stored = await db.get(VAULT_STORE_V1, STORAGE_KEY);
    if (!stored) return false;

    if (stored.startsWith(OMS_PREFIX)) {
      //encrypted version
      const base64Data = stored.slice(OMS_PREFIX.length);
      const binary = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

      setVaultState({
        status: 'encrypted',
        encryptedData: binary,
        quickUnlock
      });
    } else {
      //plain JSON
      const json = JSON.parse(stored);
      setVaultData(validateJson(json));
      setVaultState({ status: 'ready' });
    }

    return true;
  }, []);

  /** OLD FORMAT, REMOVE */
  const parseObsoleteStorageV2 = useCallback(async (db: IDBPDatabase<OmsDbSchema>, quickUnlock: QuickUnlockData) => {
    if (!db.objectStoreNames.contains(VAULT_STORE_V2)) return false;
    const stored = await db.get(VAULT_STORE_V2, STORAGE_KEY);
    if (!stored) return false;

    if (stored[0] === 123 /* ASCII 123 is opening curly brace, should be JSON object */) {
      try {
        const json = JSON.parse(new TextDecoder().decode(stored));
        setVaultData(validateJson(json));
        setVaultState({ status: 'ready' });
      } catch (e) {
        console.error('Failed to parse stored data, starting with empty vault', e);
        setVaultState({ status: 'ready' });
        setVaultData(EMPTY_VAULT);
        throw new Error('Failed to parse stored data, starting with empty vault', { cause: e });
      }
    } else {
      //encrypted
      setVaultState({
        status: 'encrypted',
        encryptedData: stored,
        quickUnlock
      });
    }

    return true;
  }, []);

  const encryptAndLock = useCallback(() => {
    _encryptAndLock(vaultData, vaultState => {
      setVaultState(vaultState);
      setVaultData(EMPTY_VAULT);
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
      const quickUnlock = await db.get(QUICK_UNLOCK_STORE, STORAGE_KEY);

      //OLD FORMAT, REMOVE >>>
      if (await parseObsoleteStorage(db, quickUnlock)) return;
      //<<< OLD FORMAT, REMOVE

      const storedV3 = await db.get(VAULT_STORE_V3, STORAGE_KEY);

      if (!storedV3) {
        //OLD FORMAT, REMOVE >>>
        if (await parseObsoleteStorageV2(db, quickUnlock)) return;
        //<<< OLD FORMAT, REMOVE
        setVaultState({ status: 'ready' });
        setVaultData(EMPTY_VAULT);
        return;
      }

      const stored = storedV3.vault;

      if (stored[0] === 123 /* ASCII 123 is opening curly brace, should be JSON object */) {
        try {
          const json = JSON.parse(new TextDecoder().decode(stored));
          setVaultData(validateJson(json));
          setVaultState({ status: 'ready' });
        } catch (e) {
          console.error('Failed to parse stored data, starting with empty vault', e);
          setVaultState({ status: 'ready' });
          setVaultData(EMPTY_VAULT);
          throw new Error('Failed to parse stored data, starting with empty vault', { cause: e });
        }
      } else {
        //encrypted
        setVaultState({
          status: 'encrypted',
          encryptedData: stored,
          quickUnlock
        });
      }
    })();
  }, [parseObsoleteStorage, parseObsoleteStorageV2]);

  // Save vault when data changes 
  useEffect(() => {
    if (vaultState.status !== 'ready') return;

    (async () => {
      const jsonData = JSON.stringify(vaultData);
      const dataBytes = new TextEncoder().encode(jsonData);

      const db = await oms4webDbPromise;

      // Only encrypt if we have a valid public key, and workspace protection is activated
      if (vaultData.settings.publicKey
        && vaultData.settings.workspaceProtection !== 'none') {
        try {
          const encryptedBytes = await encryptVaultData(
            dataBytes,
            vaultData.settings
          );
          await db.put(VAULT_STORE_V3, {
            vault: encryptedBytes,
            sha256OnSave: new Uint8Array()
          }, STORAGE_KEY);
        } catch (e) {
          console.error('Failed to encrypt vault, saving as plain JSON', e);
          throw new Error('Failed to encrypt vault, saving as plain JSON', { cause: e });
        }
      } else {
        // Save as plain JSON for 'none' and 'pin' modes, or as fallback
        await db.put(VAULT_STORE_V3, {
          vault: dataBytes,
          sha256OnSave: new Uint8Array()
        }, STORAGE_KEY);
      }

      //OLD FORMAT, REMOVE >>>
      if (db.objectStoreNames.contains(VAULT_STORE_V1)) {
        db.delete(VAULT_STORE_V1, STORAGE_KEY);
      }
      if (db.objectStoreNames.contains(VAULT_STORE_V2)) {
        db.delete(VAULT_STORE_V2, STORAGE_KEY);
      }
      //<<< OLD FORMAT, REMOVE
    })();
  }, [vaultData, vaultState.status]);

  const switchToQuickUnlock = async (vaultState: VaultState) => {
    if (vaultState.status !== 'encrypted') return;

    //decrypt the file key using wrapper key
    const aesKeyBytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(vaultState.quickUnlock.wrapperIv)
      },
      vaultState.quickUnlock.wrapperKey,
      vaultState.quickUnlock.encryptedVaultKey.slice().buffer
    );

    const envelope = parseRsaAesEnvelope(vaultState.encryptedData);

    //restore key
    const aesKey = await crypto.subtle.importKey(
      'raw',
      aesKeyBytes,
      { name: envelope.aesTransformation.algorithm },
      false,
      ['decrypt']
    );

    // Decrypt file contents
    const ivBuffer = toArrayBuffer(envelope.iv);
    const decrypted = await aesDecryptData(
      envelope.aesTransformation.algorithm,
      ivBuffer,
      aesKey,
      envelope.encryptedData);
    const decoded = new TextDecoder().decode(decrypted);
    const vaultData = validateJson(JSON.parse(decoded));

    _encryptAndLock(vaultData, vaultStatePinLocked => setVaultState(vaultStatePinLocked));
  };

  const loadDecryptedData = useCallback((vaultData: VaultData) => {
    try {
      setVaultData(vaultData);
      setVaultState({ status: 'ready' });
      return vaultData;
    } catch (e) {
      console.error('Failed to parse decrypted data', e);
      throw new Error('Invalid decrypted data format', { cause: e });
    }
  }, []);

  const startWithEmptyVault = useCallback(() => {
    setVaultData(EMPTY_VAULT);
    setVaultState({ status: 'ready' });
  }, []);

  const lockVault = useCallback(() => {
    (async () => {
      // Re-read from storage and reset state to trigger unlock flow
      const db = await oms4webDbPromise;
      let binary: Uint8Array | undefined;
      //OLD FORMAT, REMOVE >>>
      let stored: string | undefined;
      if (db.objectStoreNames.contains(VAULT_STORE_V1)) {
        stored = await db.get(VAULT_STORE_V1, STORAGE_KEY);
      }
      if (stored) {
        const base64Data = stored.slice(OMS_PREFIX.length);
        binary = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      } else
      //<<<OLD FORMAT, REMOVE 
      if (!binary) {
        const storedV3 = await db.get(VAULT_STORE_V3, STORAGE_KEY);
        if (storedV3) {
          binary = storedV3.vault;
        }
      }
      if (!binary && db.objectStoreNames.contains(VAULT_STORE_V2)) {
        binary = await db.get(VAULT_STORE_V2, STORAGE_KEY);
      }
      if (!binary) {
        console.error('Failed to load vault data on lock');
        return;
      }

      const quickUnlock = await db.get(QUICK_UNLOCK_STORE, STORAGE_KEY);

      // Encrypt on Lock
      if (vaultData.settings.workspaceProtection === 'encrypt' ||
        //enforce this mode on android device if PIN has been configured
        (vaultData.settings.workspaceProtection === 'pin' && getEnvironment().android)
      ) {
        setVaultState({
          status: 'encrypted',
          encryptedData: binary,
          quickUnlock
        });
        setVaultData(EMPTY_VAULT);
        return;
      }

      // PIN protection (desktop only)
      encryptAndLock();
    })();
  }, [vaultData, encryptAndLock]);

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
        vaultState.encryptedData
      );
      const decoded = new TextDecoder().decode(decrypted);
      const data = validateJson(JSON.parse(decoded));

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

  const addEntry = useCallback((entry: Omit<PasswordEntry, 'id' | 'createdAt' | 'updatedAt' | 'history'>) => {
    const newEntry: PasswordEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [],
    };
    setEntries(prev => [newEntry, ...prev]);
    return newEntry;
  }, [setEntries]);

  const updateEntry = useCallback((id: string, updates: Partial<Omit<PasswordEntry, 'id' | 'createdAt' | 'history'>>) => {
    setEntries(prev => prev.map(entry =>
      entry.id === id
        ? (() => {
          const { history, ...entryData } = entry;
          const historyEntry: PasswordEntryHistoryItem = {
            timestamp: new Date(),
            data: entryData,
          };
          return {
            ...entry,
            ...updates,
            updatedAt: new Date(),
            history: [historyEntry, ...(history ?? [])],
          };
        })()
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
    const deepMap = (obj: unknown): unknown => {
      // Handle Arrays
      if (Array.isArray(obj)) {
        return obj.map(item => deepMap(item));
      }

      // Handle Objects
      if (typeof obj === 'object' && obj !== null) {
        const copy: Record<string, unknown> = {};
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            copy[key] = deepMap(obj[key]);
          }
        }
        if (CUSTOM_FIELD_PROTECTION_PROPERTY_NAME in obj) {
          const customField = obj as CustomField;
          if (customField.value.startsWith(OMS4WEB_REF)) {
            //inherit protection mode as well
            const path = customField.value.substring(OMS4WEB_REF.length);
            copy[CUSTOM_FIELD_PROTECTION_PROPERTY_NAME] = (query(path) as CustomField)?.protection || customField.protection;
          }
        }
        return copy;
      }

      if (typeof obj !== 'string')
        return obj;

      if (!obj.startsWith(OMS4WEB_REF)) return obj;

      const path = obj.substring(OMS4WEB_REF.length);
      const result = query(path) ?? '(invalid reference)';

      if (typeof result === 'string') return result;
      return (result as CustomField).value;
    }

    const query = (path: string) => {
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
    setSettings,
    applyRef,
    switchToQuickUnlock,
  };
}
