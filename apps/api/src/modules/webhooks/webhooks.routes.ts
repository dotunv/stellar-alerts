import { FastifyInstance } from 'fastify';
import { authenticateHook } from '../../middleware/auth.middleware';
import { webhooksController } from './webhooks.controller';

export async function webhooksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateHook);

  app.post('/webhooks', webhooksController.addWebhook.bind(webhooksController));
  app.get('/webhooks', webhooksController.getWebhooks.bind(webhooksController));
  app.delete('/webhooks/:id', webhooksController.deleteWebhook.bind(webhooksController));
  app.post('/webhooks/:id/test', webhooksController.testWebhook.bind(webhooksController));
}
