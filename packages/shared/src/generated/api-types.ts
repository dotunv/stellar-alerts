/**
 * AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
 *
 * Generated from the Fastify OpenAPI schema in apps/api/src/openapi.config.ts by
 * `npm run generate:types` (see scripts/generate-types.ts). Run that
 * command again after changing a Zod schema referenced by
 * `openApiComponentSchemas`, and commit the result.
 */
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        RequestLinkInput: {
            /** Format: email */
            email: string;
        };
        VerifyLinkInput: {
            token: string;
        };
        CreateWalletInput: {
            publicKey: string;
            label?: string;
            zkProof?: unknown;
            publicSignals?: string[];
        };
        CreateWebhookInput: {
            /** Format: uri */
            url: string;
            payloadTemplate?: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
