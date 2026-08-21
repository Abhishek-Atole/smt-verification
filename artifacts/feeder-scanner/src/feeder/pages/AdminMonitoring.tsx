import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Loader2, Activity } from "lucide-react";
import { logger } from "@/lib/logger";

interface Monitoring {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  eventsToday: number;
  byAction: { action: string; count: number }[];
}

interface AuditRow {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  changedBy: string | null;
  actorRole: string | null;
  description: string | null;
  createdAt: string;
}

interface Summary {
  changeover: { byStatus: Record<string, number> };
  rejection: { totalRejected: number; totalQtyChecked: number; notOkQty: number; ppm: number };
  bypass: { aoi: number; spi: number; total: number };
  recentEvents: AuditRow[];
}

// Module 9: Admin audit log + monitoring dashboard. Reads the tamper-evident
// audit trail and live session/monitoring counts.
export default function AdminMonitoring() {
  const { toast } = useToast();
  const [monitoring, setMonitoring] = useState<Monitoring | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [monRes, sumRes, logRes] = await Promise.all([
        fetch("/api/audit/monitoring", { credentials: "include" }),
        fetch("/api/monitoring/summary", { credentials: "include" }),
        fetch("/api/audit/recent?limit=200", { credentials: "include" }),
      ]);
      if (monRes.ok) setMonitoring(await monRes.json());
      if (sumRes.ok) setSummary(await sumRes.json());
      if (logRes.ok) setLogs((await logRes.json()).logs ?? []);
    } catch (error) {
      logger.error({ error }, "Failed to load monitoring data");
      toast({ title: "Error", description: "Failed to load monitoring data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? logs.filter((l) =>
        [l.entityType, l.entityId, l.action, l.changedBy, l.description]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    : logs;

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="border-b border-border pb-4 flex items-center gap-3">
        <Activity className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl lg:text-3xl font-mono font-bold tracking-tight text-foreground">MONITORING & AUDIT</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">System activity and tamper-evident audit trail.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground">ACTIVE</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-mono font-bold text-primary">{monitoring?.activeSessions ?? 0}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground">COMPLETED</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-mono font-bold">{monitoring?.completedSessions ?? 0}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground">TOTAL SESSIONS</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-mono font-bold">{monitoring?.totalSessions ?? 0}</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground">EVENTS TODAY</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-mono font-bold">{monitoring?.eventsToday ?? 0}</span></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base font-mono">EVENTS TODAY BY ACTION</CardTitle></CardHeader>
        <CardContent className="h-72">
          {monitoring && monitoring.byAction.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monitoring.byAction}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="action" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" name="Events" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">No events today</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base font-mono">REJECTION & PPM</CardTitle></CardHeader>
          <CardContent className="space-y-1 font-mono text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total Rejected</span><span className="font-bold">{summary?.rejection.totalRejected ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Qty Checked</span><span className="font-bold">{summary?.rejection.totalQtyChecked ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Not OK</span><span className="font-bold">{summary?.rejection.notOkQty ?? 0}</span></div>
            <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="text-muted-foreground">PPM</span><span className="font-bold text-destructive text-lg">{summary?.rejection.ppm ?? 0}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base font-mono">BYPASS TOTALS</CardTitle></CardHeader>
          <CardContent className="space-y-1 font-mono text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">AOI</span><span className="font-bold">{summary?.bypass.aoi ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">SPI</span><span className="font-bold">{summary?.bypass.spi ?? 0}</span></div>
            <div className="flex justify-between border-t border-border pt-1 mt-1"><span className="text-muted-foreground">Total Bypassed</span><span className="font-bold text-destructive text-lg">{summary?.bypass.total ?? 0}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base font-mono">CHANGEOVERS BY STATUS</CardTitle></CardHeader>
          <CardContent className="space-y-1 font-mono text-sm">
            {summary && Object.keys(summary.changeover.byStatus).length > 0 ? (
              Object.entries(summary.changeover.byStatus).map(([status, count]) => (
                <div key={status} className="flex justify-between"><span className="text-muted-foreground">{status}</span><span className="font-bold">{count}</span></div>
              ))
            ) : (
              <span className="text-muted-foreground text-xs">No changeovers</span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono">AUDIT LOG</CardTitle>
          <Input className="mt-2 max-w-sm" placeholder="Filter by entity, action, user…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground font-mono text-sm">No audit entries</TableCell></TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{l.entityType}#{l.entityId}</TableCell>
                    <TableCell><span className="font-mono text-xs">{l.action}</span></TableCell>
                    <TableCell className="text-xs">{l.changedBy ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{l.actorRole ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">{l.description ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
