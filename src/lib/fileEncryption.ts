/**
 * File Encryption - TypeScript implementation based on 
 * omscompanion/crypto/EncryptedFile.java
 * 
 * Encrypts data using RSA x AES envelope with APPLICATION_ENCRYPTED_FILE
 */

import {
  parsePublicKey,
  toFormattedHex,
  concatArrays,
  getFingerprint,
  writeUnsignedShort,
  writeByteArray,
  toArrayBuffer,
  generateIv,
  generateAesKey,
  aesEncryptData,
} from './crypto';
import { RSA_TRANSFORMATIONS } from "./constants";
import { EncryptionSettings } from "@/types/types";
import { AES_TRANSFORMATIONS } from "./constants";
import { APPLICATION_IDS } from "./constants";

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
  const aesTransformation = AES_TRANSFORMATIONS[aesTransformationIdx];

  // Parse the public key
  const publicKey = await parsePublicKey(publicKeyBase64, rsaTransformationIdx);

  // Generate AES key and IV
  const aesKey = await generateAesKey(aesKeyLength, aesTransformation.algorithm);
  const iv = generateIv(aesTransformation.ivSize);

  // Get the raw AES key bytes
  const aesKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));

  // Encrypt the AES key with RSA
  const rsaTransformation = RSA_TRANSFORMATIONS[rsaTransformationIdx];
  const encryptedAesKey = new Uint8Array(
    await crypto.subtle.encrypt(
      rsaTransformation.algorithm,
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
  const encryptedData = await aesEncryptData(aesTransformation, ivBuffer, aesKey, dataBytes);

  // Build the final message with APPLICATION_ENCRYPTED_FILE
  const finalMessage = concatArrays(
    writeUnsignedShort(APPLICATION_IDS.ENCRYPTED_FILE),   // (1) Application ID
    writeUnsignedShort(rsaTransformationIdx),             // (2) RSA transformation index
    writeByteArray(fingerprint),                          // (3) Fingerprint
    writeUnsignedShort(aesTransformationIdx),             // (4) AES transformation index
    writeByteArray(iv),                                   // (5) IV
    writeByteArray(encryptedAesKey),                      // (6) RSA-encrypted AES key
    encryptedData                                         // (7) AES-encrypted data (no length prefix)
  );

  console.log("Created Encrypted File:");
  console.log(`Application-ID: ${APPLICATION_IDS.ENCRYPTED_FILE}`);
  console.log(`RSA transformation: ${rsaTransformation.idx} = ${rsaTransformation.algorithm.name}`);
  console.log(`fingerprint: ${toFormattedHex(fingerprint)}`);
  console.log(`AES transformation: ${aesTransformation.idx} = ${aesTransformation.algorithm}`);
  console.log(`IV: ${toFormattedHex(iv)}`);
  console.log(`encrypted AES secret key: ${toFormattedHex(encryptedAesKey)}`);

  return finalMessage;
}
