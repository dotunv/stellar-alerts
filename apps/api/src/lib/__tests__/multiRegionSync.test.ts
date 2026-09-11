import { describe, expect, it } from 'vitest';
import { MultiRegionStateSynchronizer, SyncedJobState } from '../multiRegionSync';

describe('MultiRegionStateSynchronizer (#192)', () => {
  it('registers peer regions and records local job transitions with version increments', () => {
    const synchronizer = new MultiRegionStateSynchronizer('us-east-1');
    synchronizer.registerPeerRegion({
      regionId: 'eu-central-1',
      endpoint: 'redis://eu-central-1.internal:6379',
    });

    expect(synchronizer.getRegisteredPeers().length).toBe(1);
    expect(synchronizer.getRegisteredPeers()[0].regionId).toBe('eu-central-1');

    const state1 = synchronizer.recordJobTransition('job_alert_101', 'waiting');
    expect(state1.version).toBe(1);
    expect(state1.originRegion).toBe('us-east-1');

    const state2 = synchronizer.recordJobTransition('job_alert_101', 'active');
    expect(state2.version).toBe(2);
    expect(state2.state).toBe('active');
  });

  it('reconciles remote states using CRDT rules, preventing duplicate alert dispatches', () => {
    const usNode = new MultiRegionStateSynchronizer('us-east-1');
    usNode.recordJobTransition('job_alert_202', 'active');

    // Simulate remote EU node claiming completion
    const remoteEuState: SyncedJobState = {
      jobId: 'job_alert_202',
      originRegion: 'eu-central-1',
      state: 'completed',
      timestamp: Date.now() + 50,
      version: 3,
    };

    const resolution = usNode.reconcileRemoteJobState(remoteEuState);

    expect(resolution.winnerState.state).toBe('completed');
    expect(resolution.isDuplicateDispatch).toBe(true);
  });

  it('synchronizes and replicates nonces across regions for cross-region replay protection', () => {
    const synchronizer = new MultiRegionStateSynchronizer('us-east-1');
    const nonce = 'test-uuid-nonce-12345';

    expect(synchronizer.isNonceReplicated(nonce)).toBe(false);
    expect(synchronizer.replicateNonce(nonce, 60000)).toBe(true);
    expect(synchronizer.isNonceReplicated(nonce)).toBe(true);

    // Second attempt within TTL should fail (replay detected)
    expect(synchronizer.replicateNonce(nonce, 60000)).toBe(false);
  });
});
