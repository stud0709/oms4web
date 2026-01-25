/**
 * File Encryption - TypeScript implementation based on 
 * omscompanion/crypto/EncryptedFile.java
 * 
 * Encrypts data using RSA x AES envelope with APPLICATION_ENCRYPTED_FILE
 */

import {
  RSA_TRANSFORMATIONS,
  AES_TRANSFORMATIONS,
  APPLICATION_IDS,
  OMS_PREFIX,
  EncryptionSettings,
  parsePublicKey,
  toFormattedHex,
  concatArrays,
  getFingerprint,
  writeUnsignedShort,
  writeByteArray,
  addPkcs7Padding,
  toArrayBuffer,
  generateIv,
  generateAesKey,
} from './crypto';

/**
 * Create an encrypted file envelope for vault data
 * Based on EncryptedFile.java - uses APPLICATION_ENCRYPTED_FILE
 * 
 * Format:
 * (1) Application ID (unsigned short) = APPLICATION_ENCRYPTED_FILE
 * (2) RSA transformation index (unsigned short)
 * (3) Fingerprint (byte array with length prefix)
 * (4) AES transformation index (unsigned short)
 * (5) IV (byte array with length prefix)
 * (6) RSA-encrypted AES secret key (byte array with length prefix)
 * (7) AES-encrypted file data (byte array with length prefix)
 */
export async function encryptVaultData(
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
  
  // Build the final message with APPLICATION_ENCRYPTED_FILE
  const finalMessage = concatArrays(
    writeUnsignedShort(APPLICATION_IDS.ENCRYPTED_FILE),   // (1) Application ID
    writeUnsignedShort(rsaTransformationIdx),             // (2) RSA transformation index
    writeByteArray(fingerprint),                          // (3) Fingerprint
    writeUnsignedShort(aesTransformationIdx),             // (4) AES transformation index
    writeByteArray(iv),                                   // (5) IV
    writeByteArray(encryptedAesKey),                      // (6) RSA-encrypted AES key
    writeByteArray(encryptedData)                         // (7) AES-encrypted data
  );

  return finalMessage;
}

/**
 * Check if data is encrypted (starts with oms00_ prefix)
 */
export function isEncryptedData(data: string): boolean {
  return data.startsWith(OMS_PREFIX);
}
