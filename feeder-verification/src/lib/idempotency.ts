import { prisma } from "./prisma";

export interface IdempotencyQuery {
  eventType: string;
  idempotencyKey: string;
  userId: string;
  changeoverId?: string;
}

export async function findIdempotencyAudit(query: IdempotencyQuery) {
  const { eventType, idempotencyKey, userId, changeoverId } = query;

  // Try to find an existing audit log with the idempotency key
  const existing = await prisma.auditLog.findFirst({
    where: {
      eventType,
      userId,
      changeoverId: changeoverId || null,
      payload: {
        path: ["idempotencyKey"],
        equals: idempotencyKey,
      },
    },
    orderBy: {
      occurredAt: "desc",
    },
  });

  return existing || null;
}

export async function createIdempotencyAudit(query: IdempotencyQuery & { payload: Record<string, unknown> }) {
  const { eventType, idempotencyKey, userId, changeoverId, payload } = query;

  return prisma.auditLog.create({
    data: {
      eventType,
      userId,
      changeoverId: changeoverId || undefined,
      payload: {
        ...payload,
        idempotencyKey,
      },
    },
  });
}
