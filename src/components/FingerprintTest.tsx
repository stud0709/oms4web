import { useEffect, useState } from 'react';
import { parsePublicKey } from '@/lib/crypto';

const TEST_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkG6FpXZ0YdCHGXVp3kdbDCD1rQu3Grgm5PyX/3xKWCbMzQ9X15VOyHRBfwEfkQI/vle5uHozgLfnv6etYQ0tdtVejhgJ0ajwjz/0b5Q8WT0Bg92OrFbI7AjctqBJ8vIJ1RRxnmHYKH5zwcwDKzFcMj7nWniUz5rBoD+FAnnrV6ZZC2yDS7Bkc3IF42p5TAJpIlUD+e8WgCfIFfGAQNru/UaIvSTyS7Ll+uzL64OBHQK4bJITYf+4y5eaPC6czbOU/CwzpVNueV7s13dhiTIafOkiP7llMASQdzHo59bPhvCgMcHUjlMALovKf08ZCxoTnyF56+UD/7wdv+JkCKlD0QIDAQAB';

// Helper to convert bytes to hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper to convert base64url to bytes
function base64UrlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(base64 + padding), c => c.charCodeAt(0));
}

// Convert to BigInteger byte array format
function toBigIntegerBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0 && (bytes[0] & 0x80) !== 0) {
    const result = new Uint8Array(bytes.length + 1);
    result[0] = 0;
    result.set(bytes, 1);
    return result;
  }
  return bytes;
}

export default function FingerprintTest() {
  const [fingerprint, setFingerprint] = useState<string>('Calculating...');
  const [debug, setDebug] = useState<string>('');

  useEffect(() => {
    async function calculate() {
      try {
        const publicKey = await parsePublicKey(TEST_KEY, 0);
        const exported = await crypto.subtle.exportKey('jwk', publicKey);
        
        const modulusRaw = base64UrlToBytes(exported.n!);
        const exponentRaw = base64UrlToBytes(exported.e!);
        
        const modulus = toBigIntegerBytes(modulusRaw);
        const exponent = toBigIntegerBytes(exponentRaw);
        
        const combined = new Uint8Array(modulus.length + exponent.length);
        combined.set(modulus, 0);
        combined.set(exponent, modulus.length);
        
        const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
        const fp = new Uint8Array(hashBuffer);
        
        setDebug(`Modulus length: ${modulusRaw.length} -> ${modulus.length}, Exponent length: ${exponentRaw.length} -> ${exponent.length}, First modulus byte: 0x${modulusRaw[0].toString(16)}`);
        setFingerprint(bytesToHex(fp));
      } catch (e) {
        setFingerprint(`Error: ${e}`);
      }
    }
    calculate();
  }, []);

  return (
    <div className="fixed top-4 left-4 bg-background border p-4 rounded-lg shadow-lg z-50 max-w-md">
      <h3 className="font-bold mb-2">Fingerprint Test</h3>
      <p className="text-xs break-all font-mono">{fingerprint}</p>
      <p className="text-xs text-muted-foreground mt-2">{debug}</p>
    </div>
  );
}
