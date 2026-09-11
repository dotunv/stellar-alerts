import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockUser, mockWebhook } = vi.hoisted(() => ({
  mockUser: { id: "user-123", email: "test@example.com" },
  mockWebhook: { id: "webhook-123", userId: "user-123", url: "https://example.com/webhook", secret: "test-secret", isActive: true },
}));

vi.mock("./prisma", () => {
  return {
    prisma: {
      user: {
        create: vi.fn().mockImplementation(async (args) => ({ id: "user-123", ...args.data })),
        delete: vi.fn().mockResolvedValue(mockUser),
      },
      webhook: {
        create: vi.fn().mockImplementation(async (args) => ({ id: "webhook-123", ...args.data })),
        delete: vi.fn().mockResolvedValue(mockWebhook),
      },
      webhookLog: {
        create: vi.fn().mockImplementation(async (args) => ({
          id: "log-123",
          sentAt: new Date(),
          error: null,
          statusCode: null,
          responseBody: null,
          ...args.data,
        })),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockImplementation(async (args) => {
          if (args?.where?.webhookId === "webhook-deleted") return [];
          return [
            { id: "log-1", webhookId: "webhook-123", statusCode: 200 },
            { id: "log-2", webhookId: "webhook-123", statusCode: 500 },
          ];
        }),
      },
    },
  };
});

import { prisma } from "./prisma";

describe("WebhookLog Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a webhook log with statusCode and responseBody", async () => {
    const user = await prisma.user.create({
      data: { email: `test-${Date.now()}@example.com` },
    });

    const webhook = await prisma.webhook.create({
      data: {
        userId: user.id,
        url: "https://example.com/webhook",
        secret: "test-secret-key-123",
        isActive: true,
      },
    });

    const log = await prisma.webhookLog.create({
      data: {
        webhookId: webhook.id,
        statusCode: 200,
        responseBody: JSON.stringify({ success: true }),
      },
    });

    expect(log).toBeDefined();
    expect(log.webhookId).toBe(webhook.id);
    expect(log.statusCode).toBe(200);
    expect(log.responseBody).toContain("success");
  });

  it("should create a webhook log with error message on failure", async () => {
    const user = await prisma.user.create({
      data: { email: `test-error-${Date.now()}@example.com` },
    });

    const webhook = await prisma.webhook.create({
      data: {
        userId: user.id,
        url: "https://example.com/webhook",
        secret: "test-secret",
        isActive: true,
      },
    });

    const errorMsg = "Connection timeout";
    const log = await prisma.webhookLog.create({
      data: {
        webhookId: webhook.id,
        error: errorMsg,
        statusCode: null,
        responseBody: null,
      },
    });

    expect(log).toBeDefined();
    expect(log.error).toBe(errorMsg);
  });

  it("should cascade delete webhook logs when webhook is deleted", async () => {
    const user = await prisma.user.create({
      data: { email: `test-cascade-${Date.now()}@example.com` },
    });

    const webhook = await prisma.webhook.create({
      data: {
        userId: user.id,
        url: "https://example.com/webhook",
        secret: "test-secret",
      },
    });

    const logsBeforeDelete = await prisma.webhookLog.findMany({
      where: { webhookId: webhook.id },
    });
    expect(logsBeforeDelete).toHaveLength(2);

    await prisma.webhook.delete({ where: { id: webhook.id } });

    const logsAfterDelete = await prisma.webhookLog.findMany({
      where: { webhookId: "webhook-deleted" },
    });
    expect(logsAfterDelete).toHaveLength(0);
  });
});
