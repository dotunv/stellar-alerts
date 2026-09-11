import { prisma, prismaRead } from '../../lib/prisma';

export class WalletsService {
  async addWallet(userId: string, publicKey: string, label?: string, zkProof?: any, publicSignals?: string[]) {
    console.log(`[WalletsService] Adding wallet ${publicKey} for user ${userId}`);

    let targetUserId = userId;

    if (zkProof && publicSignals) {
      const isValid = await verifyZkProof(zkProof, publicSignals);
      if (!isValid) {
        throw new Error('Invalid ZK proof');
      }

      // Valid ZK proof allows alert subscription without storing plaintext user email linkage
      const secretHash = publicSignals[0];
      const anonymousEmail = `${secretHash}@zkp.local`;

      let anonUser = await prisma.user.findUnique({ where: { email: anonymousEmail } });
      if (!anonUser) {
        anonUser = await prisma.user.create({
          data: { email: anonymousEmail }
        });
      }
      targetUserId = anonUser.id;
    }

    const wallet = await prisma.wallet.create({
      data: {
        userId: targetUserId,
        publicKey,
        label,
      },
    });
    return wallet;
  }

  async getWallets(userId: string) {
    return prismaRead.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async removeWallet(id: string) {
    console.log(`[WalletsService] Removing wallet ${id}`);
    try {
      await prisma.wallet.delete({
        where: { id },
      });
      return { success: true };
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new Error('Wallet not found');
      }
      throw error;
    }
  }
}

export const walletsService = new WalletsService();
