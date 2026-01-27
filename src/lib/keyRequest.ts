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
  writeUnsignedShort,
  writeByteArray, 
  toArrayBuffer, 
  concatArrays,
  readByteArray,
  readUnsignedShort,
  RsaAesEnvelope,
  parseRsaAesEnvelope,
  aesDecryptData,
  writeString,
} from './crypto';


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
  const decryptedBytes = await aesDecryptData(aesTransformation,ivBuffer,aesKey,context.envelope.encryptedData);

  // Convert to string
  return new TextDecoder().decode(decryptedBytes);
}
