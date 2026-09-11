# OpenAPI schema sync & type generator

`scripts/generate-types.ts` generates a typed TypeScript client for the API's
Zod request schemas and ships it as part of `@stellar-alerts/shared`
(`packages/shared/src/generated/api-types.ts`), so `apps/web` stops manually
re-declaring or reaching across the workspace boundary to import types
straight out of `apps/api/src` (see `apps/web/src/types/api.ts` before this
change).

## Running locally

```bash
npm run generate:types         # regenerate packages/shared/src/generated/api-types.ts
npm run generate:types:check   # fail if the committed file is out of date (what CI runs)
```

Run `generate:types` and commit the result whenever you change a Zod schema
referenced by `openApiComponentSchemas` in `apps/api/src/app.ts` (currently
`requestLinkSchema`, `verifyLinkSchema`, `createWalletSchema`,
`createWebhookSchema`). `generate:types:check` runs as the "Verify generated
OpenAPI types are up to date" step in `.github/workflows/ci.yml` and fails
the build if someone changes a schema without regenerating the committed
types — a "generate, diff, fail on drift" pattern, applied here to type
generation.

## Why it doesn't boot the real API

`buildApp()` in `apps/api/src/app.ts` eagerly validates required env vars
(`apps/api/src/config/env.ts`) and opens a Postgres connection on startup
(`apps/api/src/plugins/prisma.ts`), and registers the full route tree. A
type-generation script that depended on that would be slow, flaky in CI, and
would need a full `.env` and a live database just to read a schema
definition.

Instead, `apps/api/src/openapi.config.ts` is a small leaf module — it only
imports the Zod request schemas and exports `openApiOptions`, the exact
`@fastify/swagger` registration options `buildApp()` uses (`app.ts` re-
exports both for convenience). `generate-types.ts` imports straight from
`openapi.config.ts`, registers only `@fastify/swagger` with those options on
a bare Fastify instance, calls `app.swagger()` to get the OpenAPI document,
and closes it. No env validation, database, Redis, or route handlers are
ever touched.

## Scope: component schemas, not routes

None of the current routes (`apps/api/src/modules/**/*.routes.ts`) attach a
per-route `schema` option to their Fastify route definitions, so the
generated OpenAPI document only has `components.schemas` populated — there's
no `paths` object to generate operation types from yet. `paths` is still
re-exported from `@stellar-alerts/shared` (as `ApiPaths`) for forward
compatibility, but it will be an empty type until routes register request/
response schemas.

Wiring `schema: { body: ... }` onto routes would also turn on Fastify's
runtime request validation for the first time on those routes — a real
behavior change, and outside the scope of this DevX/type-generation issue.
That's a good follow-up once someone deliberately signs up to review the
validation-behavior implications per route.

## Consuming the generated types

```ts
import type { ApiComponents } from '@stellar-alerts/shared';

type CreateWalletInput = ApiComponents['schemas']['CreateWalletInput'];
```
