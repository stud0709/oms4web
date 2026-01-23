/**
 * File Encryption - TypeScript implementation based on 
 * omscompanion/crypto/EncryptedFile.java
 * 
 * Encrypts data using RSA x AES envelope with APPLICATION_ENCRYPTED_FILE
 * 
 * IMPORTANT DIFFERENCE FROM MESSAGES:
 * - For EncryptedFile, the encrypted payload is written WITHOUT a length prefix
 *   (streamed directly after the header)
 * - For EncryptedMessage, the encrypted payload HAS a length prefix
 * 
 * This matches the Java implementation where files are streamed using
 * AESUtil.process() directly to the output stream.
 */

import {
  RSA_TRANSFORMATIONS,
  AES_TRANSFORMATIONS,
  APPLICATION_IDS,
  OMS_PREFIX,
  EncryptionSettings,
  parsePublicKey,
} from './crypto';

/**
 * Generate a random AES key
 */
async function generateAesKey(keyLength: number, algorithm: string): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: algorithm, length: keyLength },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a random IV
 * NOTE: Java's AESUtil.generateIv() always uses 16 bytes
 */
function generateIv(size: number): Uint8Array {
  const iv = new Uint8Array(size);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Convert Uint8Array to ArrayBuffer (for WebCrypto compatibility)
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
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
 * Convert Uint8Array to BigInteger byte array format
 */
function toBigIntegerBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0 && (bytes[0] & 0x80) !== 0) {
    const result = new Uint8Array(bytes.length + 1);
    result[0] = 0;
    result.set(bytes, 1);
    return result;
  }
  return bytes;
}

/**
 * Calculate RSA public key fingerprint
 */
async function getFingerprint(publicKey: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('jwk', publicKey);
  const modulusRaw = base64UrlToBytes(exported.n!);
  const exponentRaw = base64UrlToBytes(exported.e!);
  const modulus = toBigIntegerBytes(modulusRaw);
  const exponent = toBigIntegerBytes(exponentRaw);
  
  const combined = new Uint8Array(modulus.length + exponent.length);
  combined.set(modulus, 0);
  combined.set(exponent, modulus.length);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hashBuffer);
}

/**
 * Write unsigned short (2 bytes, big-endian)
 */
function writeUnsignedShort(value: number): Uint8Array {
  const arr = new Uint8Array(2);
  arr[0] = (value >> 8) & 0xff;
  arr[1] = value & 0xff;
  return arr;
}

/**
 * Write byte array with length prefix (unsigned short)
 */
function writeByteArray(data: Uint8Array): Uint8Array {
  const length = writeUnsignedShort(data.length);
  const result = new Uint8Array(2 + data.length);
  result.set(length, 0);
  result.set(data, 2);
  return result;
}

/**
 * Concatenate multiple Uint8Arrays
 */
function concatArrays(...arrays: Uint8Array[]): Uint8Array {
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
function addPkcs7Padding(data: Uint8Array, blockSize: number = 16): Uint8Array {
  const paddingLength = blockSize - (data.length % blockSize);
  const padded = new Uint8Array(data.length + paddingLength);
  padded.set(data, 0);
  for (let i = data.length; i < padded.length; i++) {
    padded[i] = paddingLength;
  }
  return padded;
}

/**
 * Create an encrypted file envelope for vault data
 * Based on EncryptedFile.java - uses APPLICATION_ENCRYPTED_FILE
 * 
 * Format (matching Java EncryptedFile):
 * (1) Application ID (unsigned short) = APPLICATION_ENCRYPTED_FILE
 * (2) RSA transformation index (unsigned short)
 * (3) Fingerprint (byte array with length prefix)
 * (4) AES transformation index (unsigned short)
 * (5) IV (byte array with length prefix)
 * (6) RSA-encrypted AES secret key (byte array with length prefix)
 * (7) AES-encrypted file data (NO length prefix - streamed directly!)
 * 
 * IMPORTANT: Unlike EncryptedMessage, the encrypted data is NOT prefixed with length
 */
export async function encryptVaultData(
  data: string,
  publicKeyBase64: string,
  settings: EncryptionSettings
): Promise<string> {
  const { rsaTransformationIdx, aesKeyLength, aesTransformationIdx } = settings;
  
  // Get AES transformation details
  const aesTransformation = AES_TRANSFORMATIONS[aesTransformationIdx] ?? AES_TRANSFORMATIONS[0];
  
  // Parse the public key
  const publicKey = await parsePublicKey(publicKeyBase64, rsaTransformationIdx);
  
  // Generate AES key and IV
  // NOTE: Java's AESUtil.generateIv() always uses 16 bytes, but the transformation
  // specifies the expected size. We use transformation's ivSize for compatibility.
  const aesKey = await generateAesKey(aesKeyLength, aesTransformation.algorithm);
  const iv = generateIv(aesTransformation.ivSize);
  
  // Get the raw AES key bytes
  const aesKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
  
  // Encrypt the AES key with RSA
  const rsaAlgorithm = (RSA_TRANSFORMATIONS[rsaTransformationIdx] ?? RSA_TRANSFORMATIONS[2]).algorithm;
  const encryptedAesKey = new Uint8Array(
    await crypto.subtle.encrypt(
      rsaAlgorithm,
      publicKey,
      aesKeyRaw
    )
  );
  
  // Get fingerprint
  const fingerprint = await getFingerprint(publicKey);
  
  // Convert data to bytes
  const dataBytes = new TextEncoder().encode(data);
  
  // Encrypt based on algorithm
  const ivBuffer = toArrayBuffer(iv);
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
  
  // Build the final message with APPLICATION_ENCRYPTED_FILE
  // NOTE: encryptedData is written WITHOUT length prefix (raw bytes, like Java streaming)
  const finalMessage = concatArrays(
    writeUnsignedShort(APPLICATION_IDS.ENCRYPTED_FILE),  // (1) Application ID
    writeUnsignedShort(rsaTransformationIdx),             // (2) RSA transformation index
    writeByteArray(fingerprint),                          // (3) Fingerprint
    writeUnsignedShort(aesTransformationIdx),             // (4) AES transformation index
    writeByteArray(iv),                                   // (5) IV
    writeByteArray(encryptedAesKey),                      // (6) RSA-encrypted AES key
    encryptedData                                         // (7) AES-encrypted data (NO length prefix!)
  );
  
  // Encode as OMS text format
  return OMS_PREFIX + btoa(String.fromCharCode(...finalMessage));
}

/**
 * Check if data is encrypted (starts with oms00_ prefix)
 */
export function isEncryptedData(data: string): boolean {
  return data.startsWith(OMS_PREFIX);
}

/**
 * Create raw binary encrypted file data (for .oms00 file export)
 * Returns raw bytes instead of base64 OMS text format
 */
export async function encryptVaultDataBinary(
  data: string,
  publicKeyBase64: string,
  settings: EncryptionSettings
): Promise<Uint8Array> {
  const { rsaTransformationIdx, aesKeyLength, aesTransformationIdx } = settings;
  
  // Get AES transformation details
  const aesTransformation = AES_TRANSFORMATIONS[aesTransformationIdx] ?? AES_TRANSFORMATIONS[0];
  
  // Parse the public key
  const publicKey = await parsePublicKey(publicKeyBase64, rsaTransformationIdx);
  
  // Generate AES key and IV
  const aesKey = await generateAesKey(aesKeyLength, aesTransformation.algorithm);
  const iv = generateIv(aesTransformation.ivSize);
  
  // Get the raw AES key bytes
  const aesKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
  
  // Encrypt the AES key with RSA
  const rsaAlgorithm = (RSA_TRANSFORMATIONS[rsaTransformationIdx] ?? RSA_TRANSFORMATIONS[2]).algorithm;
  const encryptedAesKey = new Uint8Array(
    await crypto.subtle.encrypt(
      rsaAlgorithm,
      publicKey,
      aesKeyRaw
    )
  );
  
  // Get fingerprint
  const fingerprint = await getFingerprint(publicKey);
  
  // Convert data to bytes
  const dataBytes = new TextEncoder().encode(data);
  
  // Encrypt based on algorithm
  const ivBuffer = toArrayBuffer(iv);
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
  
  // Build the binary file content (no OMS prefix, raw bytes for file)
  return concatArrays(
    writeUnsignedShort(APPLICATION_IDS.ENCRYPTED_FILE),  // (1) Application ID
    writeUnsignedShort(rsaTransformationIdx),             // (2) RSA transformation index
    writeByteArray(fingerprint),                          // (3) Fingerprint
    writeUnsignedShort(aesTransformationIdx),             // (4) AES transformation index
    writeByteArray(iv),                                   // (5) IV
    writeByteArray(encryptedAesKey),                      // (6) RSA-encrypted AES key
    encryptedData                                         // (7) AES-encrypted data (NO length prefix!)
  );
}
