import { beforeEach, describe, expect, test, vi } from "vitest";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret-for-auth-tests-0123456789";

const selectMock = vi.hoisted(() => vi.fn());
const schemaMock = vi.hoisted(() => ({
  changeoverSessionsTable: { id: { name: "id" }, operatorId: { name: "operatorId" } },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("@workspace/db/schema", () => schemaMock);

import {
  attachActor,
  requireOperatorSessionOwnership,
  requireSessionReadAccess,
} from "../auth";

function createReq(overrides: Record<string, unknown> = {}) {
  return {
    cookies: {},
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides,
  } as any;
}

function createRes() {
  return {
    statusCode: 200,
    json: vi.fn(),
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
  } as any;
}

function signToken(payload: object, expiresIn: jwt.SignOptions["expiresIn"] = "1h") {
  // verifyAccessToken now requires a jti claim; inject one so valid-token cases pass.
  return jwt.sign({ jti: "test-jti", ...payload } as jwt.JwtPayload, process.env.JWT_SECRET || "test-secret", { expiresIn });
}

beforeEach(() => {
  selectMock.mockReset();
});

describe("auth middleware", () => {
  test("accepts valid JWT in httpOnly cookie", async () => {
    const req = createReq({
      cookies: {
        smt_token: signToken({ userId: "uuid-1", username: "Operator A", role: "operator" }),
      },
    });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.actor).toMatchObject({ userId: "uuid-1", id: "uuid-1", username: "Operator A", name: "Operator A", role: "operator" });
  });

  test("rejects request with no cookie → 401", () => {
    const req = createReq();
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects expired JWT → 401", () => {
    const req = createReq({
      cookies: {
        smt_token: signToken({ userId: 1, username: "Operator A", role: "operator" }, -10),
      },
    });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects tampered JWT signature → 401", () => {
    const token = signToken({ userId: "uuid-1", username: "Operator A", role: "operator" }) as string;
    const tampered = `${token.slice(0, -1)}x`;
    const req = createReq({ cookies: { smt_token: tampered } });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects JWT in Authorization header (not cookie) → 401", () => {
    const token = signToken({ userId: 1, username: "Operator A", role: "operator" });
    const req = createReq({ headers: { authorization: `Bearer ${token}` } });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects operatorId in request body → 401", () => {
    const req = createReq({ body: { operatorId: 999 } });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("sets req.actor with decoded payload on success", () => {
    const req = createReq({
      cookies: {
        smt_token: signToken({ userId: "uuid-2", username: "QA", role: "qa" }),
      },
    });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(req.actor).toEqual({ userId: "uuid-2", id: "uuid-2", username: "QA", name: "QA", role: "qa", mustChangePassword: false });
  });

  test("operator cannot access another operators session → 403", async () => {
    const req = createReq({
      cookies: {
        smt_token: signToken({ userId: "uuid-3", username: "Operator B", role: "operator" }),
      },
      body: { sessionId: 10 },
    });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);
    next.mockClear();
    selectMock.mockImplementationOnce(() => ({
      from: () => ({
        where: () => Promise.resolve([{ id: 10, operatorId: 2 }]),
      }),
    }));

    await requireOperatorSessionOwnership(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("QA role can access any session → 200", async () => {
    const req = createReq({
      actor: { userId: 1, id: 1, username: "QA", name: "QA", role: "qa" },
      params: { sessionId: "10" },
    });
    const res = createRes();
    const next = vi.fn();

    await requireSessionReadAccess(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  test("supervisor role can access any session → 200", async () => {
    const req = createReq({
      actor: { userId: 1, id: 1, username: "Supervisor", name: "Supervisor", role: "supervisor" },
      params: { sessionId: "10" },
    });
    const res = createRes();
    const next = vi.fn();

    await requireSessionReadAccess(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});