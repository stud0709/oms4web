import { DBSchema } from "idb";

import {
  VAULT_STORE,
  VAULT_STORE_V2,
  KEY_REQUEST_STORE,
  QUICK_UNLOCK_STORE
} from "@/lib/db";

import {
  CUSTOM_FIELD_PROTECTION_PROPERTY_NAME,
  ENTRIES_PROPERTY_NAME,
  PASSWORD_READONLY_PROPERTY_NAME,
  SETTINGS_PROPERTY_NAME
} from "@/lib/constants";

export interface CustomField {
  id: string;
  label: string;
  value: string;
  [CUSTOM_FIELD_PROTECTION_PROPERTY_NAME]: CustomFieldProtection
  readonly: boolean;
}

export type CustomFieldProtection = 'none' | 'secret' | 'encrypted';

export interface PasswordEntryData {
  id: string;
  title: string;
  username: string;
  password: string;
  [PASSWORD_READONLY_PROPERTY_NAME]: boolean;
  url: string;
  notes: string;
  hashtags: string[];
  customFields: CustomField[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PasswordEntryHistoryItem {
  timestamp: Date;
  data: PasswordEntryData;
}

export interface PasswordEntry extends PasswordEntryData {
  history: PasswordEntryHistoryItem[];
}

export interface AppSettings {
  publicKey: string;
  rsaTransformationIdx: number;
  aesKeyLength: number;
  aesTransformationIdx: number;
  encryptionEnabled: boolean;
  vaultName: string;
  workspaceProtection: WorkspaceProtection;
  expertMode: boolean;
}

export interface QuickUnlockData {
  wrapperKey: CryptoKey;
  wrapperIv: Uint8Array;
  encryptedVaultKey: Uint8Array;
}

export interface OmsDbSchema extends DBSchema {
  [VAULT_STORE]: {
    key: string;
    value: string;
  };

  [VAULT_STORE_V2]: {
    key: string;
    value: Uint8Array;
  };

  [KEY_REQUEST_STORE]: {
    key: string;
    value: KeyRequestContext;
  };
  
  [QUICK_UNLOCK_STORE]: {
    key: string;
    value: QuickUnlockData;
  };
}

export interface VaultData {
  [ENTRIES_PROPERTY_NAME]: PasswordEntry[];
  [SETTINGS_PROPERTY_NAME]: AppSettings;
}

export type VaultState = {
  status: 'loading';
} |
{
  status: 'encrypted';
  encryptedData: Uint8Array;
  quickUnlock: QuickUnlockData;
} |
{
  status: 'pin-locked';
  aesKey: CryptoKey;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array;
  encryptedData: ArrayBuffer;
  omsMessage: string;
} |
{
  status: 'ready';
};

export type VaultStateWithOmsMessage = Extract<VaultState, { omsMessage: string }>;

export interface QrChunk {
  transactionId: string;
  chunkNo: number;
  totalChunks: number;
  dataLength: number;
  data: string;
  encoded: string;
}
/**
 * Parsed RSA x AES envelope from encrypted data
 */


export interface RsaAesEnvelope {
  applicationId: number;
  rsaTransformation: RsaTransformation;
  fingerprint: Uint8Array;
  aesTransformation: AesTransformation;
  iv: Uint8Array;
  encryptedAesKey: Uint8Array;
  encryptedData: Uint8Array;
}

export type WorkspaceProtection = 'none' | 'encrypt' | 'pin' | 'quickUnlock';
// AES Transformations - matching Java AesTransformation enum

export interface AesTransformation {
  idx: number;
  name: string;
  algorithm: 'AES-CBC' | 'AES-GCM';
  ivSize: number;
}

export interface RsaTransformation {
  idx: number;
  name: string;
  algorithm: { name: string; hash: string; };
}
/**
 * Key Request context - holds the temporary RSA key pair and envelope data
 */


export interface KeyRequestContext {
  keyPair: CryptoKeyPair;
  envelope: RsaAesEnvelope;
  message: string; // OMS-encoded message for QR display
}
