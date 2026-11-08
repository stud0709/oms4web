import * as protocol from './protocol';
/**
 * OMS Companion compatible encryption implementation
 * Based on: https://github.com/stud0709/oms_companion
 */

import {
  AesTransformation,
  AppSettings,
  RsaAesEnvelope
} from "@/types/types";

import {
  AES_TRANSFORMATIONS,
  APPLICATION_IDS,
  OMS_PREFIX,
  RSA_TRANSFORMATIONS
} from "./constants";
import { bytesToBase64 } from './base64';

/**
 * Parse a base64-encoded X509 public key
 */
export async function parsePublicKey(base64Key: string, rsaTransformationIdx: number): Promise<CryptoKey> {
  // Remove whitespace and decode base64
  const cleanKey = base64Key.replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(cleanKey), c => c.charCodeAt(0));
  const rsaTransformation = RSA_TRANSFORMATIONS[rsaTransformationIdx];

  return await crypto.subtle.importKey(
    'spki',
    binaryDer,
    rsaTransformation.algorithm,
    true,
    ['encrypt']
  );
}

/**
 * Generate a random AES key
 */
export async function generateAesKey(keyLength: number, algorithm: string, extractable: boolean = true): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: algorithm, length: keyLength },
    extractable,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a random IV
 */
export function generateIv(size: number): Uint8Array {
  const iv = new Uint8Array(size);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Convert Uint8Array to ArrayBuffer (for WebCrypto compatibility)
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Create a fresh ArrayBuffer to avoid SharedArrayBuffer issues
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function generateKeyFromPassword(password: string, salt?: Uint8Array<ArrayBuffer>) {
  const encoder = new TextEncoder();

  //"Import" the password string as a raw key material
  const passwordKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  if (salt === undefined) {
    salt = new Uint8Array(16);
    window.crypto.getRandomValues(salt);
  }

  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 600000,
      hash: "SHA-256"
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  return { aesKey, salt };
}

/**
 * Convert base64url to Uint8Array
 */
function base64UrlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(base64 + padding), c => c.charCodeAt(0));
}

/**
 * Convert Uint8Array to BigInteger byte array format (matching Java's BigInteger.toByteArray())
 * Java's BigInteger.toByteArray() returns a two's complement representation,
 * which includes a leading zero byte if the most significant bit is set (to indicate positive number)
 */
function toBigIntegerBytes(bytes: Uint8Array): Uint8Array {
  // If the high bit is set, we need to prepend a zero byte (like Java's BigInteger.toByteArray())
  if (bytes.length > 0 && (bytes[0] & 0x80) !== 0) {
    const result = new Uint8Array(bytes.length + 1);
    result[0] = 0;
    result.set(bytes, 1);
    return result;
  }
  return bytes;
}

/**
 * Calculate RSA public key fingerprint (SHA-256 of modulus + exponent)
 * Matches Java implementation: RSAUtils.getFingerprint()
 * Uses BigInteger byte array format (with sign byte handling)
 */
export async function getFingerprint(publicKey: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('jwk', publicKey);

  // Decode the modulus (n) and exponent (e) from base64url
  const modulusRaw = base64UrlToBytes(exported.n!);
  const exponentRaw = base64UrlToBytes(exported.e!);

  // Convert to Java BigInteger byte array format (add leading zero if high bit set)
  const modulus = toBigIntegerBytes(modulusRaw);
  const exponent = toBigIntegerBytes(exponentRaw);

  // Hash: sha256.update(modulus); sha256.digest(publicExp);
  const combined = new Uint8Array(modulus.length + exponent.length);
  combined.set(modulus, 0);
  combined.set(exponent, modulus.length);

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hashBuffer);
}

/**
 * Write unsigned short (2 bytes, big-endian)
 */
export function writeUnsignedShort(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Unsigned short overflow');
  const arr = new Uint8Array(2);
  arr[0] = (value >> 8) & 0xff;
  arr[1] = value & 0xff;
  return arr;
}

/**
 * Write byte array with length prefix (unsigned short)
 */
export function writeByteArray(data: Uint8Array): Uint8Array {
  const length = writeUnsignedShort(data.length);
  const result = new Uint8Array(2 + data.length);
  result.set(length, 0);
  result.set(data, 2);
  return result;
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Add PKCS7 padding
 */
export function addPkcs7Padding(data: Uint8Array, blockSize: number = 16): Uint8Array {
  const paddingLength = blockSize - (data.length % blockSize);
  const padded = new Uint8Array(data.length + paddingLength);
  padded.set(data, 0);
  for (let i = data.length; i < padded.length; i++) {
    padded[i] = paddingLength;
  }
  return padded;
}


/**
 * Remove PKCS7 padding
 */
export function removePkcs7Padding(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  const paddingLength = data[data.length - 1];
  if (paddingLength < 1 || paddingLength > 16 || paddingLength > data.length || !data.slice(-paddingLength).every(v => v === paddingLength)) {
    throw new Error('Invalid PKCS7 padding');
  }
  return data.slice(0, data.length - paddingLength);
}

/**
 * Read unsigned short (2 bytes, big-endian) from Uint8Array at offset
 */
export function readUnsignedShort(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) throw new Error('Truncated OMS field');
  return (data[offset] << 8) | data[offset + 1];
}

/**
 * Read byte array with length prefix (unsigned short) at offset
 * Returns [data, newOffset]
 */
export function readByteArray(data: Uint8Array, offset: number): [Uint8Array, number] {
  const length = readUnsignedShort(data, offset);
  if (offset + 2 + length > data.length) throw new Error('Truncated OMS field');
  const arr = data.slice(offset + 2, offset + 2 + length);
  return [arr, offset + 2 + length];
}

/**
 * Create the payload for EncryptedMessage
 * Format: (1) application ID (unsigned short) + (2) message as byte array
 */
function createPayload(applicationId: number, message: Uint8Array): Uint8Array {
  const appIdBytes = writeUnsignedShort(applicationId);
  const messageBytes = writeByteArray(message);
  return concatArrays(appIdBytes, messageBytes);
}

export async function aesEncryptData(aesTransformation: AesTransformation, ivBuffer: ArrayBuffer, aesKey: CryptoKey, dataBytes: Uint8Array): Promise<Uint8Array> {
  let encryptedData: Uint8Array;

  if (aesTransformation.algorithm === 'AES-GCM') {
    encryptedData = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        aesKey,
        toArrayBuffer(dataBytes)
      )
    );
  } else {
    // AES-CBC requires PKCS7 padding
    const paddedData = addPkcs7Padding(dataBytes, 16);
    encryptedData = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: ivBuffer },
        aesKey,
        toArrayBuffer(paddedData)
      )
    );
  }

  return encryptedData;
}

export async function aesDecryptData(aesAlgorithm: string, ivBuffer: ArrayBuffer, aesKey: CryptoKey, encryptedData: Uint8Array): Promise<Uint8Array> {
  let decryptedBytes: Uint8Array;

  if (aesAlgorithm === 'AES-GCM') {
    decryptedBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        aesKey,
        toArrayBuffer(encryptedData)
      )
    );
  } else {
    // AES-CBC: need to remove PKCS7 padding
    const decryptedWithPadding = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: ivBuffer },
        aesKey,
        toArrayBuffer(encryptedData)
      )
    );
    decryptedBytes = removePkcs7Padding(decryptedWithPadding);
  }

  return decryptedBytes;
}

/** Create a v1 RSA secret with encrypted application ID/version and authenticated records. */
export async function createEncryptedMessage(
  message: string | Uint8Array,
  settings: AppSettings,
  payloadApplicationId: number = APPLICATION_IDS.ENCRYPTED_MESSAGE
): Promise<string> {
  const publicKey = await parsePublicKey(settings.publicKey, 2);
  const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const result = await protocol.seal(publicKey, await getFingerprint(publicKey), payloadApplicationId, bytes);
  result.key.fill(0);
  return protocol.encodeText(result.bytes);
    }

/**
 * Write a string as a byte array with length prefix
 */
export function writeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return writeByteArray(bytes);
}

/**
 * Validate that the public key can be parsed
 */
export async function validatePublicKey(base64Key: string, rsaTransformationIdx: number): Promise<boolean> {
  try {
    await parsePublicKey(base64Key, rsaTransformationIdx);
    return true;
  } catch {
    return false;
  }
}

export function toFormattedHex(byteArray: Uint8Array) {
  // 1. Convert to raw hex string
  const rawHex = Array.from(byteArray, b => b.toString(16).padStart(2, '0')).join('');

  // 2. Insert space every 4 characters
  return rawHex.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Parse RSA x AES envelope from OMS-encoded data
 * Format matches EncryptedFile.java structure
 */
export function parseRsaAesEnvelope(binary: Uint8Array): RsaAesEnvelope {  
  if (protocol.hasMagic(binary)) {
    const { header, records } = protocol.readHeader(binary);
    if (header.kind !== 1) throw new Error('Not an RSA envelope');
    return { applicationId: APPLICATION_IDS.RSA_AES_GENERIC, rsaTransformation: RSA_TRANSFORMATIONS[2],
      fingerprint: header.fingerprint, aesTransformation: AES_TRANSFORMATIONS[2], iv: header.noncePrefix,
      encryptedAesKey: header.wrappedKey, encryptedData: records, protocolHeader: header };
  }
  let offset = 0;

  // (1) Application ID
  const applicationId = readUnsignedShort(binary, offset);
  offset += 2;

  // (2) RSA transformation index
  const rsaTransformation = RSA_TRANSFORMATIONS[readUnsignedShort(binary, offset)];
  offset += 2;

  // (3) Fingerprint
  const [fingerprint, offset3] = readByteArray(binary, offset);
  offset = offset3;

  // (4) AES transformation index
  const aesTransformation = AES_TRANSFORMATIONS[readUnsignedShort(binary, offset)];
  offset += 2;

  // (5) IV
  const [iv, offset5] = readByteArray(binary, offset);
  offset = offset5;

  // (6) RSA-encrypted AES key
  const [encryptedAesKey, offset6] = readByteArray(binary, offset);
  offset = offset6;

  // (7) AES-encrypted data (remaining bytes, no length prefix)
  const encryptedData = binary.slice(offset);

  return {
    applicationId,
    rsaTransformation,
    fingerprint,
    aesTransformation,
    iv,
    encryptedAesKey,
    encryptedData,
  };
}
export async function decryptEnvelope(envelope: RsaAesEnvelope, key: CryptoKey): Promise<Uint8Array> {
  if (envelope.protocolHeader) {
    return protocol.readApplication(await protocol.decryptRecords(envelope.protocolHeader, key, envelope.encryptedData), APPLICATION_IDS.ENCRYPTED_FILE).body;
  }
  if (envelope.aesTransformation.algorithm === 'AES-CBC') {
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: toArrayBuffer(envelope.iv) }, key, toArrayBuffer(envelope.encryptedData)));
    // Java/Android use one padding layer; historical PWA vaults use two.
    try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); return raw; }
    catch { return removePkcs7Padding(raw); }
  }
  return aesDecryptData(envelope.aesTransformation.algorithm, toArrayBuffer(envelope.iv), key, envelope.encryptedData);
}
export function isOmsText(text: string): boolean {
  if (text.startsWith(OMS_PREFIX)) return true;
  try { return protocol.decodeText(text) !== null; } catch { return text.trim().startsWith('JU9NUy0'); }
}
