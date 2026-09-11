import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as StellarSdk from 'stellar-sdk';

// Mock prisma before importing worker
vi.mock('../../lib/prisma', () => ({
  prisma: {
    sorobanContractSubscription: {
      findMany: vi.fn(),
    },
  },
}));

// Mock sorobanServer from ../../lib/soroban
vi.mock('../../lib/soroban', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/soroban')>();
  return {
    ...actual,
    sorobanServer: {
      getLedgerEntries: vi.fn(),
      getAccount: vi.fn(),
      simulateTransaction: vi.fn(),
      sendTransaction: vi.fn(),
      pollTransaction: vi.fn(),
      getLatestLedger: vi.fn(),
    },
  };
});

import { prisma } from '../../lib/prisma';
import { sorobanServer, shouldRenew } from '../../lib/soroban';
import { processContractRent, runRentRenewalPass, runRentWorker } from '../soroban-rent.worker';

// Helper to generate a mock contract instance entry
function createMockInstanceXdr(contractId: string, isWasm: boolean = false, wasmHash: Buffer = Buffer.alloc(32, 1)) {
  const executable = isWasm
    ? StellarSdk.xdr.ContractExecutable.contractExecutableWasm(wasmHash)
    : StellarSdk.xdr.ContractExecutable.contractExecutableStellarAsset();

  const instanceScVal = StellarSdk.xdr.ScVal.scvContractInstance(
    new StellarSdk.xdr.ScContractInstance({
      executable,
      storage: null,
    }),
  );

  const instanceEntryData = StellarSdk.xdr.LedgerEntryData.contractData(
    new StellarSdk.xdr.ContractDataEntry({
      ext: new StellarSdk.xdr.ExtensionPoint(0),
      contract: StellarSdk.Address.fromString(contractId).toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
      val: instanceScVal,
    }),
  );

  return instanceEntryData;
}

// Helper to generate a mock contract code entry
function createMockCodeXdr(wasmHash: Buffer) {
  const codeEntryData = StellarSdk.xdr.LedgerEntryData.contractCode(
    new StellarSdk.xdr.LedgerKeyContractCode({
      hash: wasmHash,
    }),
  );
  return codeEntryData;
}

describe('Soroban Rent Renewal Worker', () => {
  const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
  const dummySecret = StellarSdk.Keypair.random().secret();
  const latestLedger = 1000;
  const threshold = 5000;
  const targetTtl = 10000;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Pure Logic Helpers', () => {
    it('should calculate target ledger correctly', () => {
      const targetLedger = latestLedger + targetTtl;
      expect(targetLedger).toBe(11000);
    });

    it('should evaluate threshold correctly', () => {
      expect(shouldRenew(4999, threshold)).toBe(true);
      expect(shouldRenew(5000, threshold)).toBe(true);
      expect(shouldRenew(5001, threshold)).toBe(false);
    });
  });

  describe('RPC Mocked Tests', () => {
    it('should skip renewal when both instance and code are sufficiently alive', async () => {
      const instanceXdr = createMockInstanceXdr(contractId, true);
      const codeXdr = createMockCodeXdr(Buffer.alloc(32, 1));

      // Mock getLedgerEntries for contract instance (live until 7000, so TTL = 6000 > 5000)
      vi.mocked(sorobanServer.getLedgerEntries)
        .mockResolvedValueOnce({
          latestLedger,
          entries: [{
            key: {} as any,
            val: instanceXdr,
            liveUntilLedgerSeq: 7000,
          }],
        })
        // Mock getLedgerEntries for WASM code (live until 8000, TTL = 7000 > 5000)
        .mockResolvedValueOnce({
          latestLedger,
          entries: [{
            key: {} as any,
            val: codeXdr,
            liveUntilLedgerSeq: 8000,
          }],
        });

      await processContractRent(contractId, latestLedger, threshold, targetTtl, dummySecret);

      // Verify that no transaction was simulated/submitted since TTL is sufficient
      expect(sorobanServer.getAccount).not.toHaveBeenCalled();
      expect(sorobanServer.simulateTransaction).not.toHaveBeenCalled();
    });

    it('should execute instance-only renewal when WASM is alive but instance is below threshold', async () => {
      const instanceXdr = createMockInstanceXdr(contractId, true);
      const codeXdr = createMockCodeXdr(Buffer.alloc(32, 1));

      // Mock contract instance below threshold (live until 5500, TTL = 4500 <= 5000)
      vi.mocked(sorobanServer.getLedgerEntries)
        .mockResolvedValueOnce({
          latestLedger,
          entries: [{
            key: {} as any,
            val: instanceXdr,
            liveUntilLedgerSeq: 5500,
          }],
        })
        // Mock WASM code above threshold (live until 8000, TTL = 7000 > 5000)
        .mockResolvedValueOnce({
          latestLedger,
          entries: [{
            key: {} as any,
            val: codeXdr,
            liveUntilLedgerSeq: 8000,
          }],
        });

      // Mock fee-payer account
      const mockKeypair = StellarSdk.Keypair.fromSecret(dummySecret);
      const mockAccountObj = new StellarSdk.Account(mockKeypair.publicKey(), '1');
      vi.mocked(sorobanServer.getAccount).mockResolvedValueOnce(mockAccountObj);

      // Mock simulateTransaction Success
      const dummySimResult = {
        latestLedger,
        transactionData: new StellarSdk.SorobanDataBuilder(),
        minResourceFee: '100',
        _parsed: true,
        events: [],
      } as any;
      vi.mocked(sorobanServer.simulateTransaction).mockResolvedValueOnce(dummySimResult);

      // Mock sendTransaction Pending & pollTransaction Success
      vi.mocked(sorobanServer.sendTransaction).mockResolvedValueOnce({
        status: 'PENDING',
        hash: 'tx-hash-1',
        latestLedger,
        latestLedgerCloseTime: Date.now(),
      });
      vi.mocked(sorobanServer.pollTransaction).mockResolvedValueOnce({
        status: 'SUCCESS',
        txHash: 'tx-hash-1',
        latestLedger,
        latestLedgerCloseTime: Date.now(),
        oldestLedger: 900,
        oldestLedgerCloseTime: Date.now() - 1000,
      } as any);

      await processContractRent(contractId, latestLedger, threshold, targetTtl, dummySecret);

      expect(sorobanServer.getAccount).toHaveBeenCalledWith(mockKeypair.publicKey());
      expect(sorobanServer.simulateTransaction).toHaveBeenCalled();
      expect(sorobanServer.sendTransaction).toHaveBeenCalled();
      expect(sorobanServer.pollTransaction).toHaveBeenCalledWith('tx-hash-1');
    });

    it('should execute joint renewal when both instance and WASM are below threshold', async () => {
      const instanceXdr = createMockInstanceXdr(contractId, true);
      const codeXdr = createMockCodeXdr(Buffer.alloc(32, 1));

      // Mock contract instance below threshold (live until 5500, TTL = 4500 <= 5000)
      vi.mocked(sorobanServer.getLedgerEntries)
        .mockResolvedValueOnce({
          latestLedger,
          entries: [{
            key: {} as any,
            val: instanceXdr,
            liveUntilLedgerSeq: 5500,
          }],
        })
        // Mock WASM code below threshold (live until 5500, TTL = 4500 <= 5000)
        .mockResolvedValueOnce({
          latestLedger,
          entries: [{
            key: {} as any,
            val: codeXdr,
            liveUntilLedgerSeq: 5500,
          }],
        });

      const mockKeypair = StellarSdk.Keypair.fromSecret(dummySecret);
      const mockAccountObj = new StellarSdk.Account(mockKeypair.publicKey(), '1');
      vi.mocked(sorobanServer.getAccount).mockResolvedValueOnce(mockAccountObj);

      const dummySimResult = {
        latestLedger,
        transactionData: new StellarSdk.SorobanDataBuilder(),
        minResourceFee: '100',
        _parsed: true,
        events: [],
      } as any;
      vi.mocked(sorobanServer.simulateTransaction).mockResolvedValueOnce(dummySimResult);

      vi.mocked(sorobanServer.sendTransaction).mockResolvedValueOnce({
        status: 'PENDING',
        hash: 'tx-hash-2',
        latestLedger,
        latestLedgerCloseTime: Date.now(),
      });
      vi.mocked(sorobanServer.pollTransaction).mockResolvedValueOnce({
        status: 'SUCCESS',
        txHash: 'tx-hash-2',
        latestLedger,
      } as any);

      await processContractRent(contractId, latestLedger, threshold, targetTtl, dummySecret);

      expect(sorobanServer.simulateTransaction).toHaveBeenCalled();
      expect(sorobanServer.sendTransaction).toHaveBeenCalled();
    });

    it('should skip renewal if the signing secret is missing', async () => {
      const instanceXdr = createMockInstanceXdr(contractId, false);

      vi.mocked(sorobanServer.getLedgerEntries).mockResolvedValueOnce({
        latestLedger,
        entries: [{
          key: {} as any,
          val: instanceXdr,
          liveUntilLedgerSeq: 5500, // below threshold
        }],
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await processContractRent(contractId, latestLedger, threshold, targetTtl, undefined);

      expect(sorobanServer.getAccount).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('SOROBAN_RENT_WORKER_SECRET is not configured'),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle missing contract instance entry gracefully', async () => {
      vi.mocked(sorobanServer.getLedgerEntries).mockResolvedValueOnce({
        latestLedger,
        entries: [], // Empty entries = missing contract
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await processContractRent(contractId, latestLedger, threshold, targetTtl, dummySecret);

      expect(sorobanServer.getAccount).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Contract instance entry not found'),
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle simulation failure gracefully without submitting', async () => {
      const instanceXdr = createMockInstanceXdr(contractId, false);

      vi.mocked(sorobanServer.getLedgerEntries).mockResolvedValueOnce({
        latestLedger,
        entries: [{
          key: {} as any,
          val: instanceXdr,
          liveUntilLedgerSeq: 5500, // below threshold
        }],
      });

      const mockKeypair = StellarSdk.Keypair.fromSecret(dummySecret);
      const mockAccountObj = new StellarSdk.Account(mockKeypair.publicKey(), '1');
      vi.mocked(sorobanServer.getAccount).mockResolvedValueOnce(mockAccountObj);

      // Simulation returns error response
      vi.mocked(sorobanServer.simulateTransaction).mockResolvedValueOnce({
        latestLedger,
        error: 'Simulation failed: host resource limit exceeded',
        _parsed: true,
        events: [],
      } as any);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await processContractRent(contractId, latestLedger, threshold, targetTtl, dummySecret);

      expect(sorobanServer.sendTransaction).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Simulation failed for contract'),
        'Simulation failed: host resource limit exceeded',
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle transaction submission error gracefully without crashing', async () => {
      const instanceXdr = createMockInstanceXdr(contractId, false);

      vi.mocked(sorobanServer.getLedgerEntries).mockResolvedValueOnce({
        latestLedger,
        entries: [{
          key: {} as any,
          val: instanceXdr,
          liveUntilLedgerSeq: 5500, // below threshold
        }],
      });

      const mockKeypair = StellarSdk.Keypair.fromSecret(dummySecret);
      const mockAccountObj = new StellarSdk.Account(mockKeypair.publicKey(), '1');
      vi.mocked(sorobanServer.getAccount).mockResolvedValueOnce(mockAccountObj);

      const dummySimResult = {
        latestLedger,
        transactionData: new StellarSdk.SorobanDataBuilder(),
        minResourceFee: '100',
        _parsed: true,
        events: [],
      } as any;
      vi.mocked(sorobanServer.simulateTransaction).mockResolvedValueOnce(dummySimResult);

      // Mock submission failure status ERROR
      vi.mocked(sorobanServer.sendTransaction).mockResolvedValueOnce({
        status: 'ERROR',
        hash: 'tx-hash-failed',
        latestLedger,
        latestLedgerCloseTime: Date.now(),
        errorResultXdr: 'dummy-error-result-xdr',
      } as any);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await processContractRent(contractId, latestLedger, threshold, targetTtl, dummySecret);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Submission rejected for contract'),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Pass and Supervisor Integration Tests', () => {
    it('should process multiple contracts sequentially and isolate errors', async () => {
      const contractId1 = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
      const contractId2 = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 2));

      vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce([
        { contractId: contractId1 },
        { contractId: contractId2 },
      ] as any);

      vi.mocked(sorobanServer.getLatestLedger).mockResolvedValueOnce({
        sequence: latestLedger,
      } as any);

      // Contract 1 throws an error
      vi.mocked(sorobanServer.getLedgerEntries)
        .mockRejectedValueOnce(new Error('Network connection timeout'))
        // Contract 2 is processed successfully (but no renewal needed)
        .mockResolvedValueOnce({
          latestLedger,
          entries: [{
            key: {} as any,
            val: createMockInstanceXdr(contractId2, false),
            liveUntilLedgerSeq: 8000,
          }],
        });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await runRentRenewalPass();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Error processing rent for contract ${contractId1}:`),
        'Network connection timeout',
      );
      // Verify both were reached
      expect(sorobanServer.getLedgerEntries).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });
  });
});
