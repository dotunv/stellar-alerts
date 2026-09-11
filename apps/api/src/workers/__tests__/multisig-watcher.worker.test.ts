import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as StellarSdk from 'stellar-sdk';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    multisigTreasury: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    pendingMultisigTransaction: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../lib/stellar', async () => {
  const actual = await vi.importActual<typeof import('../../lib/stellar')>('../../lib/stellar');
  return {
    ...actual,
    stellar: {
      getAccountSigners: vi.fn(),
    },
  };
});

import { prisma } from '../../lib/prisma';
import { stellar } from '../../lib/stellar';
import {
  processPendingTransaction,
  runMultisigWatcherPass,
  trackPendingTransaction,
} from '../multisig-watcher.worker';

const signerKeypairs = Array.from({ length: 3 }, () => StellarSdk.Keypair.random());
const destination = StellarSdk.Keypair.random().publicKey();
const thresholds = { low: 1, medium: 2, high: 3 };
const signers = signerKeypairs.map((kp) => ({ key: kp.publicKey(), weight: 1 }));

function buildEnvelope(signerIndexes: number[]): string {
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
  for (const i of signerIndexes) tx.sign(signerKeypairs[i]);
  return tx.toXDR();
}

const treasury = {
  id: 'treasury-1',
  publicKey: signerKeypairs[0].publicKey(),
  label: 'DAO Treasury',
  thresholdLevel: 'medium',
  signerWatchers: [
    { userId: 'user-a', signerPublicKey: signerKeypairs[0].publicKey() },
    { userId: 'user-b', signerPublicKey: signerKeypairs[1].publicKey() },
    { userId: 'user-c', signerPublicKey: signerKeypairs[2].publicKey() },
  ],
};

describe('processPendingTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.pendingMultisigTransaction.findUnique as any).mockResolvedValue({
      notifiedJson: [],
      status: 'pending',
    });
  });

  it('notifies every signer who has not yet approved a fresh 1-of-2 pending transaction', async () => {
    const envelope = buildEnvelope([0]); // only the first signer has approved so far
    const notify = vi.fn();

    const progress = await processPendingTransaction(
      treasury as any,
      { id: 'tx-1', innerTxHash: 'hash-1', envelopeXdr: envelope },
      signers,
      thresholds,
      notify,
    );

    expect(progress.collectedWeight).toBe(1);
    expect(progress.thresholdMet).toBe(false);

    // Signers B and C haven't signed — both should be notified; A has, so not notified.
    expect(notify).toHaveBeenCalledTimes(2);
    const notifiedKeys = notify.mock.calls.map((c) => c[0].signerPublicKey).sort();
    expect(notifiedKeys).toEqual([signerKeypairs[1].publicKey(), signerKeypairs[2].publicKey()].sort());

    expect(prisma.pendingMultisigTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { collectedWeight: 1, signedByJson: [signerKeypairs[0].publicKey()], status: 'pending' },
    });
  });

  it('does not notify a signer twice across polls once they were already notified', async () => {
    (prisma.pendingMultisigTransaction.findUnique as any).mockResolvedValue({
      notifiedJson: [signerKeypairs[1].publicKey()],
      status: 'pending',
    });
    const envelope = buildEnvelope([0]);
    const notify = vi.fn();

    await processPendingTransaction(
      treasury as any,
      { id: 'tx-1', innerTxHash: 'hash-1', envelopeXdr: envelope },
      signers,
      thresholds,
      notify,
    );

    // Only C is notified this pass; B was already notified in a previous pass.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].signerPublicKey).toBe(signerKeypairs[2].publicKey());
  });

  it('stops notifying once the threshold is met and marks the transaction threshold_met', async () => {
    const envelope = buildEnvelope([0, 1]); // 2/2 medium threshold
    const notify = vi.fn();

    const progress = await processPendingTransaction(
      treasury as any,
      { id: 'tx-1', innerTxHash: 'hash-1', envelopeXdr: envelope },
      signers,
      thresholds,
      notify,
    );

    expect(progress.thresholdMet).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(prisma.pendingMultisigTransaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: {
        collectedWeight: 2,
        signedByJson: [signerKeypairs[0].publicKey(), signerKeypairs[1].publicKey()],
        status: 'threshold_met',
      },
    });
  });

  it('never notifies a signer who is not registered as a watcher for the treasury', async () => {
    const outsider = StellarSdk.Keypair.random();
    const treasuryMissingWatcher = {
      ...treasury,
      signerWatchers: [{ userId: 'user-a', signerPublicKey: signerKeypairs[0].publicKey() }],
    };
    const envelope = buildEnvelope([0]);
    const notify = vi.fn();

    await processPendingTransaction(
      treasuryMissingWatcher as any,
      { id: 'tx-1', innerTxHash: 'hash-1', envelopeXdr: envelope },
      signers,
      thresholds,
      notify,
    );

    // B and C remain unsigned but have no registered watcher, so nobody to notify.
    expect(notify).not.toHaveBeenCalled();
    void outsider;
  });
});

describe('runMultisigWatcherPass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.pendingMultisigTransaction.findUnique as any).mockResolvedValue({
      notifiedJson: [],
      status: 'pending',
    });
  });

  it('skips a treasury with no pending transactions without calling Horizon', async () => {
    (prisma.multisigTreasury.findMany as any).mockResolvedValue([{ ...treasury, pendingTxs: [] }]);

    await runMultisigWatcherPass(vi.fn());

    expect(stellar.getAccountSigners).not.toHaveBeenCalled();
  });

  it('processes each pending transaction for a treasury and notifies remaining signers', async () => {
    const envelope = buildEnvelope([0]);
    (prisma.multisigTreasury.findMany as any).mockResolvedValue([
      { ...treasury, pendingTxs: [{ id: 'tx-1', innerTxHash: 'hash-1', envelopeXdr: envelope }] },
    ]);
    (stellar.getAccountSigners as any).mockResolvedValue({ signers, thresholds });
    const notify = vi.fn();

    await runMultisigWatcherPass(notify);

    expect(stellar.getAccountSigners).toHaveBeenCalledWith(treasury.publicKey);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('continues processing other treasuries if one fails to load signers', async () => {
    const envelope = buildEnvelope([0]);
    const treasuryTwo = {
      ...treasury,
      id: 'treasury-2',
      publicKey: StellarSdk.Keypair.random().publicKey(),
    };
    (prisma.multisigTreasury.findMany as any).mockResolvedValue([
      { ...treasury, pendingTxs: [{ id: 'tx-1', innerTxHash: 'hash-1', envelopeXdr: envelope }] },
      { ...treasuryTwo, pendingTxs: [{ id: 'tx-2', innerTxHash: 'hash-2', envelopeXdr: envelope }] },
    ]);
    (stellar.getAccountSigners as any)
      .mockResolvedValueOnce(null) // first treasury fails to load
      .mockResolvedValueOnce({ signers, thresholds }); // second succeeds
    const notify = vi.fn();

    await runMultisigWatcherPass(notify);

    expect(stellar.getAccountSigners).toHaveBeenCalledTimes(2);
    // Only the second treasury's signers get notified.
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('trackPendingTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts a pending transaction keyed by the inner transaction hash', async () => {
    (prisma.multisigTreasury.findUnique as any).mockResolvedValue(treasury);
    (stellar.getAccountSigners as any).mockResolvedValue({ signers, thresholds });
    (prisma.pendingMultisigTransaction.upsert as any).mockResolvedValue({ id: 'tx-1' });

    const envelope = buildEnvelope([0]);
    await trackPendingTransaction(treasury.publicKey, envelope, StellarSdk.Networks.TESTNET);

    expect(prisma.pendingMultisigTransaction.upsert).toHaveBeenCalledTimes(1);
    const call = (prisma.pendingMultisigTransaction.upsert as any).mock.calls[0][0];
    expect(call.where.innerTxHash).toBeTypeOf('string');
    expect(call.create.collectedWeight).toBe(1);
    expect(call.create.status).toBe('pending');
  });

  it('throws for an unknown treasury public key', async () => {
    (prisma.multisigTreasury.findUnique as any).mockResolvedValue(null);

    await expect(
      trackPendingTransaction('GUNKNOWN', buildEnvelope([0]), StellarSdk.Networks.TESTNET),
    ).rejects.toThrow(/Unknown multisig treasury/);
  });
});
