import { FastifyInstance } from 'fastify';
import { authenticateHook } from '../../middleware/auth.middleware';
import { paymentsController } from './payments.controller';

export async function paymentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateHook);

  app.get('/payments', paymentsController.getPayments.bind(paymentsController));
  app.get('/payments/summary', paymentsController.getPaymentsSummary.bind(paymentsController));
  app.get('/payments/analytics/cross-ledger', paymentsController.getCrossLedgerAnalytics.bind(paymentsController));
}
