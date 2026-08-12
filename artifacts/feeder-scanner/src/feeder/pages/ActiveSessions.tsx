import { useEffect, useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AppLogo } from "@/components/AppLogo";
import { formatSmtSessionCode } from "@/lib/session-code";
import { Loader2, Search, ChevronRight, AlertCircle, Clock, Play, Trash2 } from "lucide-react";
import { format, differenceInMinutes } from "date-fns";

interface ActiveSession {
  id: string;
  bomId: number;
  operatorId: string;
  operatorName: string | null;
  status: string;
  startedAt: string;
  bomName: string | null;
}

function ElapsedBadge({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const mins = differenceInMinutes(now, new Date(startedAt));
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-sm bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-xs font-mono font-semibold">
      <Clock className="w-3 h-3" />
      {mins < 1 ? "<1m" : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}
    </span>
  );
}

export default function ActiveSessions() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/verification/sessions/active", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        setSessions(data.sessions ?? []);
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const sessionsWithCode = useMemo(
    () =>
      sessions.map((s) => ({
        ...s,
        sessionCode: formatSmtSessionCode(s.startedAt, s.id),
      })),
    [sessions],
  );

  const canDelete = user?.role === "qa" || user?.role === "supervisor" || user?.role === "admin";

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Delete this active session? It will be moved to trash.")) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert("Failed to delete session.");
    }
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  const isOperator = user?.role === "operator";
  const maxedOut = isOperator && sessions.length >= 2;

  if (isOperator) {
    return (
      <div className="w-full space-y-4 sm:space-y-6 mt-6 sm:mt-8">
        <div className="px-4 sm:px-6 lg:px-8 flex flex-col gap-4 sm:gap-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
            <div className="flex items-center gap-2 sm:gap-4">
              <AppLogo className="h-10 sm:h-14" />
              <div>
                <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-foreground">ACTIVE SESSIONS</h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1 font-mono">Your currently running verification sessions</p>
              </div>
            </div>
            <Link href="/feeder/sessions/new">
              <Button disabled={maxedOut} className="rounded-sm font-mono text-sm">
                {maxedOut ? "LIMIT REACHED (2 MAX)" : "+ NEW SESSION"}
              </Button>
            </Link>
          </div>

          {maxedOut && (
            <div className="flex items-center gap-3 border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 rounded-sm p-4 text-sm text-amber-800 dark:text-amber-200 font-mono">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>Complete your previous active sessions before creating a new one. Maximum 2 active sessions allowed.</span>
            </div>
          )}

          {sessionsWithCode.length === 0 ? (
            <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-sm">
              No active sessions found.{' '}
              <Link href="/feeder/sessions/new" className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors">
                Create one
              </Link>.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {sessionsWithCode.map((session) => (
                <div
                  key={session.id}
                  onClick={() => setLocation(`/feeder/sessions/${session.id}`)}
                  className="bg-card border border-border rounded-sm p-5 cursor-pointer hover:bg-secondary/50 hover:border-primary/30 transition-all active:bg-secondary group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-block px-2 py-0.5 rounded-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-[11px] font-mono font-semibold tracking-wide">
                          {session.sessionCode}
                        </span>
                        <ElapsedBadge startedAt={session.startedAt} />
                      </div>
                      <div className="font-mono font-bold text-primary text-sm truncate mt-1.5">
                        {session.bomName ?? `BOM #${session.bomId}`}
                      </div>
                    </div>
                    <span className="px-2.5 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider bg-green-600/15 text-green-600 dark:bg-green-500/15 dark:text-green-400 whitespace-nowrap ml-3">
                      active
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <div className="text-xs font-mono text-muted-foreground">
                      Started {format(new Date(session.startedAt), "MMM d, HH:mm")}
                    </div>
                    <div className="flex items-center gap-1 text-xs font-mono text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-3 h-3" />
                      Open
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const filtered = sessionsWithCode.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.sessionCode.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      (s.bomName ?? "").toLowerCase().includes(q) ||
      (s.operatorName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full space-y-4 sm:space-y-6 mt-6 sm:mt-8">
      <div className="px-4 sm:px-6 lg:px-8 flex flex-col gap-4 sm:gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <AppLogo className="h-10 sm:h-14" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-foreground">ACTIVE SESSIONS</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 font-mono">All currently running verification sessions</p>
            </div>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search sessions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full bg-background border-border font-mono text-sm rounded-sm"
            />
          </div>
        </div>

        {sessionsWithCode.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-sm">
            No active sessions found.
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-border rounded-sm p-12 text-center text-muted-foreground font-mono text-sm">
            No sessions match your search.
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block border border-border rounded-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="font-mono text-xs sm:text-sm">SESSION ID</TableHead>
                    <TableHead className="font-mono text-xs sm:text-sm">BOM</TableHead>
                    <TableHead className="font-mono text-xs sm:text-sm">OPERATOR</TableHead>
                    <TableHead className="font-mono text-xs sm:text-sm">DURATION</TableHead>
                    <TableHead className="font-mono text-xs sm:text-sm">STATUS</TableHead>
                    {canDelete && <TableHead className="w-10"></TableHead>}
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((session) => (
                    <TableRow
                      key={session.id}
                      className="border-border cursor-pointer hover:bg-secondary/50 transition-colors"
                      onClick={() => setLocation(`/feeder/sessions/${session.id}`)}
                    >
                      <TableCell>
                        <span className="inline-block px-2 py-1 rounded-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-[11px] font-mono font-semibold tracking-wide">
                          {session.sessionCode}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm font-bold text-primary">
                        {session.bomName ?? `BOM #${session.bomId}`}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">
                        {session.operatorName ?? session.operatorId.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <ElapsedBadge startedAt={session.startedAt} />
                      </TableCell>
                      <TableCell>
                        <span className="px-2.5 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider inline-block bg-green-600/15 text-green-600 dark:bg-green-500/15 dark:text-green-400">
                          active
                        </span>
                      </TableCell>
                      {canDelete && (
                        <TableCell>
                          <button
                            onClick={(e) => handleDelete(e, session.id)}
                            className="p-1.5 rounded-sm text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="Delete session"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </TableCell>
                      )}
                      <TableCell>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile/Tablet Cards */}
            <div className="lg:hidden grid gap-3">
              {filtered.map((session) => (
                <div
                  key={session.id}
                  className="bg-card border border-border rounded-sm group"
                >
                  <div
                    onClick={() => setLocation(`/feeder/sessions/${session.id}`)}
                    className="p-4 cursor-pointer hover:bg-secondary/50 transition-colors active:bg-secondary"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <span className="inline-block px-2 py-0.5 rounded-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-[11px] font-mono font-semibold tracking-wide">
                          {session.sessionCode}
                        </span>
                      </div>
                      <span className="px-2 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider bg-green-600/15 text-green-600 dark:bg-green-500/15 dark:text-green-400 whitespace-nowrap ml-2">
                        active
                      </span>
                    </div>
                    <div className="mb-3">
                      <div className="text-xs text-muted-foreground font-mono">BOM</div>
                      <div className="font-mono font-bold text-primary text-sm truncate">
                        {session.bomName ?? `BOM #${session.bomId}`}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">
                        {session.operatorName ?? session.operatorId.slice(0, 8)}
                      </span>
                      <div className="flex items-center gap-2">
                        <ElapsedBadge startedAt={session.startedAt} />
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                  {canDelete && (
                    <div className="border-t border-border px-4 py-2 flex justify-end">
                      <button
                        onClick={(e) => handleDelete(e, session.id)}
                        className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
