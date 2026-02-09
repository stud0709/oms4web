export interface CustomField {
  id: string;
  label: string;
  value: string;
  protection: CustomFieldProtection
  readonly: boolean;
}

export type CustomFieldProtection = 'none' | 'secret' | 'encrypted';

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  passwordReadonly: boolean;
  url: string;
  notes: string;
  hashtags: string[];
  customFields: CustomField[];
  createdAt: Date;
  updatedAt: Date;
}

export interface VaultData {
  entries: PasswordEntry[];
  publicKey: string;
  encryptionSettings: EncryptionSettings;
  encryptionEnabled: boolean;
  vaultName: string;
  workspaceProtection: WorkspaceProtection;
}

export type VaultState = { status: 'loading'; } |
{ status: 'encrypted'; encryptedData: string; } |
{ status: 'pin-locked'; aesKey: CryptoKey; salt: Uint8Array<ArrayBuffer>; iv: Uint8Array; encrypted: ArrayBuffer; omsMessage: string; } |
{ status: 'ready'; };

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
export interface EncryptionSettings {
  rsaTransformationIdx: number;
  aesKeyLength: number;
  aesTransformationIdx: number;
}
export type WorkspaceProtection = 'none' | 'encrypt' | 'pin';
// AES Transformations - matching Java AesTransformation enum

export interface AesTransformation {
  idx: number;
  name: string;
  algorithm: string;
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

