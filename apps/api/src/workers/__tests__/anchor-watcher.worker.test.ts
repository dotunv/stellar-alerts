import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    anchorTransactionWatch: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../lib/anchor', async () => {
  const actual = await vi.importActual<typeof import('../../lib/anchor')>('../../lib/anchor');
  return {
    ...actual,
    fetchAnchorTransactionStatus: vi.fn(),
  };
});

import { prisma } from '../../lib/prisma';
import { fetchAnchorTransactionStatus } from '../../lib/anchor';
import { processAnchorWatch, runAnchorWatcherPass } from '../anchor-watcher.worker';

const baseWatch = {
  id: 'watch-1',
  userId: 'user-a',
  anchorEndpoint: 'https://anchor.example.com/sep24',
  anchorTxId: 'anchor-tx-1',
  protocol: 'sep24',
  lastKnownStatus: null as string | null,
};

describe('processAnchorWatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists and notifies when the anchor reports a new status', async () => {
    (fetchAnchorTransactionStatus as any).mockResolvedValue({
      id: 'anchor-tx-1',
      status: 'pending_external',
      amountIn: '100',
      amountOut: '98',
      moreInfoUrl: 'https://anchor.example.com/more-info',
    });
    const notify = vi.fn();

    const result = await processAnchorWatch(baseWatch, notify);

    expect(result?.status).toBe('pending_external');
    expect(prisma.anchorTransactionWatch.update).toHaveBeenCalledWith({
      where: { id: 'watch-1' },
      data: { lastKnownStatus: 'pending_external' },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        watchId: 'watch-1',
        previousStatus: null,
        newStatus: 'pending_external',
        amountIn: '100',
        amountOut: '98',
      }),
    );
  });

  it('does not persist or notify when the status is unchanged since last pass', async () => {
    (fetchAnchorTransactionStatus as any).mockResolvedValue({ id: 'anchor-tx-1', status: 'pending_external' });
    const notify = vi.fn();

    const result = await processAnchorWatch({ ...baseWatch, lastKnownStatus: 'pending_external' }, notify);

    expect(result?.status).toBe('pending_external');
    expect(prisma.anchorTransactionWatch.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('leaves the watch untouched and returns null when the anchor cannot be reached', async () => {
    (fetchAnchorTransactionStatus as any).mockResolvedValue(null);
    const notify = vi.fn();

    const result = await processAnchorWatch(baseWatch, notify);

    expect(result).toBeNull();
    expect(prisma.anchorTransactionWatch.update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies on each transition, e.g. pending_external -> completed', async () => {
    (fetchAnchorTransactionStatus as any).mockResolvedValue({ id: 'anchor-tx-1', status: 'completed' });
    const notify = vi.fn();

    await processAnchorWatch({ ...baseWatch, lastKnownStatus: 'pending_external' }, notify);

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ previousStatus: 'pending_external', newStatus: 'completed' }),
    );
  });
});

describe('runAnchorWatcherPass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips watches already in a terminal state without calling the anchor', async () => {
    (prisma.anchorTransactionWatch.findMany as any).mockResolvedValue([
      { ...baseWatch, lastKnownStatus: 'completed' },
      { ...baseWatch, id: 'watch-2', lastKnownStatus: 'refunded' },
    ]);

    await runAnchorWatcherPass(vi.fn());

    expect(fetchAnchorTransactionStatus).not.toHaveBeenCalled();
  });

  it('polls every non-terminal watch and notifies on status changes', async () => {
    (prisma.anchorTransactionWatch.findMany as any).mockResolvedValue([
      { ...baseWatch, id: 'watch-1', lastKnownStatus: 'incomplete' },
      { ...baseWatch, id: 'watch-2', anchorTxId: 'anchor-tx-2', lastKnownStatus: null },
    ]);
    (fetchAnchorTransactionStatus as any).mockResolvedValue({ id: 'x', status: 'pending_external' });
    const notify = vi.fn();

    await runAnchorWatcherPass(notify);

    expect(fetchAnchorTransactionStatus).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('continues processing remaining watches if one throws', async () => {
    (prisma.anchorTransactionWatch.findMany as any).mockResolvedValue([
      { ...baseWatch, id: 'watch-1', lastKnownStatus: 'incomplete' },
      { ...baseWatch, id: 'watch-2', anchorTxId: 'anchor-tx-2', lastKnownStatus: 'incomplete' },
    ]);
    (fetchAnchorTransactionStatus as any)
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ id: 'x', status: 'completed' });
    const notify = vi.fn();

    await runAnchorWatcherPass(notify);

    expect(fetchAnchorTransactionStatus).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
