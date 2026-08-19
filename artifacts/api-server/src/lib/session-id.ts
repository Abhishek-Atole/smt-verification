// Canonical SMT changeover ID derived from a session's start date + numeric
// sequence, e.g. SMT_20260819_000028. Splice records for legacy sessions are
// keyed by this string, so both the sessions router (which writes them) and the
// verification/QA router (which reads them for 200% review) must derive it
// identically — hence this shared helper.
export function formatSmtSessionId(
  sourceDate: Date | string | null | undefined,
  sequence: number,
): string {
  const date = sourceDate ? new Date(sourceDate) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const seq = String(sequence).padStart(6, "0");
  return `SMT_${y}${m}${d}_${seq}`;
}
