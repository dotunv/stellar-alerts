import * as snarkjs from 'snarkjs';
import * as crypto from 'crypto';

// A mock verification key for tests
export const mockVerificationKey = {
  protocol: "groth16",
  curve: "bn128",
  nPublic: 1,
  vk_alpha_1: ["1", "2", "3"],
  vk_beta_2: [["1", "2"], ["3", "4"], ["5", "6"]],
  vk_gamma_2: [["1", "2"], ["3", "4"], ["5", "6"]],
  vk_delta_2: [["1", "2"], ["3", "4"], ["5", "6"]],
  vk_alphabeta_12: [[["1", "2"], ["3", "4"]], [["5", "6"], ["7", "8"]]],
  IC: [["1", "2", "3"], ["4", "5", "6"]]
};

export async function verifyZkProof(
  proof: any,
  publicSignals: any[],
  vKey: any = mockVerificationKey
): Promise<boolean> {
  try {
    if (!proof || !publicSignals || publicSignals.length === 0) {
      return false;
    }
    const res = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    return res;
  } catch (error) {
    return false;
  }
}

export function generateSecretHash(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}
