export function roleMatches(allowed: string, actual: string): boolean {
  if (allowed === actual) return true;
  if ((allowed === "engineer" && actual === "supervisor") || (allowed === "supervisor" && actual === "engineer")) return true;
  return false;
}

export function hasAnyRole(actual: string | undefined, allowed: string[]): boolean {
  if (!actual) return false;
  return allowed.some((a) => roleMatches(a, actual));
}

export function isPrivilegedRole(role: string | undefined): boolean {
  return hasAnyRole(role, ["qa", "engineer", "admin"]);
}

export function isAdminOrEngineer(role: string | undefined): boolean {
  return hasAnyRole(role, ["engineer", "admin"]);
}
