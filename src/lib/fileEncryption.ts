import { parsePublicKey, getFingerprint } from './crypto';
import { seal } from './protocol';
import { AppSettings } from '@/types/types';
/** Side-effect-free encryption: exporting a vault never replaces its quick-unlock key. */
export async function encryptVaultDataWithKey(dataBytes: Uint8Array, settings: AppSettings) {
  const publicKey = await parsePublicKey(settings.publicKey, 2);
  return seal(publicKey, await getFingerprint(publicKey), 3, dataBytes);
}
export async function encryptVaultData(dataBytes: Uint8Array, settings: AppSettings): Promise<Uint8Array> {
  const result = await encryptVaultDataWithKey(dataBytes, settings);
  try { return result.bytes; } finally { result.key.fill(0); }
}
