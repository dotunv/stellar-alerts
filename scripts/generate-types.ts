import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import openapiTS, { astToString } from 'openapi-typescript';
import { openApiOptions } from '../apps/api/src/openapi.config';

/**
 * OpenAPI schema sync & type generator (issue #162).
 *
 * Builds the OpenAPI document straight from the same `@fastify/swagger`
 * options the live API registers (`openApiOptions` in
 * `apps/api/src/openapi.config.ts`) and runs it through `openapi-typescript`
 * to produce a typed TypeScript client for `@stellar-alerts/shared`.
 *
 * Deliberately does NOT boot the full `buildApp()` app (`apps/api/src/app.ts`):
 * that eagerly validates env vars and opens a Postgres connection (see
 * `apps/api/src/plugins/prisma.ts`), which would make a type-generation
 * script depend on a live database and a full `.env` in CI and on every
 * contributor's machine. Instead it spins up a bare Fastify instance with
 * only the swagger plugin registered, using `openapi.config.ts` — a leaf
 * module with no dependency on env/config or the route tree — which is
 * enough to compute the document since none of the current routes register
 * per-route request/response schemas (see docs/type-generation.md).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GENERATED_FILE = path.resolve(
  __dirname,
  '../packages/shared/src/generated/api-types.ts'
);

const GENERATED_OPENAPI_FILE = path.resolve(
  __dirname,
  '../openapi.json'
);

const HEADER = [
  '/**',
  ' * AUTO-GENERATED FILE. DO NOT EDIT BY HAND.',
  ' *',
  ' * Generated from the Fastify OpenAPI schema in apps/api/src/openapi.config.ts by',
  ' * `npm run generate:types` (see scripts/generate-types.ts). Run that',
  ' * command again after changing a Zod schema referenced by',
  ' * `openApiComponentSchemas`, and commit the result.',
  ' */',
  '',
].join('\n');

/** Builds the OpenAPI 3 document without booting the full app (see module docstring). */
export async function buildOpenApiDocument(): Promise<Record<string, unknown>> {
  const app = Fastify({ logger: false });
  try {
    await app.register(swagger, openApiOptions);
    await app.ready();
    const document = app.swagger();
    return document as unknown as Record<string, unknown>;
  } finally {
    await app.close();
  }
}

/** Converts an OpenAPI document into the TypeScript source we ship in `@stellar-alerts/shared`. */
export async function generateTypesSource(
  document: Record<string, unknown>
): Promise<string> {
  const ast = await openapiTS(document as any, { silent: true });
  const body = astToString(ast);
  return `${HEADER}${body}`;
}

async function readExisting(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Regenerates the OpenAPI document and TS types.
 * In `--check` mode, compares against the committed file and reports drift
 * without writing (exit code 1 on any difference) — this is what CI runs.
 * Otherwise, writes the regenerated file to disk.
 */
export async function run({
  check = false,
  targetFile = GENERATED_FILE,
  openapiFile = GENERATED_OPENAPI_FILE,
}: { check?: boolean; targetFile?: string; openapiFile?: string } = {}): Promise<boolean> {
  const document = await buildOpenApiDocument();
  const generated = await generateTypesSource(document);
  const openapiJson = JSON.stringify(document, null, 2) + '\n';

  let success = true;

  if (check) {
    const existingTypes = await readExisting(targetFile);
    const existingOpenApi = await readExisting(openapiFile);
    
    if (existingTypes === null || existingTypes !== generated) {
      console.error(
        `[generate-types] ${path.relative(process.cwd(), targetFile)} is out of date or does not exist. Run \`npm run generate:types\` and commit the result.`
      );
      success = false;
    }

    if (existingOpenApi === null || existingOpenApi !== openapiJson) {
      console.error(
        `[generate-types] ${path.relative(process.cwd(), openapiFile)} is out of date or does not exist. Run \`npm run generate:types\` and commit the result.`
      );
      success = false;
    }

    if (success) {
      console.log('[generate-types] Generated types and openapi.json are up to date.');
    }
    return success;
  }

  await fs.mkdir(path.dirname(targetFile), { recursive: true });
  await fs.writeFile(targetFile, generated, 'utf8');
  console.log(`[generate-types] Wrote ${path.relative(process.cwd(), targetFile)}`);

  await fs.mkdir(path.dirname(openapiFile), { recursive: true });
  await fs.writeFile(openapiFile, openapiJson, 'utf8');
  console.log(`[generate-types] Wrote ${path.relative(process.cwd(), openapiFile)}`);
  return true;
}

async function main() {
  const check = process.argv.includes('--check');
  const ok = await run({ check });
  if (!ok) process.exitCode = 1;
}

// ESM-safe "is this the entry point" check (works across POSIX and Windows
// paths, unlike comparing import.meta.url to a raw file:// string).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[generate-types] Failed:', err);
    process.exitCode = 1;
  });
}

