/**
 * QR Utility - JavaScript translation of omscompanion/qr/QRUtil.java
 * 
 * Cuts a message into chunks and creates data for QR codes. Each chunk contains
 * (as readable text, separated by TAB):
 * - transaction ID, same for all QR codes in the sequence
 * - chunk number
 * - total number of chunks
 * - data length in this chunk (padding is added to the last code)
 * - data
 */

import { QrChunk } from "@/types/types";

const DEFAULT_CHUNK_SIZE = 200;

export function getQrSequence(message: string, chunkSize: number = DEFAULT_CHUNK_SIZE): QrChunk[] {
  const chunks = Math.ceil(message.length / chunkSize);
  const transactionId = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  const result: QrChunk[] = [];
  
  let charsToSend = message.length;

  for (let chunkNo = 0; chunkNo < chunks; chunkNo++) {
    // Copy with padding to keep all barcodes equal in size
    const start = chunkSize * chunkNo;
    const end = chunkSize * (chunkNo + 1);
    let chunkData = message.slice(start, end);
    
    // Pad the last chunk if necessary
    if (chunkData.length < chunkSize) {
      chunkData = chunkData.padEnd(chunkSize, '\0');
    }

    const dataLength = Math.min(chunkSize, charsToSend);
    const encoded = [
      transactionId,
      chunkNo.toString(),
      chunks.toString(),
      dataLength.toString(),
      chunkData
    ].join('\t');

    result.push({
      transactionId,
      chunkNo,
      totalChunks: chunks,
      dataLength,
      data: chunkData,
      encoded
    });

    charsToSend -= chunkSize;
  }

  return result;
}
