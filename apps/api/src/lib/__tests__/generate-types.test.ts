import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildOpenApiDocument,
  generateTypesSource,
  run,
} from '../../../../../scripts/generate-types';

describe('OpenAPI schema sync & type generator (issue #162)', () => {
  const tmpFiles: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tmpFiles.splice(0).map((file) => fs.rm(file, { force: true }))
    );
  });

  async function tmpTargetFile() {
    const file = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'generate-types-test-')),
      'api-types.ts'
    );
    tmpFiles.push(file);
    return file;
  }

  it('builds an OpenAPI document exposing the Zod request schemas as components', async () => {
    const document = await buildOpenApiDocument();

    expect(document.openapi).toMatch(/^3\./);
    const schemas = (document as any).components.schemas;
    expect(Object.keys(schemas).sort()).toEqual([
      'CreateWalletInput',
      'CreateWebhookInput',
      'RequestLinkInput',
      'VerifyLinkInput',
    ]);
  });

  it('generates TypeScript output covering every registered component schema', async () => {
    const document = await buildOpenApiDocument();
    const source = await generateTypesSource(document);

    expect(source).toContain('AUTO-GENERATED FILE');
    expect(source).toContain('export interface components');
    for (const schema of [
      'RequestLinkInput',
      'VerifyLinkInput',
      'CreateWalletInput',
      'CreateWebhookInput',
    ]) {
      expect(source).toContain(schema);
    }
  });

  it('run({ check: true }) fails when the target file does not exist', async () => {
    const targetFile = await tmpTargetFile();

    const ok = await run({ check: true, targetFile });

    expect(ok).toBe(false);
    await expect(fs.access(targetFile)).rejects.toThrow();
  });

  it('run() writes the generated types, and a subsequent check passes', async () => {
    const targetFile = await tmpTargetFile();

    const writeOk = await run({ targetFile });
    expect(writeOk).toBe(true);

    const written = await fs.readFile(targetFile, 'utf8');
    expect(written).toContain('RequestLinkInput');

    const checkOk = await run({ check: true, targetFile });
    expect(checkOk).toBe(true);
  });

  it('run({ check: true }) fails when the committed file has drifted from the schema', async () => {
    const targetFile = await tmpTargetFile();
    await fs.writeFile(targetFile, '// stale, hand-edited content\n', 'utf8');

    const ok = await run({ check: true, targetFile });

    expect(ok).toBe(false);
    const stillStale = await fs.readFile(targetFile, 'utf8');
    expect(stillStale).toBe('// stale, hand-edited content\n');
  });
});
