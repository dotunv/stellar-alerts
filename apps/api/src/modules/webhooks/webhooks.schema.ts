import { z } from 'zod';

export const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  payloadTemplate: z.string().max(16384).optional(),
});

export const webhookParamsSchema = z.object({
  id: z.string().min(1),
});
