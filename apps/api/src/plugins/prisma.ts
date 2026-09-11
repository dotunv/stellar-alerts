import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { prisma, prismaRead } from '../lib/prisma';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

export default fp(async (server: FastifyInstance) => {
  try {
    await prisma.$connect();
    // Test authentication and database connection eagerly
    await prisma.$queryRaw`SELECT 1`;
    if (prismaRead !== prisma) {
      await prismaRead.$connect();
      await prismaRead.$queryRaw`SELECT 1`;
      server.log.info('🔌 Read replica connection verified successfully.');
    }

    server.log.info('🔌 Database connection and authentication verified successfully.');
  } catch (error) {
    server.log.error({ err: error }, '❌ Failed to connect or authenticate against the database server during initialization');
    throw error;
  }

  server.decorate('prisma', prisma);

  server.addHook('onClose', async () => {
    await prisma.$disconnect();
    if (prismaRead !== prisma) {
      await prismaRead.$disconnect();
    }
    server.log.info('🔌 Database connection closed.');
  });
});
