import crypto from 'crypto';

const SEPARATOR = ':';

export interface EncryptedSecretParts {
  version: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class CryptoVault {
  private currentKey: Buffer;
  private currentVersion: string;
  private keys: Map<string, Buffer>;

  constructor(
    currentKey: string,
    currentVersion: string = '1',
    oldKeys: Record<string, string> = {}
  ) {
    this.currentVersion = currentVersion;
    this.currentKey = this.deriveKey(currentKey);
    this.keys = new Map([[currentVersion, this.currentKey]]);

    for (const [version, key] of Object.entries(oldKeys)) {
      this.keys.set(version, this.deriveKey(key));
    }
  }

  private deriveKey(key: string): Buffer {
    // Ensure consistent 32-byte key for AES-256-GCM
    return crypto.createHash('sha256').update(key).digest();
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.currentKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      this.currentVersion,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(SEPARATOR);
  }

  decrypt(encrypted: string): string {
    const parts = encrypted.split(SEPARATOR);
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted secret format');
    }

    const [version, iv, authTag, ciphertext] = parts;
    const key = this.keys.get(version);

    if (!key) {
      throw new Error(`Unknown encryption key version: ${version}`);
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}

const oldKeys = process.env.MASTER_ENCRYPTION_OLD_KEYS
  ? JSON.parse(process.env.MASTER_ENCRYPTION_OLD_KEYS)
  : {};

export const cryptoVault = new CryptoVault(
  process.env.MASTER_ENCRYPTION_KEY!,
  process.env.MASTER_ENCRYPTION_KEY_VERSION ?? '1',
  oldKeys
);
