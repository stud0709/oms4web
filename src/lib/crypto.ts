/**
 * OMS Companion compatible encryption implementation
 * Based on: https://github.com/stud0709/oms_companion
 */

// RSA Transformations - matching Java RsaTransformation enum
// Note: idx 0 (PKCS1Padding) not supported by WebCrypto, removed
export const RSA_TRANSFORMATIONS: Record<number, { idx: number; name: string; algorithm: { name: string; hash: string } }> = {
  1: { idx: 1, name: 'RSA/ECB/OAEPWithSHA-1AndMGF1Padding', algorithm: { name: 'RSA-OAEP', hash: 'SHA-1' } },
  2: { idx: 2, name: 'RSA/ECB/OAEPWithSHA-256AndMGF1Padding', algorithm: { name: 'RSA-OAEP', hash: 'SHA-256' } },
};

// AES Transformations - matching Java AesTransformation enum
export const AES_TRANSFORMATIONS = [
  { idx: 0, name: 'AES/CBC/PKCS5Padding', algorithm: 'AES-CBC' },
] as const;

// AES Key Lengths
export const AES_KEY_LENGTHS = [128, 192, 256] as const;

// Application IDs from MessageComposer
export const APPLICATION_IDS = {
  AES_ENCRYPTED_PRIVATE_KEY_TRANSFER: 0,
  ENCRYPTED_MESSAGE_DEPRECATED: 1,
  TOTP_URI_TRANSFER: 2,
  ENCRYPTED_FILE: 3,
  KEY_REQUEST: 4,
  KEY_RESPONSE: 5,
  RSA_AES_GENERIC: 6,
  BITCOIN_ADDRESS: 7,
  ENCRYPTED_MESSAGE: 8,
  TOTP_URI: 9,
  WIFI_PAIRING: 10,
  KEY_REQUEST_PAIRING: 11,
} as const;

export const OMS_PREFIX = 'oms00_';

export interface EncryptionSettings {
  rsaTransformationIdx: number;
  aesKeyLength: number;
  aesTransformationIdx: number;
}

export const DEFAULT_ENCRYPTION_SETTINGS: EncryptionSettings = {
  rsaTransformationIdx: 2,
  aesKeyLength: 256,
  aesTransformationIdx: 0,
};

/**
 * Parse a base64-encoded X509 public key
 */
export async function parsePublicKey(base64Key: string, rsaTransformationIdx: number): Promise<CryptoKey> {
  // Remove whitespace and decode base64
  const cleanKey = base64Key.replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(cleanKey), c => c.charCodeAt(0));
  
  // Fall back to default (idx 2) if invalid index
  const rsaTransformation = RSA_TRANSFORMATIONS[rsaTransformationIdx] ?? RSA_TRANSFORMATIONS[2];
  
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
async function generateAesKey(keyLength: number): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    { name: 'AES-CBC', length: keyLength },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a random IV (16 bytes for AES-CBC)
 */
function generateIv(): Uint8Array {
  const iv = new Uint8Array(16);
  crypto.getRandomValues(iv);
  return iv;
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
async function getFingerprint(publicKey: CryptoKey): Promise<Uint8Array> {
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
 * Create the payload for EncryptedMessage
 * Format: (1) application ID (unsigned short) + (2) message as byte array
 */
function createPayload(applicationId: number, message: Uint8Array): Uint8Array {
  const appIdBytes = writeUnsignedShort(applicationId);
  const messageBytes = writeByteArray(message);
  return concatArrays(appIdBytes, messageBytes);
}

/**
 * Create an RSA x AES envelope (encrypted message)
 * 
 * Format:
 * (1) Application ID (unsigned short)
 * (2) RSA transformation index (unsigned short)
 * (3) Fingerprint (byte array with length prefix)
 * (4) AES transformation index (unsigned short)
 * (5) IV (byte array with length prefix)
 * (6) RSA-encrypted AES secret key (byte array with length prefix)
 * (7) AES-encrypted message (byte array with length prefix)
 */
export async function createEncryptedMessage(
  message: string,
  publicKeyBase64: string,
  settings: EncryptionSettings
): Promise<string> {
  const { rsaTransformationIdx, aesKeyLength, aesTransformationIdx } = settings;
  
  // Parse the public key
  const publicKey = await parsePublicKey(publicKeyBase64, rsaTransformationIdx);
  
  // Generate AES key and IV
  const aesKey = await generateAesKey(aesKeyLength);
  const iv = generateIv();
  
  // Get the raw AES key bytes
  const aesKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
  
  // Encrypt the AES key with RSA (fall back to idx 2 if invalid)
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
  
  // Create the inner payload: APPLICATION_ENCRYPTED_MESSAGE + message bytes
  const messageBytes = new TextEncoder().encode(message);
  const payload = createPayload(APPLICATION_IDS.ENCRYPTED_MESSAGE, messageBytes);
  
  // Encrypt the payload with AES-CBC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const encryptedPayload = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv } as AesCbcParams,
      aesKey,
      payload as unknown as BufferSource
    )
  );
  
  // Build the final message
  // Use APPLICATION_RSA_AES_GENERIC as the outer envelope (like in Java implementation)
  const finalMessage = concatArrays(
    writeUnsignedShort(APPLICATION_IDS.RSA_AES_GENERIC), // (1) Application ID
    writeUnsignedShort(rsaTransformationIdx),             // (2) RSA transformation index
    writeByteArray(fingerprint),                          // (3) Fingerprint
    writeUnsignedShort(aesTransformationIdx),             // (4) AES transformation index
    writeByteArray(iv),                                   // (5) IV
    writeByteArray(encryptedAesKey),                      // (6) RSA-encrypted AES key
    writeByteArray(encryptedPayload)                      // (7) AES-encrypted message
  );
  
  // Encode as OMS text format
  return OMS_PREFIX + btoa(String.fromCharCode(...finalMessage));
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
