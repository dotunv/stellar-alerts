import { z } from 'zod';
import * as StellarSdk from 'stellar-sdk';

export const createWalletSchema = z.object({
  publicKey: z.string().refine((val) => StellarSdk.StrKey.isValidEd25519PublicKey(val), {
    message: 'Invalid Stellar public key format or checksum',
  }),
  label: z.string().optional(),
  zkProof: z.any().optional(),
  publicSignals: z.array(z.string()).optional(),
});

export const deleteWalletSchema = z.object({
  id: z.string(),
});
