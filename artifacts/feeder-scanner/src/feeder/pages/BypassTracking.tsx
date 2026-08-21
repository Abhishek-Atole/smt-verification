import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, GitBranch, Plus } from "lucide-react";
import { logger } from "@/lib/logger";

interface BypassData {
  totalSessions: number;
  totalBypassed: number;
  bypassedProductionQuantity: number;
  bypassRate: number;
  byLine: { line: string; bypassed: number; total: number; productionQuantity: number }[];
  byDate: { date: string; bypassed: number; productionQuantity: number }[];
}

interface StageSeries { by: string; aoi: { key: string; quantity: number }[]; spi: { key: string; quantity: number }[] }

// Module 8: bypass quantity tracking. Two distinct metrics:
//  1. Manual per-stage AOI/SPI bypass quantities (bypass_log) — the datewise /
//     shiftwise trend graphs, filterable by date range, line and shift.
//  2. Changeover Bypass — changeovers started with BOM verification skipped
//     (derived from sessions), kept as a separate section.
export default function BypassTracking() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === "qa" || user?.role === "supervisor" || user?.role === "admin";

  const [changeover, setChangeover] = useState<BypassData | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters for the per-stage graphs.
  const today = new Date().toISOString().split("T")[0];
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [line, setLine] = useState("");
  const [shift, setShift] = useState("");
  const [by, setBy] = useState<"date" | "shift">("date");
  const [series, setSeries] = useState<StageSeries | null>(null);

  const loadChangeover = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/bypass", { credentials: "include" });
      if (res.ok) setChangeover(await res.json());
    } catch (error) {
      logger.error({ error }, "Failed to load changeover bypass data");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSeries = useCallback(async () => {
    const p = new URLSearchParams({ from, to, by });
    if (line) p.set("line", line);
    if (shift) p.set("shift", shift);
    try {
      const res = await fetch(`/api/bypass-log?${p.toString()}`, { credentials: "include" });
      if (res.ok) setSeries(await res.json());
    } catch (error) {
      logger.error({ error }, "Failed to load bypass series");
    }
  }, [from, to, line, shift, by]);

  useEffect(() => { void loadChangeover(); }, [loadChangeover]);
  useEffect(() => { void loadSeries(); }, [loadSeries]);

  const lineOptions = useMemo(
    () => [...new Set((changeover?.byLine ?? []).map((l) => l.line).filter((l) => l && l !== "Unassigned"))].sort(),
    [changeover],
  );

  // PLACEHOLDER_FORM
  const [form, setForm] = useState({ entryDate: today, stage: "AOI", quantity: "", lineNumber: "", shift: "" });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const qty = Number(form.quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      toast({ title: "Invalid quantity", description: "Quantity must be a non-negative whole number", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/bypass-log", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          entryDate: form.entryDate, stage: form.stage, quantity: qty,
          lineNumber: form.lineNumber.trim() || undefined, shift: form.shift.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Recorded", description: `${qty} ${form.stage} bypass saved` });
      setForm((f) => ({ ...f, quantity: "" }));
      await loadSeries();
    } catch (error) {
      toast({ title: "Error", description: "Failed to save bypass entry", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // PLACEHOLDER_RENDER
  return (
    <div className="w-full space-y-6 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="border-b border-border pb-4 flex items-center gap-3">
        <GitBranch className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl lg:text-3xl font-mono font-bold tracking-tight text-foreground">BYPASS TRACKING</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">Per-stage AOI/SPI bypass quantities and changeover BOM-skip metrics.</p>
        </div>
      </div>

      {canEdit && (
        <Card>
          <CardHeader><CardTitle className="text-base font-mono">RECORD STAGE BYPASS</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.entryDate} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} /></div>
            <div className="space-y-1">
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="AOI">AOI</SelectItem><SelectItem value="SPI">SPI</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Quantity</Label><Input type="number" min={0} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Line</Label><Input value={form.lineNumber} onChange={(e) => setForm((f) => ({ ...f, lineNumber: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Shift</Label><Input value={form.shift} onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))} /></div>
            <div className="sm:col-span-5">
              <Button onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Save Bypass
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters for the per-stage graphs */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div className="space-y-1">
          <Label className="text-xs">Line</Label>
          <Select value={line || "all"} onValueChange={(v) => setLine(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All lines" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All lines</SelectItem>{lineOptions.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label className="text-xs">Shift</Label><Input value={shift} onChange={(e) => setShift(e.target.value)} placeholder="All shifts" className="w-32" /></div>
        <div className="space-y-1">
          <Label className="text-xs">By</Label>
          <Select value={by} onValueChange={(v) => setBy(v as "date" | "shift")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="date">Datewise</SelectItem><SelectItem value="shift">Shiftwise</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StageChart title="AOI BYPASS" data={series?.aoi ?? []} />
        <StageChart title="SPI BYPASS" data={series?.spi ?? []} />
      </div>

      {/* Distinct metric: changeovers started with BOM verification skipped */}
      <Card>
        <CardHeader><CardTitle className="text-base font-mono">CHANGEOVER BYPASS (BOM VERIFICATION SKIPPED)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Metric label="BYPASSED" value={changeover?.totalBypassed ?? 0} accent />
            <Metric label="TOTAL CHANGEOVERS" value={changeover?.totalSessions ?? 0} />
            <Metric label="BYPASS RATE" value={`${changeover?.bypassRate ?? 0}%`} />
            <Metric label="PRODUCTION QTY" value={changeover?.bypassedProductionQuantity ?? 0} />
          </div>
          <div className="h-64">
            {changeover && changeover.byLine.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={changeover.byLine}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="line" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend />
                  <Bar dataKey="bypassed" fill="hsl(var(--destructive))" name="Bypassed" />
                  <Bar dataKey="total" fill="hsl(var(--primary))" name="Total" />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">No changeover bypass data</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StageChart({ title, data }: { title: string; data: { key: string; quantity: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base font-mono">{title}</CardTitle></CardHeader>
      <CardContent className="h-72">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="key" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} /><Tooltip />
              <Line type="monotone" dataKey="quantity" stroke="hsl(var(--destructive))" strokeWidth={2} name="Bypass qty" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">No data in range</div>}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-mono text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent><span className={`text-3xl font-mono font-bold${accent ? " text-destructive" : ""}`}>{value}</span></CardContent>
    </Card>
  );
}
