import { z } from 'zod';
import { requestLinkSchema, verifyLinkSchema } from './modules/auth/auth.schema';
import { createWalletSchema } from './modules/wallets/wallets.schema';
import { createWebhookSchema } from './modules/webhooks/webhooks.schema';

/**
 * The `@fastify/swagger` registration options shared by `buildApp()`
 * (`app.ts`) and `scripts/generate-types.ts`.
 *
 * This module is deliberately kept free of anything that reaches into
 * `./config/env` or the route modules: it only imports the Zod request
 * schemas themselves. That lets the type generator build the OpenAPI
 * document (and derive `@stellar-alerts/shared`'s generated types from it)
 * without loading env validation, Postgres, or Redis — see
 * docs/type-generation.md for the full rationale.
 */

export const openApiComponentSchemas = {
  RequestLinkInput: z.toJSONSchema(requestLinkSchema),
  VerifyLinkInput: z.toJSONSchema(verifyLinkSchema),
  CreateWalletInput: z.toJSONSchema(createWalletSchema),
  CreateWebhookInput: z.toJSONSchema(createWebhookSchema),
};

export const openApiOptions = {
  openapi: {
    info: {
      title: 'Stellar Alerts API',
      description:
        'Interactive API documentation for the Stellar Payment Tracker. Register wallets, monitor payments and manage webhook alert endpoints.',
      version: '1.0.0',
    },
    tags: [
      { name: 'auth', description: 'Magic-link authentication' },
      { name: 'wallets', description: 'Watched Stellar wallet management' },
      { name: 'payments', description: 'Incoming payment history and summaries' },
      { name: 'webhooks', description: 'Custom webhook alert endpoint management' },
    ],
    components: {
      schemas: openApiComponentSchemas as Record<string, any>,
    },
  },
};
