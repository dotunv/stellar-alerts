import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { createReadReplicaRouter, ReadReplicaRouter } from '../lib/prisma-read-replica';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
    readReplicaRouter: ReadReplicaRouter;
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

  // Initialize read replica router
  const readReplicaRouter = createReadReplicaRouter();
  try {
    await readReplicaRouter.connect();
    server.log.info('🔌 Read replica router initialized');
  } catch (error) {
    server.log.warn({ err: error }, '⚠️ Read replica initialization failed, using primary for all queries');
  }

  server.decorate('prisma', prisma);
  server.decorate('readReplicaRouter', readReplicaRouter);

  server.addHook('onClose', async () => {
    await readReplicaRouter.disconnect();
    await prisma.$disconnect();
    server.log.info('🔌 Database connections closed.');
  });
});
