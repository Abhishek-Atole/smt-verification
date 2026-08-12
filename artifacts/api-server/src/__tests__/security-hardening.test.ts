import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET = "api-server-security-test-secret";
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.MANUAL_MODE_PASSWORD = "manual-mode-secret";
process.env.NODE_ENV = "development";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  auditLog: vi.fn().mockResolvedValue(undefined),
  parseCsvBuffer: vi.fn(),
  parseExcelBuffer: vi.fn(),
  handleUpload: vi.fn(),
  buildProgramInsertValues: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    query: {
      usersTable: {
        findFirst: mocks.findFirst,
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/auditLogger", () => ({
  auditLog: mocks.auditLog,
}));

vi.mock("../lib/importProcessor", () => ({
  parseCsvBuffer: mocks.parseCsvBuffer,
  parseExcelBuffer: mocks.parseExcelBuffer,
  buildProgramInsertValues: mocks.buildProgramInsertValues,
}));

vi.mock("../middleware/upload", () => ({
  handleUpload: mocks.handleUpload,
}));

const app = (await import("../app")).default;
const { logger } = await import("../lib/logger");

app.set("trust proxy", 1);

const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

function makeAuthCookie(role: "operator" | "qa" | "engineer" | "admin", userId = randomUUID()) {
  const token = jwt.sign(
    {
      userId,
      username: `${role}-user`,
      role,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "8h" },
  );

  return { token, cookie: `smt_token=${token}`, userId };
}

function stringifyCalls(calls: unknown[][]): string {
  return calls
    .map((call) =>
      call
        .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
        .join(" "),
    )
    .join("\n");
}

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.auditLog.mockClear();
  mocks.parseCsvBuffer.mockReset();
  mocks.parseExcelBuffer.mockReset();
  mocks.handleUpload.mockReset();
  mocks.buildProgramInsertValues.mockReset();
  infoSpy.mockClear();
  warnSpy.mockClear();
  errorSpy.mockClear();
});

describe("api-server auth hardening", () => {
  test("login handler does not log password hash details", async () => {
    const passwordHash = await bcrypt.hash("operator123", 4);

    mocks.findFirst.mockResolvedValue({
      id: randomUUID(),
      username: "operator1",
      role: "operator",
      password: passwordHash,
    });

    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ username: "operator1", password: "operator123", role: "operator" });

    expect(response.status).toBe(200);

    const logText = stringifyCalls(infoSpy.mock.calls as unknown[][]);
    expect(logText).not.toContain("passwordHash");
    expect(logText).not.toContain("pwdHash");
    expect(logText).not.toContain("pwdLen");
    expect(logText).toContain("login succeeded");
  });

  test("manual mode verification returns valid true for the configured password", async () => {
    const { cookie } = makeAuthCookie("operator");

    const response = await request(app)
      .post("/api/auth/verify-manual-mode")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ password: "manual-mode-secret" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: true });
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "MANUAL_MODE_SUCCESS",
      }),
    );
  });

  test("manual mode verification returns valid false for a wrong password", async () => {
    const { cookie } = makeAuthCookie("operator");

    const response = await request(app)
      .post("/api/auth/verify-manual-mode")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ password: "wrong-password" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: false });
  });

  test("manual mode verification requires auth", async () => {
    const response = await request(app)
      .post("/api/auth/verify-manual-mode")
      .set("X-Forwarded-For", "203.0.113.12")
      .send({ password: "manual-mode-secret" });

    expect(response.status).toBe(401);
  });

  test("manual mode verification is rate limited on the 6th attempt", async () => {
    const { cookie } = makeAuthCookie("operator");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/verify-manual-mode")
        .set("Cookie", cookie)
        .set("X-Forwarded-For", "203.0.113.13")
        .send({ password: "wrong-password" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ valid: false });
    }

    const limited = await request(app)
      .post("/api/auth/verify-manual-mode")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.13")
      .send({ password: "wrong-password" });

    expect(limited.status).toBe(429);
  });
});

describe("verify-override approval", () => {
  test("requires a specific approver id and matching password", async () => {
    const approverId = randomUUID();
    const sessionId = randomUUID();
    const passwordHash = await bcrypt.hash("qa-approve", 4);
    const { cookie } = makeAuthCookie("operator");

    mocks.findFirst.mockResolvedValue({
      id: approverId,
      username: "qa1",
      role: "qa",
      password: passwordHash,
    });

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.20")
      .send({
        password: "qa-approve",
        role: "qa",
        approverId,
        sessionId,
      });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.approverId).toBe(approverId);
    expect(response.body.approvalTimestamp).toBeTruthy();
    expect(response.body.expiresAt).toBeTruthy();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "SCAN_VERIFIED",
        sessionId,
      }),
    );
  });

  test("rejects a wrong approver uuid", async () => {
    const { cookie } = makeAuthCookie("operator");

    mocks.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.21")
      .send({
        password: "qa-approve",
        role: "qa",
        approverId: randomUUID(),
        sessionId: randomUUID(),
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid credentials" });
  });

  test("rejects a wrong password for the specific approver", async () => {
    const approverId = randomUUID();
    const { cookie } = makeAuthCookie("operator");

    mocks.findFirst.mockResolvedValue({
      id: approverId,
      username: "engineer1",
      role: "engineer",
      password: await bcrypt.hash("correct-password", 4),
    });

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.22")
      .send({
        password: "wrong-password",
        role: "supervisor",
        approverId,
        sessionId: randomUUID(),
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid credentials" });
  });

  test("rejects role mismatch even when the password is valid", async () => {
    const approverId = randomUUID();
    const { cookie } = makeAuthCookie("operator");

    mocks.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.23")
      .send({
        password: "qa-approve",
        role: "qa",
        approverId,
        sessionId: randomUUID(),
      });

    expect(response.status).toBe(401);
  });

  test("is rate limited on the 6th attempt", async () => {
    const approverId = randomUUID();
    const sessionId = randomUUID();
    const { cookie } = makeAuthCookie("operator");

    mocks.findFirst.mockResolvedValue({
      id: approverId,
      username: "qa1",
      role: "qa",
      password: await bcrypt.hash("correct-password", 4),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/verify-override")
        .set("Cookie", cookie)
        .set("X-Forwarded-For", "203.0.113.24")
        .send({
          password: "wrong-password",
          role: "qa",
          approverId,
          sessionId,
        });

      expect(response.status).toBe(401);
    }

    const limited = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.24")
      .send({
        password: "wrong-password",
        role: "qa",
        approverId,
        sessionId,
      });

    expect(limited.status).toBe(429);
  });
});
