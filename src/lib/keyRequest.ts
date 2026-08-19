/**
 * Key Request - TypeScript implementation based on 
 * omscompanion/crypto/KeyRequest.java & KeyRequestPairing.java
 * 
 * Creates KEY_REQUEST (for air-gap & Android callback) or KEY_REQUEST_PAIRING (for Nostr pairing).
 */

import {
  writeUnsignedShort,
  writeByteArray,
  toArrayBuffer,
  concatArrays,
  readByteArray,
  readUnsignedShort,
  parseRsaAesEnvelope,
  aesDecryptData,
  writeString,
  toFormattedHex,
} from './crypto';
import { bytesToBase64 } from './base64';
import {
  DEFAULT_SETTINGS,
  RSA_TRANSFORMATIONS,
  OMS_PREFIX,
  APPLICATION_IDS,
} from "./constants";
import { KeyRequestContext, VaultData } from "@/types/types";
import { setQuickUnlock as setupQuickUnlock, validateJson } from '@/hooks/useEncryptedVault';

/**
 * Create a KEY_REQUEST message from encrypted vault data (for Air-Gap QR or Android Intent)
 * 
 * Format (matching Java KeyRequest.java):
 * (1) Application ID = APPLICATION_KEY_REQUEST (4)
 * (2) Reference (file name as string)
 * (3) RSA public key (SPKI encoded)
 * (4) Fingerprint of the requested RSA key (from file header)
 * (5) RSA transformation index for decryption
 * (6) RSA transformation index for the KeyResponse compatible with this system
 * (7) Encrypted AES key from the file header
 */
export async function createKeyRequest(
  fileName: string,
  encryptedData: Uint8Array,
  applicationID: number = APPLICATION_IDS.KEY_REQUEST
): Promise<KeyRequestContext> {
  // Parse the encrypted envelope
  const envelope = parseRsaAesEnvelope(encryptedData);

  // Generate temporary RSA key pair for secure key transport
  const rsaTransformationKeyResponse = RSA_TRANSFORMATIONS[DEFAULT_SETTINGS.rsaTransformationIdx];
  const keyPair = await crypto.subtle.generateKey(
    {
      name: rsaTransformationKeyResponse.algorithm.name,
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
      hash: rsaTransformationKeyResponse.algorithm.hash,
    },
    false,
    ['encrypt', 'decrypt']
  );

  // Export the public key in SPKI format
  const publicKeySpki = new Uint8Array(
    await crypto.subtle.exportKey('spki', keyPair.publicKey)
  );

  // Build the KEY_REQUEST message
  const messageBytes = concatArrays(
    writeUnsignedShort(applicationID),                   // (1) Application ID
    writeString(fileName),                                // (2) Reference (file name)
    writeByteArray(publicKeySpki),                        // (3) RSA public key
    writeByteArray(envelope.fingerprint),                 // (4) Fingerprint from envelope
    writeUnsignedShort(envelope.rsaTransformation.idx),    // (5) RSA transformation index
    writeUnsignedShort(rsaTransformationKeyResponse.idx), // (6) RSA transformation index for KeyResponse
    writeByteArray(envelope.encryptedAesKey),             // (7) Encrypted AES key
  );

  console.log("Created Key Request:");
  console.log(`Application-ID: ${applicationID}`);
  console.log(`Reference: ${fileName}`);
  console.log(`RSA public key: ${toFormattedHex(publicKeySpki)}`);
  console.log(`fingerprint (encrypted file): ${toFormattedHex(envelope.fingerprint)}`);
  console.log(`RSA transformation (encrypted file): ${envelope.rsaTransformation.idx} = ${envelope.rsaTransformation.algorithm.name}`);
  console.log(`RSA transformation (key response): ${rsaTransformationKeyResponse.idx} = ${rsaTransformationKeyResponse.algorithm.name}`);
  console.log(`encrypted AES key (encrypted file): ${toFormattedHex(envelope.encryptedAesKey)}`);

  // Encode as OMS text format
  const message = OMS_PREFIX + bytesToBase64(messageBytes);

  return {
    keyPair,
    envelope,
    message,
  };
}

/**
 * Create a KEY_REQUEST_PAIRING message from encrypted vault data (for Nostr pairing)
 * Matching Java KeyRequestPairing.java:
 * (1) Application ID = APPLICATION_KEY_REQUEST_PAIRING (11)
 * (2) Reference (string)
 * (3) Fingerprint of the requested RSA key (byte array)
 * (4) RSA transformation index for decryption (unsigned short)
 * (5) Encrypted AES key from the file header (byte array)
 */
export function createKeyRequestPairing(
  fileName: string,
  encryptedData: Uint8Array
): { envelope: ReturnType<typeof parseRsaAesEnvelope>; messageBytes: Uint8Array; base64Payload: string } {
  const envelope = parseRsaAesEnvelope(encryptedData);

  const messageBytes = concatArrays(
    writeUnsignedShort(APPLICATION_IDS.KEY_REQUEST_PAIRING), // (1) Application ID 11
    writeString(fileName),                                   // (2) Reference
    writeByteArray(envelope.fingerprint),                    // (3) Fingerprint
    writeUnsignedShort(envelope.rsaTransformation.idx),       // (4) RSA transformation index
    writeByteArray(envelope.encryptedAesKey),                // (5) Encrypted AES key
  );

  const base64Payload = bytesToBase64(messageBytes);

  console.log("Created Key Request Pairing:");
  console.log(`Application-ID: ${APPLICATION_IDS.KEY_REQUEST_PAIRING}`);
  console.log(`Reference: ${fileName}`);
  console.log(`fingerprint: ${toFormattedHex(envelope.fingerprint)}`);
  console.log(`RSA transformation: ${envelope.rsaTransformation.idx} = ${envelope.rsaTransformation.algorithm.name}`);
  console.log(`encrypted AES key: ${toFormattedHex(envelope.encryptedAesKey)}`);

  return {
    envelope,
    messageBytes,
    base64Payload,
  };
}

/**
 * Process KEY_RESPONSE (or raw AES key from paired response) and decrypt vault data
 */
export async function processKeyResponse(
  keyResponse: string | Uint8Array,
  context: KeyRequestContext
): Promise<VaultData> {
  let responseBytes: Uint8Array;
  if (typeof keyResponse === 'string') {
    const cleanResponse = keyResponse.startsWith(OMS_PREFIX)
      ? keyResponse.slice(OMS_PREFIX.length)
      : keyResponse;
    responseBytes = Uint8Array.from(
      atob(cleanResponse.replace(/\s+/g, '')),
      c => c.charCodeAt(0)
    );
  } else {
    responseBytes = keyResponse;
  }

  let aesKeyBytes: Uint8Array;

  // Case 1: Application ID 5 (KEY_RESPONSE with RSA-encrypted AES key)
  if (responseBytes.length > 2 && readUnsignedShort(responseBytes, 0) === APPLICATION_IDS.KEY_RESPONSE && context.keyPair) {
    const offset = 2;
    const [rsaEncryptedAesKey] = readByteArray(responseBytes, offset);
    console.log(`Decrypting RSA-encrypted AES key (App ID 5)`);
    const rsaTransformationKeyResponse = RSA_TRANSFORMATIONS[DEFAULT_SETTINGS.rsaTransformationIdx];
    aesKeyBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        rsaTransformationKeyResponse.algorithm,
        context.keyPair.privateKey,
        toArrayBuffer(rsaEncryptedAesKey)
      )
    );
  }
  // Case 2: Length-prefixed AES key bytes (OmsDataOutputStream.writeByteArray) from KeyRequestPairing
  else if (
    responseBytes.length >= 4 &&
    [16, 24, 32].includes(readUnsignedShort(responseBytes, 0)) &&
    readUnsignedShort(responseBytes, 0) <= responseBytes.length - 2
  ) {
    console.log(`Reading length-prefixed AES key material (${readUnsignedShort(responseBytes, 0)} bytes)`);
    const [rawKey] = readByteArray(responseBytes, 0);
    aesKeyBytes = rawKey;
  }
  // Case 3: Raw AES key bytes directly (16, 24, or 32 bytes)
  else if ([16, 24, 32].includes(responseBytes.length)) {
    console.log(`Using raw AES key bytes (${responseBytes.length} bytes)`);
    aesKeyBytes = responseBytes;
  }
  // Case 4: Try RSA decryption if keyPair exists
  else if (context.keyPair) {
    try {
      console.log(`Attempting RSA decryption of key material`);
      const rsaTransformationKeyResponse = RSA_TRANSFORMATIONS[DEFAULT_SETTINGS.rsaTransformationIdx];
      aesKeyBytes = new Uint8Array(
        await crypto.subtle.decrypt(
          rsaTransformationKeyResponse.algorithm,
          context.keyPair.privateKey,
          toArrayBuffer(responseBytes)
        )
      );
    } catch {
      console.log(`Fallback: reading as byte array`);
      const [rawKey] = readByteArray(responseBytes, 0);
      aesKeyBytes = rawKey;
    }
  } else {
    const [rawKey] = readByteArray(responseBytes, 0);
    aesKeyBytes = rawKey;
  }

  if (!aesKeyBytes) {
    throw new Error('Failed to extract AES key from response');
  }

  console.log(`Extracted AES key: ${toFormattedHex(aesKeyBytes)}`);

  // Import the AES key
  const aesTransformation = context.envelope.aesTransformation;
  console.log(`Setting up AES key for ${aesTransformation.algorithm}`);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(aesKeyBytes),
    { name: aesTransformation.algorithm },
    false,
    ['decrypt']
  );

  // Decrypt file contents
  const ivBuffer = toArrayBuffer(context.envelope.iv);
  console.log(`Decrypting file contents`);
  const decryptedBytes = await aesDecryptData(aesTransformation.algorithm, ivBuffer, aesKey, context.envelope.encryptedData);

  // Convert to string and validate JSON
  const s = new TextDecoder().decode(decryptedBytes);
  const vaultData = validateJson(JSON.parse(s));

  // Setup QuickUnlock
  setupQuickUnlock(
    aesKeyBytes, 
    vaultData.settings.workspaceProtection
  );

  return vaultData;
}
