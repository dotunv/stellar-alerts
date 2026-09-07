import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSorobanTransferEvent,
  hashSorobanLedgerEntry,
  verifySorobanContractStateProof,
  parseSwapEvent,
  FlashLoanDetector,
  buildFlashLoanOperationTree,
  detectFlashLoanInTransaction,
  flashLoanDetector,
  parseStakingRewardEvent,
  StakingRewardTracker,
  stakingRewardTracker,
} from "./soroban";
import { buildMerkleTree, generateMerkleProof, hashMerkleLeaf } from "../utils/merkle-verifier";

describe("Soroban Event Parsing", () => {
  beforeEach(() => {
    // No setup needed
  });

  it("should parse soroban transfer events correctly", () => {
    const mockEvent = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topic: ["AAAADwAAAAZ0cmFuc2Zlcg=="],
      value: {
        from: "GAAA",
        to: "GBBB",
        amount: "1000000",
      },
      ledger: 123456,
    };

    const parsed = parseSorobanTransferEvent(mockEvent);

    expect(parsed).not.toBeNull();
    expect(parsed?.contractId).toBe(mockEvent.contractId);
    expect(parsed?.from).toBe("GAAA");
    expect(parsed?.to).toBe("GBBB");
    expect(parsed?.amount).toBe("1000000");
    expect(parsed?.ledgerSeq).toBe(123456);
  });

  it("should return null for events without topic", () => {
    const mockEvent = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topic: [],
      value: { from: "GAAA", to: "GBBB" },
    };

    const parsed = parseSorobanTransferEvent(mockEvent);
    expect(parsed).toBeNull();
  });

  it("should handle events with missing ledger sequence", () => {
    const mockEvent = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topic: ["transfer"],
      value: {
        from: "GAAA",
        to: "GBBB",
        amount: "500000",
      },
    };

    const parsed = parseSorobanTransferEvent(mockEvent);

    expect(parsed).not.toBeNull();
    expect(parsed?.ledgerSeq).toBeUndefined();
  });

  it("should handle nested transfer event structure", () => {
    const mockEvent = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topic: ["transfer"],
      value: {
        transfer: {
          from: "GAAA",
          to: "GBBB",
        },
        amount: "750000",
      },
      ledger: 200000,
    };

    const parsed = parseSorobanTransferEvent(mockEvent);

    expect(parsed).not.toBeNull();
    expect(parsed?.from).toBe("GAAA");
    expect(parsed?.to).toBe("GBBB");
    expect(parsed?.amount).toBe("750000");
    expect(parsed?.ledgerSeq).toBe(200000);
  });

  it("should handle events with null values", () => {
    const mockEvent = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topic: ["transfer"],
      value: null,
    };

    const parsed = parseSorobanTransferEvent(mockEvent);

    expect(parsed).not.toBeNull();
    expect(parsed?.from).toBe("");
    expect(parsed?.to).toBe("");
    expect(parsed?.amount).toBe("0");
  });

  it("should convert amount to string", () => {
    const mockEvent = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topic: ["transfer"],
      value: {
        from: "GAAA",
        to: "GBBB",
        amount: 999999,
      },
    };

    const parsed = parseSorobanTransferEvent(mockEvent);

    expect(parsed).not.toBeNull();
    expect(parsed?.amount).toBe("999999");
    expect(typeof parsed?.amount).toBe("string");
  });
});

describe("Soroban contract state proof verification", () => {
  // Simulated Soroban LedgerKey / LedgerEntryData XDR — real XDR is opaque
  // binary, but the verifier only needs *some* stable bytes to hash, so a
  // base64-encoded fixture stands in for the real xdr.LedgerKey /
  // xdr.LedgerEntryData bytes without needing a live RPC round trip.
  function fakeEntryXdr(label: string) {
    return {
      ledgerKeyXdr: Buffer.from(`key:${label}`).toString("base64"),
      ledgerEntryXdr: Buffer.from(`value:${label}`).toString("base64"),
    };
  }

  it("hashSorobanLedgerEntry is deterministic and binds both key and value", () => {
    const entry = fakeEntryXdr("counter");
    const a = hashSorobanLedgerEntry(entry.ledgerKeyXdr, entry.ledgerEntryXdr);
    const b = hashSorobanLedgerEntry(entry.ledgerKeyXdr, entry.ledgerEntryXdr);
    expect(a).toBe(b);

    // Same key, different value -> different leaf hash (the proof commits
    // to the exact stored value, not just key presence).
    const changedValue = hashSorobanLedgerEntry(
      entry.ledgerKeyXdr,
      Buffer.from("value:counter-changed").toString("base64"),
    );
    expect(changedValue).not.toBe(a);
  });

  it("verifies a genuine contract storage entry against its ledger's state root", () => {
    const entries = ["balance:alice", "balance:bob", "balance:carol", "admin"].map((label) =>
      fakeEntryXdr(label),
    );
    // Build the tree the same way hashSorobanLedgerEntry does (key||value bytes).
    const rawLeaves = entries.map((e) =>
      Buffer.concat([Buffer.from(e.ledgerKeyXdr, "base64"), Buffer.from(e.ledgerEntryXdr, "base64")]),
    );
    const tree = buildMerkleTree(rawLeaves);

    const targetIndex = 1; // balance:bob
    const proof = generateMerkleProof(tree, targetIndex);

    const result = verifySorobanContractStateProof({
      ledgerKeyXdr: entries[targetIndex].ledgerKeyXdr,
      ledgerEntryXdr: entries[targetIndex].ledgerEntryXdr,
      proof,
      ledgerStateRoot: tree.root,
    });

    expect(result).toBe(true);
  });

  it("rejects the proof if the claimed entry value doesn't match what was actually committed", () => {
    const entries = ["balance:alice", "balance:bob"].map((label) => fakeEntryXdr(label));
    const rawLeaves = entries.map((e) =>
      Buffer.concat([Buffer.from(e.ledgerKeyXdr, "base64"), Buffer.from(e.ledgerEntryXdr, "base64")]),
    );
    const tree = buildMerkleTree(rawLeaves);
    const proof = generateMerkleProof(tree, 0);

    // Same key, but an attacker-claimed (higher) balance value.
    const forgedEntry = fakeEntryXdr("balance:alice-but-richer");
    const result = verifySorobanContractStateProof({
      ledgerKeyXdr: entries[0].ledgerKeyXdr,
      ledgerEntryXdr: forgedEntry.ledgerEntryXdr,
      proof,
      ledgerStateRoot: tree.root,
    });

    expect(result).toBe(false);
  });

  it("rejects a proof presented against the wrong ledger's state root", () => {
    const entries = ["balance:alice", "balance:bob"].map((label) => fakeEntryXdr(label));
    const rawLeaves = entries.map((e) =>
      Buffer.concat([Buffer.from(e.ledgerKeyXdr, "base64"), Buffer.from(e.ledgerEntryXdr, "base64")]),
    );
    const tree = buildMerkleTree(rawLeaves);
    const proof = generateMerkleProof(tree, 0);

    const staleRoot = hashMerkleLeaf(Buffer.from("some-other-ledgers-root"));

    const result = verifySorobanContractStateProof({
      ledgerKeyXdr: entries[0].ledgerKeyXdr,
      ledgerEntryXdr: entries[0].ledgerEntryXdr,
      proof,
      ledgerStateRoot: staleRoot,
    });

    expect(result).toBe(false);
  });

  it("returns false (never throws) for malformed base64 XDR input", () => {
    const result = verifySorobanContractStateProof({
      ledgerKeyXdr: "%%%not-base64%%%",
      ledgerEntryXdr: "also-not-valid",
      proof: [],
      ledgerStateRoot: "not-a-hex-root",
    });
    expect(result).toBe(false);
  });
});

describe("parseSwapEvent", () => {
  it("parses a swap event with snake_case fields and a reported price impact", () => {
    const event = {
      contractId: "CPOOL",
      topic: ["swap"],
      value: {
        token_in: "CTOKENA",
        token_out: "CTOKENB",
        amount_in: "5000000",
        amount_out: "4900000",
        price_impact: "2.35",
      },
      ledger: 999,
      txHash: "deadbeef",
    };

    const swap = parseSwapEvent(event);

    expect(swap).not.toBeNull();
    expect(swap?.contractId).toBe("CPOOL");
    expect(swap?.tokenIn).toBe("CTOKENA");
    expect(swap?.tokenOut).toBe("CTOKENB");
    expect(swap?.amountIn).toBe("0.5");
    expect(swap?.amountOut).toBe("0.49");
    expect(swap?.priceImpactPct).toBe("2.35");
    expect(swap?.ledgerSeq).toBe(999);
    expect(swap?.txHash).toBe("deadbeef");
  });

  it("parses a swap event with camelCase fields and no price impact reported", () => {
    const event = {
      contractId: "CPOOL",
      topic: ["swap"],
      value: {
        tokenIn: "CTOKENA",
        tokenOut: "CTOKENB",
        amountIn: "1000000",
        amountOut: "990000",
      },
      ledgerSeq: 500,
    };

    const swap = parseSwapEvent(event);

    expect(swap).not.toBeNull();
    expect(swap?.priceImpactPct).toBeNull();
    expect(swap?.ledgerSeq).toBe(500);
  });

  it("returns null for a non-swap event (e.g. transfer)", () => {
    const event = {
      contractId: "CPOOL",
      topic: ["transfer"],
      value: { from: "GAAA", to: "GBBB", amount: "100" },
    };

    expect(parseSwapEvent(event)).toBeNull();
  });

  it("returns null for an event with no topic", () => {
    expect(parseSwapEvent({ contractId: "CPOOL", topic: [], value: {} })).toBeNull();
    expect(parseSwapEvent(null)).toBeNull();
  });

  it("returns null when the swap event is missing an amount", () => {
    const event = {
      contractId: "CPOOL",
      topic: ["swap"],
      value: { token_in: "CTOKENA", token_out: "CTOKENB", amount_in: "1000000" },
    };

    expect(parseSwapEvent(event)).toBeNull();
  });
});

describe("FlashLoanDetector transaction tree parser (#186)", () => {
  const detector = new FlashLoanDetector();

  it("detects atomic borrow and repay operations within a single transaction", () => {
    const operations = [
      {
        id: "borrow-1",
        type: "flash_loan",
        asset: "CASSETXLM",
        amount: "1000000000",
        contractId: "CBLEND",
      },
      {
        id: "swap-1",
        parentId: "borrow-1",
        type: "swap",
        contractId: "CBLEND",
        tokenIn: "CASSETXLM",
        tokenOut: "CASSETUSDC",
        amountIn: "1000000000",
        amountOut: "250000000",
      },
      {
        id: "swap-2",
        parentId: "swap-1",
        type: "swap",
        contractId: "CBLEND",
        tokenIn: "CASSETUSDC",
        tokenOut: "CASSETXLM",
        amountIn: "250000000",
        amountOut: "1005000000",
      },
      {
        id: "repay-1",
        parentId: "borrow-1",
        type: "flash_repay",
        asset: "CASSETXLM",
        amount: "1000500000",
        fee: "5000000",
        contractId: "CBLEND",
      },
    ];

    const tree = buildFlashLoanOperationTree(operations);
    expect(tree.length).toBeGreaterThan(0);
    expect(tree[0].children.length).toBeGreaterThan(0);

    const alert = detectFlashLoanInTransaction("tx-flash-1", operations, 1200);
    expect(alert).not.toBeNull();
    expect(alert?.borrowedAsset).toBe("CASSETXLM");
    expect(alert?.borrowedAmount).toBe("100");
    expect(alert?.feeAmount).toBe("0.5");
    expect(Number(alert?.netArbitrageProfit)).toBeGreaterThan(0);
  });

  it("emits borrowed asset, fee amount, and net arbitrage profit in the alert payload", () => {
    const events = [
      {
        contractId: "CBLEND",
        topic: ["borrow"],
        txHash: "tx-profit-1",
        ledger: 1500,
        value: { asset: "CASSETXLM", amount: "2000000000" },
      },
      {
        contractId: "CBLEND",
        topic: ["swap"],
        txHash: "tx-profit-1",
        ledger: 1500,
        value: {
          token_in: "CASSETXLM",
          token_out: "CASSETUSDC",
          amount_in: "2000000000",
          amount_out: "500000000",
        },
      },
      {
        contractId: "CBLEND",
        topic: ["repay"],
        txHash: "tx-profit-1",
        ledger: 1500,
        value: {
          asset: "CASSETXLM",
          amount: "2010000000",
          fee: "10000000",
          profit: "5000000",
        },
      },
    ];

    const alert = flashLoanDetector.detectFromEvents(events, "tx-profit-1", 1500);

    expect(alert).not.toBeNull();
    expect(alert?.borrowedAsset).toBe("CASSETXLM");
    expect(alert?.borrowedAmount).toBe("200");
    expect(alert?.feeAmount).toBe("1");
    expect(alert?.netArbitrageProfit).toBe("0.5");
  });

  it("returns null when repay is missing for a borrow within the transaction tree", () => {
    const alert = detector.detect({
      txHash: "tx-incomplete",
      operations: [
        {
          id: "borrow-1",
          type: "borrow",
          asset: "CASSETXLM",
          amount: "1000000000",
          contractId: "CBLEND",
        },
      ],
    });

    expect(alert).toBeNull();
  });

  it("returns null when repay amount is less than borrow amount", () => {
    const alert = detector.detect({
      txHash: "tx-undercollateralized",
      operations: [
        {
          id: "borrow-1",
          type: "borrow",
          asset: "CASSETXLM",
          amount: "1000000000",
          contractId: "CBLEND",
        },
        {
          id: "repay-1",
          type: "repay",
          asset: "CASSETXLM",
          amount: "900000000",
          contractId: "CBLEND",
        },
      ],
    });

    expect(alert).toBeNull();
  });
});

describe("StakingRewardTracker & parseStakingRewardEvent (#212)", () => {
  it("parses staking reward emission events from Soroban topic logs", () => {
    const rawEvent = {
      contractId: "CPOOLSTAKE",
      topic: ["distribute"],
      value: {
        account: "GACCOUNT123",
        reward_token: "CREWARDTOKEN",
        pool_contract_id: "CPOOLSTAKE",
        amount: "100000000",
        epoch: 42,
      },
      ledger: 5000,
      txHash: "tx-reward-1",
    };

    const parsed = parseStakingRewardEvent(rawEvent);

    expect(parsed).not.toBeNull();
    expect(parsed?.account).toBe("GACCOUNT123");
    expect(parsed?.rewardToken).toBe("CREWARDTOKEN");
    expect(parsed?.poolContractId).toBe("CPOOLSTAKE");
    expect(parsed?.amount).toBe("10");
    expect(parsed?.epoch).toBe(42);
    expect(parsed?.ledgerSeq).toBe(5000);
    expect(parsed?.txHash).toBe("tx-reward-1");
  });

  it("returns null for events with non-reward topics or non-positive amounts", () => {
    const nonRewardEvent = {
      contractId: "CPOOLSTAKE",
      topic: ["unknown_action"],
      value: { account: "GACCOUNT123", amount: "10000000" },
    };
    expect(parseStakingRewardEvent(nonRewardEvent)).toBeNull();

    const zeroAmountEvent = {
      contractId: "CPOOLSTAKE",
      topic: ["reward"],
      value: { account: "GACCOUNT123", amount: "0" },
    };
    expect(parseStakingRewardEvent(zeroAmountEvent)).toBeNull();
  });

  it("aggregates cumulative LP yield emissions per account across Soroban liquidity pools", () => {
    const tracker = new StakingRewardTracker();

    const event1 = {
      contractId: "CPOOL-A",
      topic: ["yield_distribution"],
      value: {
        account: "GACCOUNT-ALICE",
        reward_token: "CREWARD-X",
        pool_contract_id: "CPOOL-A",
        amount: "50000000", // 5.0
      },
    };

    const event2 = {
      contractId: "CPOOL-B",
      topic: ["distribute"],
      value: {
        account: "GACCOUNT-ALICE",
        reward_token: "CREWARD-X",
        pool_contract_id: "CPOOL-B",
        amount: "30000000", // 3.0
      },
    };

    const batch = tracker.processEventBatch([event1, event2]);

    expect(batch.length).toBe(2);
    expect(batch[0].poolCumulativeAmount).toBe("5");
    expect(batch[1].poolCumulativeAmount).toBe("3");

    // Account cumulative across pools
    expect(tracker.getCumulativeYield("GACCOUNT-ALICE", "CREWARD-X")).toBe("8");
    // Pool cumulative specifically
    expect(tracker.getCumulativeYieldByPool("GACCOUNT-ALICE", "CPOOL-A", "CREWARD-X")).toBe("5");
    expect(tracker.getCumulativeYieldByPool("GACCOUNT-ALICE", "CPOOL-B", "CREWARD-X")).toBe("3");
  });
});

