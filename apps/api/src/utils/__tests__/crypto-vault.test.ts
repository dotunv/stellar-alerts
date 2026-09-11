import { CryptoVault } from '../crypto-vault';

describe('CryptoVault', () => {
  const key = 'test-master-key-32-characters-minimum';
  const vault = new CryptoVault(key, '1');

  it('should encrypt and decrypt a secret', () => {
    const original = 'mySecret123';
    const encrypted = vault.encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(vault.decrypt(encrypted)).toBe(original);
  });

  it('should produce unique ciphertext for the same plaintext (random IV)', () => {
    const original = 'secret';
    const first = vault.encrypt(original);
    const second = vault.encrypt(original);
    expect(first).not.toBe(second);
  });

  it('should reject tampered ciphertext', () => {
    const encrypted = vault.encrypt('secret');
    const parts = encrypted.split(':');
    // Corrupt the ciphertext portion (base64 for "tampered")
    parts[3] = 'dGFwcW9udQ=';
    const tampered = parts.join(':');
    expect(() => vault.decrypt(tampered)).toThrow();
  });

  it('should decrypt data encrypted with an older key version (rotation)', () => {
    const oldVault = new CryptoVault('old-master-key-32-characters-minimum', '1');
    const newVault = new CryptoVault('new-master-key-32-characters-minimum', '2', {
      '1': 'old-master-key-32-characters-minimum',
    });

    const oldEncrypted = oldVault.encrypt('legacy-secret');
    expect(newVault.decrypt(oldEncrypted)).toBe('legacy-secret');
  });

  it('should throw on unknown key version', () => {
    const vaultWithNoCldKeys = new CryptoVault('new-key', '2');
    const oldEncrypted = new CryptoVault('old-key', '1').encrypt('data');
    expect(() => vaultWithNoOldKeys.decrypt(oldEncrypted)).toThrow('Unknown encryption key version: 1');
  });
});
