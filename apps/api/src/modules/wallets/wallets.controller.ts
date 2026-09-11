import { FastifyRequest, FastifyReply } from 'fastify';
import { createWalletSchema, deleteWalletSchema } from './wallets.schema';
import { walletsService } from './wallets.service';

export class WalletsController {
  async addWallet(request: FastifyRequest, reply: FastifyReply) {
    const parsed = createWalletSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid payload', details: parsed.error.format() });
    }

    const userId = (request as any).user.id;
    try {
      const wallet = await walletsService.addWallet(
        userId,
        parsed.data.publicKey,
        parsed.data.label,
        parsed.data.zkProof,
        parsed.data.publicSignals
      );
      return reply.status(201).send({ success: true, wallet });
    } catch (error: any) {
      if (error.message === 'Invalid ZK proof') {
        return reply.status(400).send({ error: 'Invalid ZK proof' });
      }
      throw error;
    }
  }

  async getWallets(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).user.id;
    const wallets = await walletsService.getWallets(userId);
    return reply.send({ success: true, wallets });
  }

  async deleteWallet(request: FastifyRequest, reply: FastifyReply) {
    const parsed = deleteWalletSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid parameters', details: parsed.error.format() });
    }

    try {
      await walletsService.removeWallet(parsed.data.id);
      return reply.send({ success: true });
    } catch (error: any) {
      if (error.message === 'Wallet not found') {
        return reply.status(404).send({ error: 'Not Found', message: error.message });
      }
      throw error;
    }
  }
}

export const walletsController = new WalletsController();
