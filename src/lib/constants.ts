import type {
  AesTransformation,
  RsaTransformation,
  AppSettings
} from "@/types/types";

export const APPLICATION_IDS = {
  AES_ENCRYPTED_PRIVATE_KEY_TRANSFER: 0,
  ENCRYPTED_MESSAGE_DEPRECATED: 1,
  TOTP_URI_DEPRECATED: 2,
  ENCRYPTED_FILE: 3,
  KEY_REQUEST: 4,
  KEY_RESPONSE: 5,
  RSA_AES_GENERIC: 6,
  BITCOIN_ADDRESS: 7,
  ENCRYPTED_MESSAGE: 8,
  TOTP_URI: 9,
  WIFI_PAIRING: 10,
  KEY_REQUEST_PAIRING: 11,
  ENCRYPTED_OTP: 12,
  OMS4WEB_CALLBACK_REQUEST: 13,
} as const;

export const AES_TRANSFORMATIONS: AesTransformation[] = [
  { idx: 0, name: 'AES/CBC/PKCS5Padding', algorithm: 'AES-CBC', ivSize: 16 },
  { idx: 1, name: 'AES/CBC/PKCS7Padding', algorithm: 'AES-CBC', ivSize: 16 },
  { idx: 2, name: 'AES/GCM/NoPadding', algorithm: 'AES-GCM', ivSize: 12 },
] as const;

// RSA Transformations - matching Java RsaTransformation enum
export const RSA_TRANSFORMATIONS: Record<number, RsaTransformation> = {
  // Note: idx 0 (PKCS1Padding) not supported by WebCrypto, removed
  1: { idx: 1, name: 'RSA/ECB/OAEPWithSHA-1AndMGF1Padding', algorithm: { name: 'RSA-OAEP', hash: 'SHA-1' } },
  2: { idx: 2, name: 'RSA/ECB/OAEPWithSHA-256AndMGF1Padding', algorithm: { name: 'RSA-OAEP', hash: 'SHA-256' } },
};

// AES Key Lengths
export const AES_KEY_LENGTHS = [128, 192, 256] as const;

//QR sequence interval (ms)
export const INTERVAL_QR_SEQUENCE = 250;

export const DEFAULT_SETTINGS: AppSettings = {
  publicKey: '',
  rsaTransformationIdx: 2,
  aesKeyLength: 256,
  aesTransformationIdx: 0,
  encryptionEnabled: false,
  vaultName: '',
  workspaceProtection: 'none',
  expertMode: false,
};

export const
  OMS_PREFIX = 'oms00_',
  SW_BASE = '/oms4web/',
  OMS4WEB_REF = 'oms4web://',
  customFieldProtectionPropertyName = 'protection';



