import crypto from 'crypto';

/**
 * Hardware-backed HMAC signing middleware for webhook payloads.
 * Delegates HMAC-SHA256 operations to cloud KMS/HSM providers so raw signing
 * keys never reside in application memory.
 */

export type KmsProvider = 'aws' | 'gcp' | 'vault';

export const KMS_HMAC_ALGORITHM = 'HMAC_SHA_256' as const;
export type KmsHmacAlgorithm = typeof KMS_HMAC_ALGORITHM;

export interface KmsSignRequest {
  keyId: string;
  message: Buffer;
  algorithm?: KmsHmacAlgorithm;
}

export interface KmsVerifyRequest {
  keyId: string;
  message: Buffer;
  signature: Buffer;
  algorithm?: KmsHmacAlgorithm;
}

/** Provider-agnostic KMS HMAC client — inject AWS/GCP/Vault implementations or mocks. */
export interface KmsHmacClient {
  sign(request: KmsSignRequest): Promise<Buffer>;
  verify(request: KmsVerifyRequest): Promise<boolean>;
}

export interface KmsSignerConfig {
  provider: KmsProvider;
  primaryKeyId: string;
  previousKeyIds?: string[];
  client: KmsHmacClient;
}

export interface KmsRotationState {
  primaryKeyId: string;
  previousKeyIds: string[];
  rotatedAt: string;
}

/** AWS KMS Sign/Verify command shapes (compatible with @aws-sdk/client-kms). */
export interface AwsKmsSendable {
  KeyId?: string;
  Message?: Buffer | Uint8Array;
  MessageType?: 'RAW' | 'DIGEST';
  SigningAlgorithm?: KmsHmacAlgorithm;
  Signature?: Buffer | Uint8Array;
}

export interface AwsKmsClientLike {
  send(command: AwsKmsSendable): Promise<{ Signature?: Uint8Array; SignatureValid?: boolean }>;
}

/** GCP Cloud KMS asymmetric/sign request shapes. */
export interface GcpKmsClientLike {
  sign(params: {
    name: string;
    data: Buffer;
    dataCrc32c?: string;
  }): Promise<{ signature?: Buffer | Uint8Array }>;
  verify(params: {
    name: string;
    data: Buffer;
    signature: Buffer;
  }): Promise<{ success?: boolean }>;
}

/** HashiCorp Vault transit engine shapes. */
export interface VaultTransitClientLike {
  hmac(keyName: string, input: string): Promise<{ data?: { hmac?: string } }>;
  verify(keyName: string, input: string, hmac: string): Promise<{ data?: { valid?: boolean } }>;
}

export class KmsWebhookSigner {
  private readonly config: KmsSignerConfig;

  constructor(config: KmsSignerConfig) {
    if (!config.primaryKeyId) {
      throw new Error('KMS primary key id is required');
    }
    this.config = {
      ...config,
      previousKeyIds: config.previousKeyIds ?? [],
    };
  }

  get provider(): KmsProvider {
    return this.config.provider;
  }

  get primaryKeyId(): string {
    return this.config.primaryKeyId;
  }

  get previousKeyIds(): readonly string[] {
    return this.config.previousKeyIds ?? [];
  }

  /** Signs a message with the primary KMS key — the raw key never enters process memory. */
  async signHmacSha256(message: string): Promise<string> {
    const signature = await this.config.client.sign({
      keyId: this.config.primaryKeyId,
      message: Buffer.from(message, 'utf8'),
      algorithm: KMS_HMAC_ALGORITHM,
    });
    return signature.toString('hex');
  }

  /**
   * Verifies an HMAC signature against the primary key, then any rotated previous keys.
   * Enables seamless key rotation without rejecting in-flight webhook deliveries.
   */
  async verifyHmacSha256(message: string, signatureHex: string): Promise<boolean> {
    const messageBuffer = Buffer.from(message, 'utf8');
    const signatureBuffer = Buffer.from(signatureHex, 'hex');

    if (signatureBuffer.length === 0) {
      return false;
    }

    for (const keyId of this.activeKeyIds()) {
      const valid = await this.config.client.verify({
        keyId,
        message: messageBuffer,
        signature: signatureBuffer,
        algorithm: KMS_HMAC_ALGORITHM,
      });
      if (valid) {
        return true;
      }
    }

    return false;
  }

  /** Promotes a new primary key while retaining the outgoing key for verification. */
  rotatePrimaryKey(newPrimaryKeyId: string, maxRetainedPreviousKeys = 5): KmsRotationState {
    if (!newPrimaryKeyId) {
      throw new Error('New primary KMS key id is required');
    }

    const previousKeyIds = [
      this.config.primaryKeyId,
      ...(this.config.previousKeyIds ?? []),
    ]
      .filter((keyId, index, all) => keyId !== newPrimaryKeyId && all.indexOf(keyId) === index)
      .slice(0, maxRetainedPreviousKeys);

    this.config.primaryKeyId = newPrimaryKeyId;
    this.config.previousKeyIds = previousKeyIds;

    return {
      primaryKeyId: this.config.primaryKeyId,
      previousKeyIds: [...previousKeyIds],
      rotatedAt: new Date().toISOString(),
    };
  }

  activeKeyIds(): string[] {
    return [this.config.primaryKeyId, ...(this.config.previousKeyIds ?? [])];
  }
}

export function createAwsKmsHmacClient(client: AwsKmsClientLike): KmsHmacClient {
  return {
    async sign({ keyId, message, algorithm = KMS_HMAC_ALGORITHM }) {
      const result = await client.send({
        KeyId: keyId,
        Message: message,
        MessageType: 'RAW',
        SigningAlgorithm: algorithm,
      });

      if (!result.Signature) {
        throw new Error('AWS KMS Sign returned no signature');
      }

      return Buffer.from(result.Signature);
    },
    async verify({ keyId, message, signature, algorithm = KMS_HMAC_ALGORITHM }) {
      const result = await client.send({
        KeyId: keyId,
        Message: message,
        MessageType: 'RAW',
        SigningAlgorithm: algorithm,
        Signature: signature,
      });

      return result.SignatureValid === true;
    },
  };
}

export function createGcpKmsHmacClient(client: GcpKmsClientLike): KmsHmacClient {
  return {
    async sign({ keyId, message }) {
      const result = await client.sign({
        name: keyId,
        data: message,
      });

      if (!result.signature) {
        throw new Error('GCP Cloud KMS sign returned no signature');
      }

      return Buffer.from(result.signature);
    },
    async verify({ keyId, message, signature }) {
      const result = await client.verify({
        name: keyId,
        data: message,
        signature,
      });

      return result.success === true;
    },
  };
}

export function createVaultTransitHmacClient(client: VaultTransitClientLike): KmsHmacClient {
  return {
    async sign({ keyId, message }) {
      const input = message.toString('base64');
      const result = await client.hmac(keyId, input);
      const hmac = result.data?.hmac;

      if (!hmac) {
        throw new Error('Vault transit HMAC returned no signature');
      }

      const digest = hmac.split(':').pop();
      if (!digest || !/^[0-9a-fA-F]+$/.test(digest)) {
        throw new Error('Vault transit HMAC response was malformed');
      }

      return Buffer.from(digest, 'hex');
    },
    async verify({ keyId, message, signature }) {
      const input = message.toString('base64');
      const hmac = `sha2-256:${signature.toString('hex')}`;
      const result = await client.verify(keyId, input, hmac);
      return result.data?.valid === true;
    },
  };
}

export function createKmsWebhookSigner(config: KmsSignerConfig): KmsWebhookSigner {
  return new KmsWebhookSigner(config);
}

/** In-memory mock client for unit tests — never exposes a raw signing key. */
export function createMockKmsHmacClient(seed = 'mock-kms-hmac-seed'): KmsHmacClient {
  const deriveSignature = (keyId: string, message: Buffer): Buffer => {
    return crypto.createHmac('sha256', `${seed}:${keyId}`).update(message).digest();
  };

  return {
    async sign({ keyId, message }) {
      return deriveSignature(keyId, message);
    },
    async verify({ keyId, message, signature }) {
      const expected = deriveSignature(keyId, message);
      if (expected.length !== signature.length) {
        return false;
      }
      return crypto.timingSafeEqual(expected, signature);
    },
  };
}
