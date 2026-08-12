import { describe, expect, test, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { requireXmlHttpRequest } from "../csrf";

function mockReq(method: string, headers: Record<string, string> = {}): Request {
  return {
    method,
    get(name: string) {
      return headers[name];
    },
  } as unknown as Request;
}

function mockRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe("requireXmlHttpRequest (PRD §2.8)", () => {
  test("GET passes without the header (safe method)", () => {
    const { res, status } = mockRes();
    const next: NextFunction = vi.fn();
    requireXmlHttpRequest(mockReq("GET"), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  test("HEAD passes without the header", () => {
    const { res, status } = mockRes();
    const next: NextFunction = vi.fn();
    requireXmlHttpRequest(mockReq("HEAD"), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  test("OPTIONS (CORS preflight) passes without the header", () => {
    const { res, status } = mockRes();
    const next: NextFunction = vi.fn();
    requireXmlHttpRequest(mockReq("OPTIONS"), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  test("POST without X-Requested-With returns 403 csrf_header_missing", () => {
    const { res, status, json } = mockRes();
    const next: NextFunction = vi.fn();
    requireXmlHttpRequest(mockReq("POST"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "csrf_header_missing" }));
  });

  test("POST with X-Requested-With: XMLHttpRequest passes through", () => {
    const { res, status } = mockRes();
    const next: NextFunction = vi.fn();
    requireXmlHttpRequest(mockReq("POST", { "X-Requested-With": "XMLHttpRequest" }), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  test("POST with wrong X-Requested-With value still 403s", () => {
    const { res, status, json } = mockRes();
    const next: NextFunction = vi.fn();
    requireXmlHttpRequest(mockReq("POST", { "X-Requested-With": "fetch" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "csrf_header_missing" }));
  });

  test("PATCH/PUT/DELETE all require the header", () => {
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const { res, status } = mockRes();
      const next: NextFunction = vi.fn();
      requireXmlHttpRequest(mockReq(method), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(403);
    }
  });
});
