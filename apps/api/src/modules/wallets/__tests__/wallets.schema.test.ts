import { describe, it, expect } from 'vitest';
import * as StellarSdk from 'stellar-sdk';
import { createWalletSchema, deleteWalletSchema } from '../wallets.schema';

describe('createWalletSchema (StrKey Ed25519 public key validation)', () => {
  const validPublicKey = StellarSdk.Keypair.random().publicKey();

  it('accepts a valid Ed25519 public key', () => {
    const result = createWalletSchema.safeParse({ publicKey: validPublicKey });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.publicKey).toBe(validPublicKey);
    }
  });

  it('accepts a valid Ed25519 public key with an optional label', () => {
    const result = createWalletSchema.safeParse({ publicKey: validPublicKey, label: 'Savings' });

    expect(result.success).toBe(true);
  });

  it('rejects a public key with a corrupted checksum', () => {
    // Flip the final character so the base32 payload is unchanged in length
    // but the CRC16-XMODEM checksum no longer matches.
    const lastChar = validPublicKey.at(-1);
    const replacement = lastChar === 'A' ? 'B' : 'A';
    const corrupted = validPublicKey.slice(0, -1) + replacement;

    // Sanity check: StrKey itself must agree this is now invalid, otherwise
    // the flipped character happened to preserve the checksum by chance.
    expect(StellarSdk.StrKey.isValidEd25519PublicKey(corrupted)).toBe(false);

    const result = createWalletSchema.safeParse({ publicKey: corrupted });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Invalid Stellar public key format or checksum');
    }
  });

  it('rejects a malformed key (wrong version byte / contract address)', () => {
    // Contract addresses use the 'C' StrKey version byte, not a valid
    // Ed25519 account public key.
    const contractLike = 'C' + validPublicKey.slice(1);
    const result = createWalletSchema.safeParse({ publicKey: contractLike });

    expect(result.success).toBe(false);
  });

  it('rejects a string that is not StrKey-encoded at all', () => {
    const result = createWalletSchema.safeParse({ publicKey: 'not-a-stellar-key' });

    expect(result.success).toBe(false);
  });

  it('rejects an empty public key', () => {
    const result = createWalletSchema.safeParse({ publicKey: '' });

    expect(result.success).toBe(false);
  });

  it('rejects a missing publicKey field', () => {
    const result = createWalletSchema.safeParse({ label: 'No key provided' });

    expect(result.success).toBe(false);
  });
});

describe('deleteWalletSchema', () => {
  it('accepts a well-formed id', () => {
    const result = deleteWalletSchema.safeParse({ id: 'wallet_cuid_123' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing id', () => {
    const result = deleteWalletSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
