import { describe, it, expect, vi } from 'vitest';
import {
  createAwsKmsHmacClient,
  createGcpKmsHmacClient,
  createKmsWebhookSigner,
  createMockKmsHmacClient,
  createVaultTransitHmacClient,
  KmsHmacClient,
  KmsWebhookSigner,
} from '../kms-signer';

describe('KMS Webhook HMAC Signer (#189)', () => {
  const primaryKeyId = 'arn:aws:kms:us-east-1:123456789012:key/primary';
  const previousKeyId = 'arn:aws:kms:us-east-1:123456789012:key/previous';
  const message = '1700000000000.nonce-123.{"event":"payment.received"}';

  function buildSigner(client: KmsHmacClient, previousKeyIds: string[] = []): KmsWebhookSigner {
    return createKmsWebhookSigner({
      provider: 'aws',
      primaryKeyId,
      previousKeyIds,
      client,
    });
  }

  it('generates webhook HMAC signatures through the injected KMS client without exporting keys', async () => {
    const mockClient = createMockKmsHmacClient();
    const signSpy = vi.spyOn(mockClient, 'sign');
    const signer = buildSigner(mockClient);

    const signature = await signer.signHmacSha256(message);

    expect(signSpy).toHaveBeenCalledOnce();
    expect(signSpy.mock.calls[0][0].keyId).toBe(primaryKeyId);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies signatures produced by the primary KMS key', async () => {
    const mockClient = createMockKmsHmacClient();
    const signer = buildSigner(mockClient);
    const signature = await signer.signHmacSha256(message);

    await expect(signer.verifyHmacSha256(message, signature)).resolves.toBe(true);
  });

  it('supports seamless KMS key rotation by verifying against previous keys', async () => {
    const mockClient = createMockKmsHmacClient();
    const legacySigner = buildSigner(mockClient);
    const legacySignature = await legacySigner.signHmacSha256(message);

    const newPrimaryKeyId = 'arn:aws:kms:us-east-1:123456789012:key/next';
    const rotation = legacySigner.rotatePrimaryKey(newPrimaryKeyId);

    expect(rotation.primaryKeyId).toBe(newPrimaryKeyId);
    expect(rotation.previousKeyIds).toContain(primaryKeyId);

    await expect(legacySigner.verifyHmacSha256(message, legacySignature)).resolves.toBe(true);

    const nextSignature = await legacySigner.signHmacSha256(message);
    expect(nextSignature).not.toBe(legacySignature);
    await expect(legacySigner.verifyHmacSha256(message, nextSignature)).resolves.toBe(true);
  });

  it('rejects signatures that do not match any active rotated key', async () => {
    const mockClient = createMockKmsHmacClient();
    const signer = buildSigner(mockClient);
    const unrelatedSigner = createKmsWebhookSigner({
      provider: 'aws',
      primaryKeyId: 'arn:aws:kms:us-east-1:123456789012:key/unrelated',
      client: mockClient,
    });
    const unrelatedSignature = await unrelatedSigner.signHmacSha256(message);

    await expect(signer.verifyHmacSha256(message, unrelatedSignature)).resolves.toBe(false);
  });

  it('uses the AWS KMS client adapter without exposing raw key material', async () => {
    const awsClient = {
      send: vi.fn(async (command) => {
        if ('Signature' in command && command.Signature) {
          return { SignatureValid: command.Signature.length > 0 };
        }

        return {
          Signature: Buffer.from('aa'.repeat(32), 'hex'),
        };
      }),
    };

    const client = createAwsKmsHmacClient(awsClient);
    const signer = buildSigner(client);
    const signature = await signer.signHmacSha256(message);

    expect(awsClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        KeyId: primaryKeyId,
        MessageType: 'RAW',
        SigningAlgorithm: 'HMAC_SHA_256',
      })
    );
    await expect(signer.verifyHmacSha256(message, signature)).resolves.toBe(true);
  });

  it('uses the GCP Cloud KMS client adapter', async () => {
    const gcpClient = {
      sign: vi.fn(async () => ({ signature: Buffer.from('bb'.repeat(32), 'hex') })),
      verify: vi.fn(async () => ({ success: true })),
    };

    const client = createGcpKmsHmacClient(gcpClient);
    const signer = createKmsWebhookSigner({
      provider: 'gcp',
      primaryKeyId: 'projects/demo/locations/global/keyRings/webhooks/cryptoKeys/primary',
      client,
    });

    const signature = await signer.signHmacSha256(message);
    expect(gcpClient.sign).toHaveBeenCalledOnce();
    await expect(signer.verifyHmacSha256(message, signature)).resolves.toBe(true);
    expect(gcpClient.verify).toHaveBeenCalled();
  });

  it('uses the Vault transit client adapter', async () => {
    const vaultClient = {
      hmac: vi.fn(async () => ({ data: { hmac: `vault:v1:${'c'.repeat(64)}` } })),
      verify: vi.fn(async () => ({ data: { valid: true } })),
    };

    const client = createVaultTransitHmacClient(vaultClient);
    const signer = createKmsWebhookSigner({
      provider: 'vault',
      primaryKeyId: 'webhook-signing',
      client,
    });

    const signature = await signer.signHmacSha256(message);
    expect(vaultClient.hmac).toHaveBeenCalledOnce();
    expect(signature).toHaveLength(64);
    await expect(signer.verifyHmacSha256(message, signature)).resolves.toBe(true);
  });

  it('verifies legacy signatures signed with a previous key after rotation', async () => {
    const mockClient = createMockKmsHmacClient('rotation-seed');
    const signer = createKmsWebhookSigner({
      provider: 'aws',
      primaryKeyId,
      previousKeyIds: [previousKeyId],
      client: mockClient,
    });

    const previousKeySignature = await mockClient.sign({
      keyId: previousKeyId,
      message: Buffer.from(message, 'utf8'),
    });

    await expect(signer.verifyHmacSha256(message, previousKeySignature.toString('hex'))).resolves.toBe(true);
  });
});
