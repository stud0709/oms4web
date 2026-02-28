export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x2000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return btoa(binary);
}
