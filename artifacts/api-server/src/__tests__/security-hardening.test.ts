import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

// These tests exercise the SHIPPED auth routes through the real request
// pipeline (CSRF header guard, rate limiters, attachActor) with a mocked DB.
// They assert the security properties the code actually provides, not a
// hypothetical contract.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
// getJwtSecret() requires ≥32 chars.
process.env.JWT_SECRET = "api-server-security-test-secret-0123456789";
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://localhost:3000";
process.env.NODE_ENV = "development";

const XHR = "XMLHttpRequest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  execute: vi.fn(),
  auditLog: vi.fn().mockResolvedValue(undefined),
  parseCsvBuffer: vi.fn(),
  parseExcelBuffer: vi.fn(),
  buildProgramInsertValues: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    query: { usersTable: { findFirst: mocks.findFirst } },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
      })),
    })),
    update: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
    execute: mocks.execute,
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/auditLogger", () => ({ auditLog: mocks.auditLog }));

vi.mock("../lib/importProcessor", () => ({
  parseCsvBuffer: mocks.parseCsvBuffer,
  parseExcelBuffer: mocks.parseExcelBuffer,
  buildProgramInsertValues: mocks.buildProgramInsertValues,
}));

const app = (await import("../app")).default;
const { logger } = await import("../lib/logger");

app.set("trust proxy", 1);

const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger as never);
const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger as never);
const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger as never);

function stringifyCalls(calls: unknown[][]): string {
  return calls
    .map((call) =>
      call
        .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
        .join(" "),
    )
    .join("\n");
}

function makeAuthCookie(
  role: "operator" | "qa" | "supervisor" | "admin" = "operator",
) {
  const userId = randomUUID();
  const token = jwt.sign(
    { userId, username: `${role}-user`, name: `${role}-user`, role, jti: randomUUID() },
    process.env.JWT_SECRET as string,
    { expiresIn: "8h" },
  );
  return { token, cookie: `smt_token=${token}`, userId };
}

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.execute.mockReset();
  mocks.auditLog.mockClear();
  mocks.parseCsvBuffer.mockReset();
  mocks.parseExcelBuffer.mockReset();
  mocks.buildProgramInsertValues.mockReset();
  infoSpy.mockClear();
  warnSpy.mockClear();
  errorSpy.mockClear();
});

describe("login handler hardening", () => {
  test("successful login never leaks the password hash into logs", async () => {
    const passwordHash = await bcrypt.hash("operator123", 4);

    // login() runs two db.execute() calls: column introspection, then the
    // user row lookup (raw SQL with AS display_name / AS username / AS password_hash).
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          { column_name: "id" },
          { column_name: "username" },
          { column_name: "name" },
          { column_name: "role" },
          { column_name: "password_hash" },
          { column_name: "is_active" },
          { column_name: "must_change_password" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: randomUUID(),
            username: "operator1",
            display_name: "Operator One",
            role: "operator",
            password_hash: passwordHash,
            is_active: true,
            must_change_password: false,
          },
        ],
      });

    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .set("X-Requested-With", XHR)
      .send({ username: "operator1", password: "operator123", role: "operator" });

    expect(response.status).toBe(200);

    const logText = stringifyCalls([
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ] as unknown[][]);
    expect(logText).not.toContain(passwordHash);
    expect(logText).not.toContain("password_hash");
    expect(logText).not.toContain("passwordHash");
  });

  test("rejects a state-changing login without the X-Requested-With header (CSRF guard)", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ username: "operator1", password: "operator123", role: "operator" });

    expect(response.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
describe("verify-override approval (step-up password check)", () => {
  test("approves with a valid password for the requested role", async () => {
    const passwordHash = await bcrypt.hash("qa-approve", 4);
    const { cookie } = makeAuthCookie("operator");

    mocks.findFirst.mockResolvedValue({
      id: randomUUID(),
      name: "QA One",
      username: "qa1",
      role: "qa",
      password_hash: passwordHash,
    });

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Requested-With", XHR)
      .set("X-Forwarded-For", "203.0.113.20")
      .send({ password: "qa-approve", role: "qa" });

    expect(response.status).toBe(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.approverName).toBe("QA One");
    expect(response.body.approverRole).toBe("qa");
    expect(mocks.auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "SCAN_VERIFIED" }),
    );
  });

  test("rejects when no user holds the requested approver role", async () => {
    const { cookie } = makeAuthCookie("operator");
    mocks.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Requested-With", XHR)
      .set("X-Forwarded-For", "203.0.113.21")
      .send({ password: "qa-approve", role: "qa" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid credentials" });
  });

  test("rejects a wrong password for the approver role", async () => {
    const { cookie } = makeAuthCookie("operator");
    mocks.findFirst.mockResolvedValue({
      id: randomUUID(),
      name: "Supervisor One",
      username: "sup1",
      role: "supervisor",
      password_hash: await bcrypt.hash("correct-password", 4),
    });

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Requested-With", XHR)
      .set("X-Forwarded-For", "203.0.113.22")
      .send({ password: "wrong-password", role: "supervisor" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid credentials" });
  });

  test("rejects an invalid approver role with 400", async () => {
    const { cookie } = makeAuthCookie("operator");

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Requested-With", XHR)
      .set("X-Forwarded-For", "203.0.113.23")
      .send({ password: "whatever", role: "operator" });

    expect(response.status).toBe(400);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  test("shares the login rate-limit bucket (429 after repeated attempts from one IP)", async () => {
    const { cookie } = makeAuthCookie("operator");
    mocks.findFirst.mockResolvedValue(null);

    let sawLimit = false;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/verify-override")
        .set("Cookie", cookie)
        .set("X-Requested-With", XHR)
        .set("X-Forwarded-For", "203.0.113.99")
        .send({ password: "wrong-password", role: "qa" });
      if (response.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });

  test("rejects verify-override without the X-Requested-With header (CSRF guard)", async () => {
    const { cookie } = makeAuthCookie("operator");

    const response = await request(app)
      .post("/api/auth/verify-override")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", "203.0.113.24")
      .send({ password: "qa-approve", role: "qa" });

    expect(response.status).toBe(403);
  });
});
