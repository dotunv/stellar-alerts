import { describe, it, expect, vi } from 'vitest';
import { verifyZkProof, generateSecretHash, mockVerificationKey } from '../zkp-verifier';
import * as crypto from 'crypto';
import * as snarkjs from 'snarkjs';

vi.mock('snarkjs', () => ({
  groth16: {
    verify: vi.fn(),
  },
}));

describe('ZKP Verifier', () => {
  it('should return false if proof or publicSignals are missing', async () => {
    const result = await verifyZkProof(null, []);
    expect(result).toBe(false);
  });

  it('should verify valid proof correctly', async () => {
    vi.mocked(snarkjs.groth16.verify).mockResolvedValueOnce(true);
    const result = await verifyZkProof({ pi_a: [] }, ['hash']);
    expect(result).toBe(true);
    expect(snarkjs.groth16.verify).toHaveBeenCalledWith(mockVerificationKey, ['hash'], { pi_a: [] });
  });

  it('should return false for invalid proof', async () => {
    vi.mocked(snarkjs.groth16.verify).mockResolvedValueOnce(false);
    const result = await verifyZkProof({ pi_a: [] }, ['invalid_hash']);
    expect(result).toBe(false);
  });

  it('should generate valid secret hash', () => {
    const secret = 'user@example.com';
    const hash = generateSecretHash(secret);
    
    const expectedHash = crypto.createHash('sha256').update(secret).digest('hex');
    expect(hash).toBe(expectedHash);
  });
});
