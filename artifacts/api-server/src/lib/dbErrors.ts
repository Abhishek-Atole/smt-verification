type DrizzleLikeError = {
  code?: string;
  message?: string;
  cause?: {
    code?: string;
    message?: string;
  };
};

export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as DrizzleLikeError;
  const message = `${candidate.message ?? ""} ${candidate.cause?.message ?? ""}`.toLowerCase();
  const code = candidate.code ?? candidate.cause?.code;

  return code === "42P01" || message.includes('relation "') && message.includes("does not exist");
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as DrizzleLikeError;
  const code = candidate.code ?? candidate.cause?.code;
  return code === "23505";
}