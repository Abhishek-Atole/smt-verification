import { beforeEach, describe, expect, test, vi } from "vitest";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret-for-auth-tests";

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
  return jwt.sign(payload as jwt.JwtPayload, process.env.JWT_SECRET || "test-secret", { expiresIn });
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
    expect(req.actor).toMatchObject({ userId: 1, id: 1, username: "Operator A", name: "Operator A", role: "operator" });
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
        smt_token: signToken({ userId: 2, username: "QA", role: "qa" }),
      },
    });
    const res = createRes();
    const next = vi.fn();

    attachActor(req, res, next);

    expect(req.actor).toEqual({ userId: 2, id: 2, username: "QA", name: "QA", role: "qa" });
  });

  test("operator cannot access another operators session → 403", async () => {
    const req = createReq({
      cookies: {
        smt_token: signToken({ userId: 3, username: "Operator B", role: "operator" }),
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

  test("engineer role can access any session → 200", async () => {
    const req = createReq({
      actor: { userId: 1, id: 1, username: "Engineer", name: "Engineer", role: "engineer" },
      params: { sessionId: "10" },
    });
    const res = createRes();
    const next = vi.fn();

    await requireSessionReadAccess(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});