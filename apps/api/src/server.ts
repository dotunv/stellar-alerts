import { env } from './config/env';
import { buildApp } from './app';
import { prisma, connectWithRetry } from './lib/prisma';

const start = async () => {
  try {
    await connectWithRetry();
    const app = await buildApp();
    const port = parseInt(env.PORT, 10);

    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Server listening on http://localhost:${port}`);

    const shutdown = async () => {
      console.log('🛑 Graceful shutdown initiated...');
      setTimeout(() => {
        console.error('⚠️ Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 5000);

      await app.close();
      await prisma.$disconnect();
      console.log('✅ Server and Prisma closed cleanly');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
