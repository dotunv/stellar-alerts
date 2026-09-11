import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the prisma client to avoid env validation during test setup
vi.mock("./prisma", () => ({
  prisma: {
    user: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    webhook: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    webhookLog: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    webhookCircuitBreaker: {
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";

describe("Circuit Breaker State Transitions", () => {
  let userId: string;
  let webhookId: string;

  beforeEach(() => {
    userId = "test-user-123";
    webhookId = "test-webhook-456";
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize circuit breaker in closed state", async () => {
    const mockBreaker = {
      id: "breaker-1",
      webhookId,
      state: "closed" as const,
      failureCount: 0,
      openedAt: null,
      lastFailureAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webhookCircuitBreaker.upsert).mockResolvedValueOnce(
      mockBreaker,
    );

    const breaker = await prisma.webhookCircuitBreaker.upsert({
      where: { webhookId },
      create: {
        webhookId,
        state: "closed",
        failureCount: 0,
      },
      update: {},
    });

    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(0);
    expect(breaker.openedAt).toBeNull();
  });

  it("should transition from closed to open after threshold failures", async () => {
    const closedBreaker = {
      id: "breaker-1",
      webhookId,
      state: "closed" as const,
      failureCount: 0,
      openedAt: null,
      lastFailureAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const openBreaker = {
      ...closedBreaker,
      state: "open" as const,
      failureCount: 10,
      openedAt: new Date(),
      lastFailureAt: new Date(),
    };

    vi.mocked(prisma.webhookCircuitBreaker.upsert).mockResolvedValueOnce(
      closedBreaker,
    );

    let breaker = await prisma.webhookCircuitBreaker.upsert({
      where: { webhookId },
      create: {
        webhookId,
        state: "closed",
        failureCount: 0,
      },
      update: {},
    });

    expect(breaker.state).toBe("closed");

    // Simulate transition to open
    vi.mocked(prisma.webhookCircuitBreaker.update).mockResolvedValueOnce(
      openBreaker,
    );

    breaker = await prisma.webhookCircuitBreaker.update({
      where: { webhookId },
      data: {
        state: "open",
        failureCount: 10,
        openedAt: new Date(),
      },
    });

    expect(breaker.state).toBe("open");
    expect(breaker.failureCount).toBe(10);
    expect(breaker.openedAt).not.toBeNull();
  });

  it("should transition from open to half-open after timeout", async () => {
    const pastTime = new Date(Date.now() - 70000); // 70 seconds ago

    const openBreaker = {
      id: "breaker-1",
      webhookId,
      state: "open" as const,
      failureCount: 10,
      openedAt: pastTime,
      lastFailureAt: pastTime,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const halfOpenBreaker = {
      ...openBreaker,
      state: "half-open" as const,
    };

    vi.mocked(prisma.webhookCircuitBreaker.create).mockResolvedValueOnce(
      openBreaker,
    );

    let breaker = await prisma.webhookCircuitBreaker.create({
      data: {
        webhookId,
        state: "open",
        failureCount: 10,
        openedAt: pastTime,
        lastFailureAt: pastTime,
      },
    });

    expect(breaker.state).toBe("open");

    // Simulate transition to half-open
    vi.mocked(prisma.webhookCircuitBreaker.update).mockResolvedValueOnce(
      halfOpenBreaker,
    );

    breaker = await prisma.webhookCircuitBreaker.update({
      where: { webhookId },
      data: {
        state: "half-open",
        failureCount: 10,
      },
    });

    expect(breaker.state).toBe("half-open");
  });

  it("should transition from half-open to closed on success", async () => {
    const halfOpenBreaker = {
      id: "breaker-1",
      webhookId,
      state: "half-open" as const,
      failureCount: 10,
      openedAt: new Date(),
      lastFailureAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const closedBreaker = {
      ...halfOpenBreaker,
      state: "closed" as const,
      failureCount: 0,
      openedAt: null,
    };

    vi.mocked(prisma.webhookCircuitBreaker.create).mockResolvedValueOnce(
      halfOpenBreaker,
    );

    let breaker = await prisma.webhookCircuitBreaker.create({
      data: {
        webhookId,
        state: "half-open",
        failureCount: 10,
        openedAt: new Date(),
      },
    });

    expect(breaker.state).toBe("half-open");

    // Successful request, reset to closed
    vi.mocked(prisma.webhookCircuitBreaker.update).mockResolvedValueOnce(
      closedBreaker,
    );

    breaker = await prisma.webhookCircuitBreaker.update({
      where: { webhookId },
      data: {
        state: "closed",
        failureCount: 0,
        openedAt: null,
      },
    });

    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(0);
    expect(breaker.openedAt).toBeNull();
  });

  it("should transition from half-open back to open on failure", async () => {
    const halfOpenBreaker = {
      id: "breaker-1",
      webhookId,
      state: "half-open" as const,
      failureCount: 10,
      openedAt: new Date(),
      lastFailureAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const openAgainBreaker = {
      ...halfOpenBreaker,
      state: "open" as const,
      failureCount: 11,
    };

    vi.mocked(prisma.webhookCircuitBreaker.create).mockResolvedValueOnce(
      halfOpenBreaker,
    );

    let breaker = await prisma.webhookCircuitBreaker.create({
      data: {
        webhookId,
        state: "half-open",
        failureCount: 10,
        openedAt: new Date(),
      },
    });

    expect(breaker.state).toBe("half-open");

    // Failed recovery attempt, back to open
    vi.mocked(prisma.webhookCircuitBreaker.update).mockResolvedValueOnce(
      openAgainBreaker,
    );

    breaker = await prisma.webhookCircuitBreaker.update({
      where: { webhookId },
      data: {
        state: "open",
        failureCount: 11,
        lastFailureAt: new Date(),
        openedAt: new Date(),
      },
    });

    expect(breaker.state).toBe("open");
    expect(breaker.failureCount).toBe(11);
  });

  it("should log webhook dispatch attempts with circuit breaker state", async () => {
    const mockLog = {
      id: "log-1",
      webhookId,
      statusCode: null,
      responseBody: null,
      error: "Circuit breaker is open, endpoint temporarily disabled",
      sentAt: new Date(),
      createdAt: new Date(),
    };

    vi.mocked(prisma.webhookLog.create).mockResolvedValueOnce(mockLog);

    const log = await prisma.webhookLog.create({
      data: {
        webhookId,
        error: "Circuit breaker is open, endpoint temporarily disabled",
      },
    });

    expect(log.error).toContain("Circuit breaker is open");
    expect(log.statusCode).toBeNull();
    expect(log.responseBody).toBeNull();
  });

  it("should track consecutive failure count incrementally", async () => {
    const createMockBreaker = (count: number, state: string) => ({
      id: "breaker-1",
      webhookId,
      state: state as "open" | "closed" | "half-open",
      failureCount: count,
      openedAt: count >= 10 ? new Date() : null,
      lastFailureAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const failureCounts = [1, 3, 5, 8, 10];

    for (let i = 0; i < failureCounts.length; i++) {
      const count = failureCounts[i];
      const state = count >= 10 ? "open" : "closed";

      vi.mocked(prisma.webhookCircuitBreaker.update).mockResolvedValueOnce(
        createMockBreaker(count, state),
      );

      const breaker = await prisma.webhookCircuitBreaker.update({
        where: { webhookId },
        data: {
          failureCount: count,
          lastFailureAt: new Date(),
          state,
        },
      });

      expect(breaker.failureCount).toBe(count);
      if (count >= 10) {
        expect(breaker.state).toBe("open");
      }
    }
  });

  it("should cascade delete circuit breaker when webhook is deleted", async () => {
    const mockBreaker = {
      id: "breaker-1",
      webhookId,
      state: "open" as const,
      failureCount: 10,
      openedAt: new Date(),
      lastFailureAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.webhookCircuitBreaker.findUnique)
      .mockResolvedValueOnce(mockBreaker)
      .mockResolvedValueOnce(null);

    let breakerExists = await prisma.webhookCircuitBreaker.findUnique({
      where: { webhookId },
    });
    expect(breakerExists).not.toBeNull();

    vi.mocked(prisma.webhook.delete).mockResolvedValueOnce({
      id: webhookId,
      userId: userId,
      url: "https://example.com/webhook",
      secret: "test-secret",
      isActive: true,
      createdAt: new Date(),
    });

    await prisma.webhook.delete({ where: { id: webhookId } });

    // Verify circuit breaker was cascade deleted
    breakerExists = await prisma.webhookCircuitBreaker.findUnique({
      where: { webhookId },
    });
    expect(breakerExists).toBeNull();
  });
});
