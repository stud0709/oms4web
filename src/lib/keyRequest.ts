/**
 * Key Request - TypeScript implementation based on 
 * omscompanion/crypto/KeyRequest.java
 * 
 * Creates a KEY_REQUEST message to request decryption of an AES key from the
 * encrypted file envelope. Uses a temporary RSA key pair to protect the AES key
 * during transport.
 */

import {
  RSA_TRANSFORMATIONS,
  AES_TRANSFORMATIONS,
  APPLICATION_IDS,
  OMS_PREFIX,
} from './crypto';

/**
 * Read unsigned short (2 bytes, big-endian) from Uint8Array at offset
 */
function readUnsignedShort(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

/**
 * Read byte array with length prefix (unsigned short) at offset
 * Returns [data, newOffset]
 */
function readByteArray(data: Uint8Array, offset: number): [Uint8Array, number] {
  const length = readUnsignedShort(data, offset);
  const arr = data.slice(offset + 2, offset + 2 + length);
  return [arr, offset + 2 + length];
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
 * Write a string as a byte array with length prefix
 */
function writeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return writeByteArray(bytes);
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
 * Convert Uint8Array to ArrayBuffer (for WebCrypto compatibility)
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * Remove PKCS7 padding
 */
function removePkcs7Padding(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  const paddingLength = data[data.length - 1];
  if (paddingLength > 16 || paddingLength > data.length) {
    throw new Error('Invalid PKCS7 padding');
  }
  return data.slice(0, data.length - paddingLength);
}

/**
 * Parsed RSA x AES envelope from encrypted data
 */
export interface RsaAesEnvelope {
  applicationId: number;
  rsaTransformationIdx: number;
  fingerprint: Uint8Array;
  aesTransformationIdx: number;
  iv: Uint8Array;
  encryptedAesKey: Uint8Array;
  encryptedData: Uint8Array;
}

/**
 * Parse RSA x AES envelope from OMS-encoded data
 * Format matches EncryptedFile.java structure
 */
export function parseRsaAesEnvelope(omsData: string): RsaAesEnvelope {
  if (!omsData.startsWith(OMS_PREFIX)) {
    throw new Error('Invalid OMS data format');
  }

  const base64Data = omsData.slice(OMS_PREFIX.length);
  const binary = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

  let offset = 0;

  // (1) Application ID
  const applicationId = readUnsignedShort(binary, offset);
  offset += 2;

  // (2) RSA transformation index
  const rsaTransformationIdx = readUnsignedShort(binary, offset);
  offset += 2;

  // (3) Fingerprint
  const [fingerprint, offset3] = readByteArray(binary, offset);
  offset = offset3;

  // (4) AES transformation index
  const aesTransformationIdx = readUnsignedShort(binary, offset);
  offset += 2;

  // (5) IV
  const [iv, offset5] = readByteArray(binary, offset);
  offset = offset5;

  // (6) RSA-encrypted AES key
  const [encryptedAesKey, offset6] = readByteArray(binary, offset);
  offset = offset6;

  // (7) AES-encrypted data
  const [encryptedData] = readByteArray(binary, offset);

  return {
    applicationId,
    rsaTransformationIdx,
    fingerprint,
    aesTransformationIdx,
    iv,
    encryptedAesKey,
    encryptedData,
  };
}

/**
 * Key Request context - holds the temporary RSA key pair and envelope data
 */
export interface KeyRequestContext {
  keyPair: CryptoKeyPair;
  envelope: RsaAesEnvelope;
  message: string; // OMS-encoded message for QR display
}

/**
 * Create a KEY_REQUEST message from encrypted vault data
 * 
 * Format (matching Java KeyRequest):
 * (1) Application ID = APPLICATION_KEY_REQUEST
 * (2) Reference (file name as string)
 * (3) RSA public key (SPKI encoded)
 * (4) Fingerprint of the requested RSA key (from file header)
 * (5) RSA transformation index for decryption
 * (6) Encrypted AES key from the file header
 */
export async function createKeyRequest(encryptedData: string): Promise<KeyRequestContext> {
  // Parse the encrypted envelope
  const envelope = parseRsaAesEnvelope(encryptedData);

  // Generate temporary RSA key pair for secure key transport
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  // Export the public key in SPKI format
  const publicKeySpki = new Uint8Array(
    await crypto.subtle.exportKey('spki', keyPair.publicKey)
  );

  // Build the KEY_REQUEST message
  const messageBytes = concatArrays(
    writeUnsignedShort(APPLICATION_IDS.KEY_REQUEST),    // (1) Application ID
    writeString('vault.json'),                           // (2) Reference (file name)
    writeByteArray(publicKeySpki),                       // (3) RSA public key
    writeByteArray(envelope.fingerprint),                // (4) Fingerprint from envelope
    writeUnsignedShort(envelope.rsaTransformationIdx),   // (5) RSA transformation index
    writeByteArray(envelope.encryptedAesKey),            // (6) Encrypted AES key
  );

  // Encode as OMS text format
  const message = OMS_PREFIX + btoa(String.fromCharCode(...messageBytes));

  return {
    keyPair,
    envelope,
    message,
  };
}

/**
 * Process KEY_RESPONSE and decrypt the vault data
 * 
 * KEY_RESPONSE format:
 * (1) Application ID = APPLICATION_KEY_RESPONSE
 * (2) RSA transformation index
 * (3) RSA-encrypted AES key (encrypted with our temporary public key)
 */
export async function processKeyResponse(
  keyResponse: string,
  context: KeyRequestContext
): Promise<string> {
  // Decode the response
  let responseBytes: Uint8Array;
  
  if (keyResponse.startsWith(OMS_PREFIX)) {
    const base64Data = keyResponse.slice(OMS_PREFIX.length);
    responseBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  } else {
    // Try base64 directly
    responseBytes = Uint8Array.from(atob(keyResponse), c => c.charCodeAt(0));
  }

  let offset = 0;

  // (1) Application ID
  const applicationId = readUnsignedShort(responseBytes, offset);
  offset += 2;

  if (applicationId !== APPLICATION_IDS.KEY_RESPONSE) {
    throw new Error(`Invalid application ID: expected ${APPLICATION_IDS.KEY_RESPONSE}, got ${applicationId}`);
  }

  // (2) RSA transformation index
  const rsaTransformationIdx = readUnsignedShort(responseBytes, offset);
  offset += 2;

  // (3) RSA-encrypted AES key
  const [rsaEncryptedAesKey] = readByteArray(responseBytes, offset);

  // Decrypt the AES key using our temporary private key
  const rsaTransformation = RSA_TRANSFORMATIONS[rsaTransformationIdx] ?? RSA_TRANSFORMATIONS[2];
  const aesKeyBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      rsaTransformation.algorithm,
      context.keyPair.privateKey,
      toArrayBuffer(rsaEncryptedAesKey)
    )
  );

  // Import the AES key
  const aesTransformation = AES_TRANSFORMATIONS[context.envelope.aesTransformationIdx] ?? AES_TRANSFORMATIONS[0];
  const aesKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(aesKeyBytes),
    { name: aesTransformation.algorithm },
    false,
    ['decrypt']
  );

  // Decrypt the vault data
  const ivBuffer = toArrayBuffer(context.envelope.iv);
  let decryptedBytes: Uint8Array;

  if (aesTransformation.algorithm === 'AES-GCM') {
    decryptedBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBuffer },
        aesKey,
        toArrayBuffer(context.envelope.encryptedData)
      )
    );
  } else {
    // AES-CBC: need to remove PKCS7 padding
    const decryptedWithPadding = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: ivBuffer },
        aesKey,
        toArrayBuffer(context.envelope.encryptedData)
      )
    );
    decryptedBytes = removePkcs7Padding(decryptedWithPadding);
  }

  // Convert to string
  return new TextDecoder().decode(decryptedBytes);
}
