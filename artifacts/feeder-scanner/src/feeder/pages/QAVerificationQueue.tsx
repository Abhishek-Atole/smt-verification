import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppLogo } from "@/components/AppLogo";
import { formatSmtSessionCode } from "@/lib/session-code";
import { Loader2, Search, ChevronRight, AlertCircle, Clock, CheckCircle2, XCircle } from "lucide-react";
import { format, differenceInMinutes } from "date-fns";

interface QASession {
  id: string;
  operatorId: string;
  operatorName: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  qaVerifiedById: string | null;
  qaVerifiedAt: string | null;
  qaDiscrepancyFound: boolean | null;
  qaLockExpiresAt: string | null;
  bomId: number;
  bomName: string | null;
  verificationMode: string | null;
  totalScans: number;
  pendingQa: number;
}

function PriorityIndicator({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const mins = differenceInMinutes(now, new Date(startedAt));
  if (mins > 60) {
    return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs font-mono font-semibold"><AlertCircle className="w-3 h-3" />{mins}m</span>;
  }
  if (mins > 30) {
    return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs font-mono font-semibold"><Clock className="w-3 h-3" />{mins}m</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs font-mono">{mins}m</span>;
}

function StatusBadge({ status, discrepancyFound }: { status: string; discrepancyFound?: boolean | null }) {
  const map: Record<string, { label: string; className: string }> = {
    pending_qa: { label: "Pending QA", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    qa_in_review: { label: "QA In Review", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
    splicing_pending_qa: { label: "Splicing QA (200%)", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
    qa_confirmed: { label: discrepancyFound ? "QA Confirmed (Disc.)" : "QA Confirmed", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    incomplete: { label: "Incomplete", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  };
  const s = map[status] ?? { label: status, className: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300" };
  return (
    <span className={`inline-block px-2.5 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider ${s.className}`}>
      {s.label}
    </span>
  );
}

export default function QAVerificationQueue() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [sessions, setSessions] = useState<QASession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const fetchQueue = (p = 1) => {
    setLoading(true);
    fetch(`/api/verification/qa-queue?page=${p}&limit=50`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setSessions(data.data ?? []);
        setPage(data.page ?? 1);
        setPages(data.pages ?? 1);
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchQueue(1); }, []);

  const sessionsWithCode = useMemo(
    () => sessions.map((s) => ({ ...s, sessionCode: formatSmtSessionCode(s.startedAt, s.id) })),
    [sessions],
  );

  const filtered = sessionsWithCode.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.sessionCode.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      (s.bomName ?? "").toLowerCase().includes(q) ||
      (s.operatorName ?? "").toLowerCase().includes(q)
    );
  });

  const pendingSessions = filtered.filter(
    (s) => s.status === "pending_qa" || s.status === "qa_in_review" || s.status === "splicing_pending_qa",
  );
  const completedSessions = filtered.filter((s) => s.status === "qa_confirmed");

  const renderTable = (rows: typeof filtered) => (
    <div className="border border-border rounded-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="font-mono text-xs sm:text-sm">SESSION</TableHead>
            <TableHead className="font-mono text-xs sm:text-sm hidden sm:table-cell">LINE / PCB</TableHead>
            <TableHead className="font-mono text-xs sm:text-sm">OPERATOR</TableHead>
            <TableHead className="font-mono text-xs sm:text-sm hidden md:table-cell">SCANS</TableHead>
            <TableHead className="font-mono text-xs sm:text-sm">WAITING</TableHead>
            <TableHead className="font-mono text-xs sm:text-sm">STATUS</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((session) => (
            <TableRow
              key={session.id}
              className="border-border cursor-pointer hover:bg-secondary/50 transition-colors"
              onClick={() => setLocation(`/feeder/qa-queue/${session.id}`)}
            >
              <TableCell>
                <span className="inline-block px-2 py-1 rounded-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-[11px] font-mono font-semibold tracking-wide">
                  {session.sessionCode}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs sm:text-sm hidden sm:table-cell text-muted-foreground">
                {session.bomName ?? session.bomId}
              </TableCell>
              <TableCell className="font-mono text-xs sm:text-sm">
                {session.operatorName ?? session.operatorId.slice(0, 8)}
              </TableCell>
              <TableCell className="font-mono text-xs sm:text-sm hidden md:table-cell">
                <span className="text-muted-foreground">{session.pendingQa} pending</span>
                <span className="text-muted-foreground ml-1">/ {session.totalScans}</span>
              </TableCell>
              <TableCell>
                <PriorityIndicator startedAt={session.startedAt} />
              </TableCell>
              <TableCell>
                <StatusBadge status={session.status} discrepancyFound={session.qaDiscrepancyFound} />
              </TableCell>
              <TableCell>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  const noResults = filtered.length === 0;

  return (
    <div className="w-full space-y-4 sm:space-y-6 mt-6 sm:mt-8">
      <div className="px-4 sm:px-6 lg:px-8 flex flex-col gap-4 sm:gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <AppLogo className="h-10 sm:h-14" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-foreground">QA VERIFICATION QUEUE</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 font-mono">200% feeder reverification &mdash; pending review</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => fetchQueue(page)} className="font-mono text-xs rounded-sm">
            Refresh
          </Button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-full bg-background border-border font-mono text-sm rounded-sm"
          />
        </div>

        {sessions.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-sm">
            No sessions pending QA review.
          </div>
        ) : noResults ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-sm">
            No sessions match your search.
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Pending Review ({pendingSessions.length})
              </h2>
              {pendingSessions.length === 0 ? (
                <div className="border border-border rounded-sm p-8 text-center text-muted-foreground font-mono text-sm">
                  No sessions pending QA review.
                </div>
              ) : (
                renderTable(pendingSessions)
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-green-700 dark:text-green-400">
                Completed / Verified ({completedSessions.length})
              </h2>
              {completedSessions.length === 0 ? (
                <div className="border border-border rounded-sm p-8 text-center text-muted-foreground font-mono text-sm">
                  No completed QA sessions yet.
                </div>
              ) : (
                renderTable(completedSessions)
              )}
            </section>

            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="text-xs font-mono text-muted-foreground">
                  Page {page} of {pages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchQueue(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-xs font-mono rounded-sm border border-border bg-background hover:bg-secondary/50 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    ← Prev
                  </button>
                  <button
                    onClick={() => fetchQueue(page + 1)}
                    disabled={page >= pages}
                    className="px-3 py-1.5 text-xs font-mono rounded-sm border border-border bg-background hover:bg-secondary/50 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
