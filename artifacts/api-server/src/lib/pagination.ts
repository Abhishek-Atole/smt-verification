import type { Request } from "express";

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginate<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResponse<T> {
  const pages = Math.ceil(total / params.limit);
  return {
    data,
    total,
    page: params.page,
    limit: params.limit,
    pages,
    hasNext: params.page < pages,
    hasPrev: params.page > 1,
  };
}
