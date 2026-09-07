import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { paymentsService } from './payments.service';

const getPaymentsSchema = z.object({
  // Optional: omitted by the dashboard's "All Wallets" view (see apps/web
  // src/app/page.tsx fetchPayments/fetchSummary), which previously 400'd here.
  walletId: z.string().optional(),
  limit: z.coerce.number().optional().default(20),
});

const getSummarySchema = z.object({
  walletId: z.string().optional(),
  fiat: z.string().optional(),
});

const getCrossLedgerSchema = z.object({
  walletId: z.string().optional(),
});

export class PaymentsController {
  async getPayments(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getPaymentsSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const payments = await paymentsService.getPayments(
      request.user.id,
      parsed.data.walletId,
      parsed.data.limit,
    );
    return reply.send({ success: true, payments });
  }

  async getPaymentsSummary(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getSummarySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const summary = await paymentsService.getPaymentsSummary(
      request.user.id,
      parsed.data.walletId,
      parsed.data.fiat,
    );
    return reply.send({ success: true, summary });
  }

  async getCrossLedgerAnalytics(request: FastifyRequest, reply: FastifyReply) {
    const parsed = getCrossLedgerSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query', details: parsed.error.format() });
    }
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const analytics = await paymentsService.getCrossLedgerAnalytics(
      request.user.id,
      parsed.data.walletId,
    );
    return reply.send({ success: true, analytics });
  }
}

export const paymentsController = new PaymentsController();
