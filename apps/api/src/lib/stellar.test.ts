import { describe, it, expect, vi, afterEach } from 'vitest';
import * as StellarSdk from 'stellar-sdk';
import { stellar, countMultisigSignatures } from './stellar';

// Fluent mock matching the Horizon payments() call builder
// (.forAccount().order()/.cursor().limit().call()), so these tests never hit
// the real Horizon network.
function mockPaymentsChain(records: unknown[] = []) {
  const chain = {
    forAccount: vi.fn().mockReturnThis(),
    cursor: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    call: vi.fn().mockResolvedValue({ records }),
  };
  const spy = vi.spyOn(stellar.server, 'payments').mockReturnValue(chain as any);
  const multiSpy = vi.spyOn(stellar.multiNode.servers[0], 'payments').mockReturnValue(chain as any);
  return { chain, spy, multiSpy };
}

describe('stellar.getRecentPayments / getPaymentsSince (StrKey guard)', () => {
  const validPublicKey = StellarSdk.Keypair.random().publicKey();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getRecentPayments never calls Horizon for a checksum-invalid public key', async () => {
    const lastChar = validPublicKey.at(-1);
    const corrupted = validPublicKey.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');
    expect(StellarSdk.StrKey.isValidEd25519PublicKey(corrupted)).toBe(false);

    const { spy } = mockPaymentsChain();
    const result = await stellar.getRecentPayments(corrupted, 10);

    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('getRecentPayments never calls Horizon for a malformed (non-StrKey) string', async () => {
    const { spy } = mockPaymentsChain();
    const result = await stellar.getRecentPayments('not-a-stellar-key', 10);

    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('getRecentPayments never calls Horizon for an empty public key', async () => {
    const { spy } = mockPaymentsChain();
    const result = await stellar.getRecentPayments('', 10);

    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('getRecentPayments queries Horizon for a valid public key', async () => {
    const record = { id: '1', paging_token: '1' };
    const { chain, spy } = mockPaymentsChain([record]);

    const result = await stellar.getRecentPayments(validPublicKey, 5);

    expect(spy).toHaveBeenCalled();
    expect(chain.forAccount).toHaveBeenCalledWith(validPublicKey);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(result).toEqual([record]);
  });

  it('getPaymentsSince never calls Horizon for a checksum-invalid public key', async () => {
    const lastChar = validPublicKey.at(-1);
    const corrupted = validPublicKey.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');

    const { spy } = mockPaymentsChain();
    const result = await stellar.getPaymentsSince(corrupted, '0', 50);

    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('getPaymentsSince queries Horizon for a valid public key', async () => {
    const record = { id: '2', paging_token: '2' };
    const { chain, spy, multiSpy } = mockPaymentsChain([record]);

    const result = await stellar.getPaymentsSince(validPublicKey, '100', 50);

    expect(multiSpy).toHaveBeenCalled();
    expect(chain.forAccount).toHaveBeenCalledWith(validPublicKey);
    expect(chain.cursor).toHaveBeenCalledWith('100');
    expect(result).toEqual([record]);
  });
});

describe('MultiNodeHorizonClient failover & deduplication', () => {
  const validPublicKey = StellarSdk.Keypair.random().publicKey();

  it('fails over to secondary node if primary node fails', async () => {
    const { MultiNodeHorizonClient } = await import('./stellar');
    const client = new MultiNodeHorizonClient(['https://node1.example.com', 'https://node2.example.com']);

    vi.spyOn(client.servers[0], 'payments').mockImplementation(() => {
      throw new Error('Primary node network timeout');
    });

    const record = { id: 'multi-1', paging_token: '100' };
    const chain2 = {
      forAccount: vi.fn().mockReturnThis(),
      cursor: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      call: vi.fn().mockResolvedValue({ records: [record] }),
    };
    vi.spyOn(client.servers[1], 'payments').mockReturnValue(chain2 as any);

    const records = await client.getPaymentsSince(validPublicKey, '0', 50);
    expect(records).toEqual([record]);
  });

  it('deduplicates incoming records across concurrent multi-node SSE streams', async () => {
    const { MultiNodeHorizonClient } = await import('./stellar');
    const client = new MultiNodeHorizonClient(['https://node1.example.com', 'https://node2.example.com']);

    let streamHandler1: any;
    let streamHandler2: any;

    vi.spyOn(client.servers[0], 'payments').mockReturnValue({
      forAccount: () => ({
        cursor: () => ({
          stream: ({ onmessage }: any) => {
            streamHandler1 = onmessage;
            return () => {};
          },
        }),
      }),
    } as any);

    vi.spyOn(client.servers[1], 'payments').mockReturnValue({
      forAccount: () => ({
        cursor: () => ({
          stream: ({ onmessage }: any) => {
            streamHandler2 = onmessage;
            return () => {};
          },
        }),
      }),
    } as any);

    const received: any[] = [];
    client.streamPaymentsMultiNode(
      validPublicKey,
      '0',
      (record) => {
        received.push(record);
      }
    );

    const record = { id: 'dup-1', paging_token: '12345', type: 'payment' };
    await streamHandler1(record);
    await streamHandler2(record);

    expect(received.length).toBe(1);
    expect(received[0].id).toBe('dup-1');
  });
});

describe('countMultisigSignatures', () => {
  // A 3-of-5 style DAO treasury: five ed25519 signers, each weight 1,
  // medium threshold requires 3 combined weight.
  const signerKeypairs = Array.from({ length: 5 }, () => StellarSdk.Keypair.random());
  const signers: import('./stellar').MultisigSigner[] = signerKeypairs.map((kp) => ({
    key: kp.publicKey(),
    weight: 1,
  }));
  const thresholds: import('./stellar').MultisigThresholds = { low: 1, medium: 3, high: 5 };
  const destination = StellarSdk.Keypair.random().publicKey();

  function buildEnvelope(signerIndexes: number[]): string {
    const sourceAccount = new StellarSdk.Account(signerKeypairs[0].publicKey(), '1');
    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: '10',
        }),
      )
      .setTimeout(30)
      .build();

    for (const i of signerIndexes) {
      tx.sign(signerKeypairs[i]);
    }

    return tx.toXDR();
  }

  it('reports zero collected weight and no signers for an unsigned envelope', () => {
    const envelope = buildEnvelope([]);
    const progress = countMultisigSignatures(envelope, signers, thresholds, StellarSdk.Networks.TESTNET);

    expect(progress.collectedWeight).toBe(0);
    expect(progress.signedBy).toEqual([]);
    expect(progress.remainingSigners).toHaveLength(5);
    expect(progress.thresholdMet).toBe(false);
    expect(progress.requiredThreshold).toBe(3);
  });

  it('counts each valid signature exactly once toward the threshold (2/3 collected)', () => {
    const envelope = buildEnvelope([0, 2]);
    const progress = countMultisigSignatures(envelope, signers, thresholds, StellarSdk.Networks.TESTNET);

    expect(progress.collectedWeight).toBe(2);
    expect(progress.requiredThreshold).toBe(3);
    expect(progress.thresholdMet).toBe(false);
    expect(progress.signedBy.sort()).toEqual(
      [signerKeypairs[0].publicKey(), signerKeypairs[2].publicKey()].sort(),
    );
    expect(progress.remainingSigners.map((s) => s.key).sort()).toEqual(
      [signerKeypairs[1].publicKey(), signerKeypairs[3].publicKey(), signerKeypairs[4].publicKey()].sort(),
    );
  });

  it('reports thresholdMet once enough signers have signed (3/3)', () => {
    const envelope = buildEnvelope([0, 1, 4]);
    const progress = countMultisigSignatures(envelope, signers, thresholds, StellarSdk.Networks.TESTNET);

    expect(progress.collectedWeight).toBe(3);
    expect(progress.thresholdMet).toBe(true);
    expect(progress.remainingSigners).toHaveLength(2);
  });

  it('does not double-count the same signer signing twice', () => {
    const sourceAccount = new StellarSdk.Account(signerKeypairs[0].publicKey(), '1');
    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({ destination, asset: StellarSdk.Asset.native(), amount: '10' }),
      )
      .setTimeout(30)
      .build();
    tx.sign(signerKeypairs[0]);
    tx.sign(signerKeypairs[0]); // duplicate signature from the same key

    const progress = countMultisigSignatures(tx.toXDR(), signers, thresholds, StellarSdk.Networks.TESTNET);

    expect(progress.collectedWeight).toBe(1);
    expect(progress.signedBy).toEqual([signerKeypairs[0].publicKey()]);
  });

  it('does not count a signature from a keypair that is not a known signer', () => {
    const outsider = StellarSdk.Keypair.random();
    const sourceAccount = new StellarSdk.Account(signerKeypairs[0].publicKey(), '1');
    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({ destination, asset: StellarSdk.Asset.native(), amount: '10' }),
      )
      .setTimeout(30)
      .build();
    tx.sign(outsider);

    const progress = countMultisigSignatures(tx.toXDR(), signers, thresholds, StellarSdk.Networks.TESTNET);

    expect(progress.collectedWeight).toBe(0);
    expect(progress.signedBy).toEqual([]);
    expect(progress.invalidSignatureCount).toBe(1);
  });

  it('rejects a tampered signature (valid hint, forged bytes) rather than crediting it', () => {
    const envelope = buildEnvelope([1]);
    const tx = StellarSdk.TransactionBuilder.fromXDR(envelope, StellarSdk.Networks.TESTNET) as StellarSdk.Transaction;

    // Corrupt the signature bytes while keeping the same 4-byte hint, simulating
    // a tampered/forged envelope rather than a legitimately re-signed one.
    const original = tx.signatures[0];
    const forged = original.signature();
    forged[0] = forged[0] ^ 0xff;
    tx.signatures[0] = new StellarSdk.xdr.DecoratedSignature({
      hint: original.hint(),
      signature: forged,
    });

    const progress = countMultisigSignatures(tx.toXDR(), signers, thresholds, StellarSdk.Networks.TESTNET);

    expect(progress.collectedWeight).toBe(0);
    expect(progress.signedBy).toEqual([]);
    expect(progress.invalidSignatureCount).toBe(1);
  });

  it('respects a per-treasury threshold level override (high requires all 5)', () => {
    const envelope = buildEnvelope([0, 1, 2]);
    const progress = countMultisigSignatures(
      envelope,
      signers,
      thresholds,
      StellarSdk.Networks.TESTNET,
      'high',
    );

    expect(progress.requiredThreshold).toBe(5);
    expect(progress.collectedWeight).toBe(3);
    expect(progress.thresholdMet).toBe(false);
  });

  it('handles weighted signers (a co-founder key worth more than a delegate key)', () => {
    const weighted: import('./stellar').MultisigSigner[] = [
      { key: signerKeypairs[0].publicKey(), weight: 3 },
      { key: signerKeypairs[1].publicKey(), weight: 1 },
      { key: signerKeypairs[2].publicKey(), weight: 1 },
    ];
    const envelope = buildEnvelope([0]); // just the weight-3 signer

    const progress = countMultisigSignatures(
      envelope,
      weighted,
      { low: 1, medium: 3, high: 4 },
      StellarSdk.Networks.TESTNET,
    );

    expect(progress.collectedWeight).toBe(3);
    expect(progress.thresholdMet).toBe(true);
  });
});
