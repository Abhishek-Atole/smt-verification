import { beforeEach, describe, expect, test, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());
const schemaMock = vi.hoisted(() => ({
  changeoverSessionsTable: { id: { name: "id" }, bomId: { name: "bomId" } },
  bomItemsTable: { feederNumber: { name: "feederNumber" }, bomId: { name: "bomId" } },
  feederScansTable: { feederNumber: { name: "feederNumber" }, sessionId: { name: "sessionId" }, status: { name: "status" } },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@workspace/db/schema", () => schemaMock);

import { getSessionProgress } from "../verificationService";

function mockProgressSequence(sessionResponse: unknown, totalResponse: unknown, verifiedResponse: unknown) {
  selectMock
    .mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve(sessionResponse),
      }),
    }))
    .mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve(totalResponse),
      }),
    }))
    .mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve(verifiedResponse),
      }),
    }));
}

describe("getSessionProgress", () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  test("0% when no feeders scanned", async () => {
    mockProgressSequence([], [{ count: 0 }], [{ count: 0 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 0, total: 0, percent: 0 });
  });

  test("50% when half of feeders verified", async () => {
    mockProgressSequence([{ bomId: 10 }], [{ count: 4 }], [{ count: 2 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 2, total: 4, percent: 50 });
  });

  test("100% when all feeders verified", async () => {
    mockProgressSequence([{ bomId: 10 }], [{ count: 8 }], [{ count: 8 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 8, total: 8, percent: 100 });
  });

  test("does not double-count a feeder scanned twice", async () => {
    mockProgressSequence([{ bomId: 10 }], [{ count: 1 }], [{ count: 1 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 1, total: 1, percent: 100 });
  });

  test("failed scans do not count toward progress", async () => {
    mockProgressSequence([{ bomId: 10 }], [{ count: 4 }], [{ count: 1 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 1, total: 4, percent: 25 });
  });

  test("duplicate scans do not count toward progress", async () => {
    mockProgressSequence([{ bomId: 10 }], [{ count: 4 }], [{ count: 2 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 2, total: 4, percent: 50 });
  });

  test("total = distinct feeder numbers in BOM not scan count", async () => {
    mockProgressSequence([{ bomId: 10 }], [{ count: 8 }], [{ count: 2 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 2, total: 8, percent: 25 });
  });

  test("counts feeder as done if ANY alternate is scanned", async () => {
    mockProgressSequence([{ bomId: 10 }], [{ count: 2 }], [{ count: 1 }]);

    await expect(getSessionProgress("1")).resolves.toEqual({ verified: 1, total: 2, percent: 50 });
  });
});