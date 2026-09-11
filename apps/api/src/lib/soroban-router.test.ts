import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./prisma", () => ({
  prisma: {
    sorobanContractSubscription: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";
import {
  loadContractRegistry,
  routeEventToUsers,
  getActiveContractIds,
  getContractSubscriberCount,
} from "./soroban";

describe("Soroban Multi-Contract Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should load contract registry from database", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-2",
        userId: "user-2",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-3",
        userId: "user-1",
        contractId: "CAA222",
        topic: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    const registry = await loadContractRegistry();

    expect(registry.size).toBe(2);
    expect(registry.has("CAA111")).toBe(true);
    expect(registry.has("CAA222")).toBe(true);
  });

  it("should route events to subscribed users by contract and topic", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-2",
        userId: "user-2",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    await loadContractRegistry();

    const mockEvent = {
      contractId: "CAA111",
      topic: ["transfer"],
      value: { from: "GAAA", to: "GBBB", amount: "1000" },
    };

    const routes = routeEventToUsers(mockEvent);

    expect(routes).toHaveLength(1);
    expect(routes[0].contractId).toBe("CAA111");
    expect(routes[0].topic).toBe("transfer");
    expect(routes[0].userIds).toContain("user-1");
    expect(routes[0].userIds).toContain("user-2");
    expect(routes[0].userIds).toHaveLength(2);
  });

  it("should fall back to default topic when exact topic not found", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: null, // default
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    await loadContractRegistry();

    const mockEvent = {
      contractId: "CAA111",
      topic: ["unknown_topic"],
      value: { from: "GAAA", to: "GBBB", amount: "1000" },
    };

    const routes = routeEventToUsers(mockEvent);

    expect(routes).toHaveLength(1);
    expect(routes[0].userIds).toContain("user-1");
  });

  it("should not route events from unsubscribed contracts", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    await loadContractRegistry();

    const mockEvent = {
      contractId: "CAA999",
      topic: ["transfer"],
      value: { from: "GAAA", to: "GBBB", amount: "1000" },
    };

    const routes = routeEventToUsers(mockEvent);

    expect(routes).toHaveLength(0);
  });

  it("should return active contract IDs", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-2",
        userId: "user-2",
        contractId: "CAA222",
        topic: "mint",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    await loadContractRegistry();

    const contractIds = getActiveContractIds();

    expect(contractIds).toHaveLength(2);
    expect(contractIds).toContain("CAA111");
    expect(contractIds).toContain("CAA222");
  });

  it("should return correct subscriber count per contract", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-2",
        userId: "user-2",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-3",
        userId: "user-3",
        contractId: "CAA111",
        topic: "mint",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    await loadContractRegistry();

    const count = getContractSubscriberCount("CAA111");

    expect(count).toBe(3);
  });

  it("should handle 100 active contracts efficiently", async () => {
    const mockSubscriptions = [];
    for (let i = 0; i < 100; i++) {
      mockSubscriptions.push({
        id: `sub-${i}`,
        userId: `user-${i}`,
        contractId: `CAA${String(i).padStart(6, "0")}`,
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    const start = performance.now();
    await loadContractRegistry();
    const loadTime = performance.now() - start;

    const contractIds = getActiveContractIds();
    expect(contractIds).toHaveLength(100);

    // Performance: Registry load should be sub-100ms
    expect(loadTime).toBeLessThan(100);

    // Routing should be very fast (O(1))
    const event = {
      contractId: "CAA000050",
      topic: ["transfer"],
    };

    const routeStart = performance.now();
    const routes = routeEventToUsers(event);
    const routeTime = performance.now() - routeStart;

    expect(routes).toHaveLength(1);
    expect(routeTime).toBeLessThan(5); // Sub-5ms routing
  });

  it("should handle multiple topics per contract", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-2",
        userId: "user-2",
        contractId: "CAA111",
        topic: "mint",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "sub-3",
        userId: "user-3",
        contractId: "CAA111",
        topic: "burn",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    await loadContractRegistry();

    // Test transfer topic
    let routes = routeEventToUsers({
      contractId: "CAA111",
      topic: ["transfer"],
    });
    expect(routes[0].userIds).toEqual(["user-1"]);

    // Test mint topic
    routes = routeEventToUsers({
      contractId: "CAA111",
      topic: ["mint"],
    });
    expect(routes[0].userIds).toEqual(["user-2"]);

    // Test burn topic
    routes = routeEventToUsers({
      contractId: "CAA111",
      topic: ["burn"],
    });
    expect(routes[0].userIds).toEqual(["user-3"]);
  });

  it("should handle missing contract ID in event gracefully", async () => {
    const mockSubscriptions = [
      {
        id: "sub-1",
        userId: "user-1",
        contractId: "CAA111",
        topic: "transfer",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.mocked(prisma.sorobanContractSubscription.findMany).mockResolvedValueOnce(
      mockSubscriptions
    );

    await loadContractRegistry();

    const event = {
      contractId: null,
      topic: ["transfer"],
    };

    const routes = routeEventToUsers(event);

    expect(routes).toHaveLength(0);
  });
});
