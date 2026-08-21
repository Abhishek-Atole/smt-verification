import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, ComposedChart, LabelList,
} from "recharts";
import { Loader2, Plus, Trash2, ShieldAlert, Search } from "lucide-react";
import { logger } from "@/lib/logger";

// Module 7: QF-OP-03 QA In-house Rejection dashboard. Five tabs share a filter
// bar (date range + line + daily/monthly/yearly level) and a configurable
// document-control header. Blocks 1 & 3 come from the manual daily_inspection_log
// (PPM = Not_OK / Total_Qty_Checked × 1e6), Blocks 2 & 4 from the rejection rows.
type Level = "daily" | "monthly" | "yearly";

interface SessionOption {
  id: number;
  panelName?: string;
  lineName?: string;
  customerName?: string;
  shiftDate?: string;
  bomName?: string;
}

interface InspectionEntry {
  id: number;
  entryDate: string;
  partNumber: string;
  lineNumber: string | null;
  shift: string | null;
  totalQtyChecked: number;
  firstShotQty: number;
  okQty: number;
  notOkQty: number;
  enteredByName: string | null;
}

interface Rejection {
  id: number;
  sessionId: number;
  defectType: string;
  quantity: number;
  remarks: string | null;
  entryDate: string | null;
  lineNumber: string | null;
  bomName: string | null;
  partNumber: string | null;
  stage: string | null;
  component: string | null;
  location: string | null;
  machine: string | null;
  shift: string | null;
  recordedByName: string | null;
  createdAt: string;
}

interface Dashboard {
  from: string;
  to: string;
  level: Level;
  block1: { totalQtyChecked: number; firstShotQty: number; okQty: number; notOkQty: number };
  block2: { items: { defectType: string; quantity: number; count: number; cumulativePercent: number }[]; total: number };
  block3: { ppm: number; notOk: number; totalQtyChecked: number };
  block4: { series: { key: string; quantity: number }[] };
}

interface DocControl {
  docKey: string;
  documentNo: string | null;
  revNo: string | null;
  revDate: string | null;
  pageNo: string | null;
}

interface MasterValue { id: number; value: string }

const DOC_KEY = "QF-OP-03";

async function getJson(url: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export default function QAInhouseRejection() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === "qa" || user?.role === "supervisor" || user?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<DocControl | null>(null);
  const [sessions, setSessions] = useState<SessionOption[]>([]);

  // Shared filter bar (preserved across tabs).
  const today = new Date().toISOString().split("T")[0];
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [line, setLine] = useState("");
  const [level, setLevel] = useState<Level>("daily");

  const loadShared = useCallback(async () => {
    try {
      const [docRes, sessionsRes] = await Promise.all([
        getJson(`/api/document-control/${DOC_KEY}`).catch(() => null),
        getJson("/api/sessions").catch(() => null),
      ]);
      if (docRes) setDoc(docRes.documentControl);
      if (sessionsRes) setSessions(Array.isArray(sessionsRes) ? sessionsRes : (sessionsRes.sessions ?? []));
    } catch (error) {
      logger.error({ error }, "Failed to load QA shared data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadShared(); }, [loadShared]);

  const lineOptions = useMemo(
    () => [...new Set(sessions.map((s) => s.lineName).filter((l): l is string => !!l))].sort(),
    [sessions],
  );

  const filterQuery = useMemo(() => {
    const p = new URLSearchParams({ from, to, level });
    if (line) p.set("line", line);
    return p.toString();
  }, [from, to, line, level]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="border-b border-border pb-4 flex items-center gap-3">
        <ShieldAlert className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl lg:text-3xl font-mono font-bold tracking-tight text-foreground">QA IN-HOUSE REJECTION</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">QF-OP-03 — daily inspection, Pareto, PPM & defect details.</p>
        </div>
      </div>

      {/* Configurable document-control header strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono border border-border rounded-sm p-3 bg-muted/30">
        <div><span className="text-muted-foreground">Document No: </span>{doc?.documentNo ?? DOC_KEY}</div>
        <div><span className="text-muted-foreground">Rev No: </span>{doc?.revNo ?? "—"}</div>
        <div><span className="text-muted-foreground">Rev Date: </span>{doc?.revDate ?? "—"}</div>
        <div><span className="text-muted-foreground">Page No: </span>{doc?.pageNo ?? "—"}</div>
      </div>

      {/* Shared filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Line</Label>
          <Select value={line || "all"} onValueChange={(v) => setLine(v === "all" ? "" : v)}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All lines" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lines</SelectItem>
              {lineOptions.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">View</Label>
          <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="daily-report">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="daily-report">Daily Inspe. Report</TabsTrigger>
          <TabsTrigger value="partwise">Partwise Inspection Summary</TabsTrigger>
          <TabsTrigger value="summary-graph">Summary Graph</TabsTrigger>
          <TabsTrigger value="ref-sheet">Ref.Sheet</TabsTrigger>
          <TabsTrigger value="defect-details">Defect Details</TabsTrigger>
        </TabsList>

        <TabsContent value="daily-report">
          <DailyReportTab from={from} to={to} line={line} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="partwise">
          <PartwiseTab from={from} to={to} line={line} />
        </TabsContent>
        <TabsContent value="summary-graph">
          <SummaryGraphTab filterQuery={filterQuery} level={level} />
        </TabsContent>
        <TabsContent value="ref-sheet">
          <RefSheetTab canEdit={canEdit} doc={doc} onDocChanged={loadShared} />
        </TabsContent>
        <TabsContent value="defect-details">
          <DefectDetailsTab sessions={sessions} userName={user?.name ?? ""} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Daily Inspe. Report: manual inspection-count entry + datewise table ----
function DailyReportTab({ from, to, line, canEdit }: { from: string; to: string; line: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<InspectionEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    entryDate: new Date().toISOString().split("T")[0],
    partNumber: "", lineNumber: "", shift: "",
    totalQtyChecked: "", firstShotQty: "", okQty: "", notOkQty: "",
  });

  const load = useCallback(async () => {
    const p = new URLSearchParams({ from, to });
    if (line) p.set("line", line);
    try {
      const data = await getJson(`/api/inspection-log?${p.toString()}`);
      setEntries(data.entries ?? []);
    } catch (error) {
      logger.error({ error }, "Failed to load inspection log");
    }
  }, [from, to, line]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!form.partNumber.trim()) {
      toast({ title: "Missing part", description: "Part number is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/inspection-log", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          entryDate: form.entryDate, partNumber: form.partNumber.trim(),
          lineNumber: form.lineNumber.trim() || undefined, shift: form.shift.trim() || undefined,
          totalQtyChecked: Number(form.totalQtyChecked) || 0, firstShotQty: Number(form.firstShotQty) || 0,
          okQty: Number(form.okQty) || 0, notOkQty: Number(form.notOkQty) || 0,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Recorded", description: `Inspection entry for ${form.partNumber.trim()} saved` });
      setForm((f) => ({ ...f, partNumber: "", totalQtyChecked: "", firstShotQty: "", okQty: "", notOkQty: "" }));
      await load();
    } catch (error) {
      toast({ title: "Error", description: "Failed to save inspection entry", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      {canEdit && (
        <Card>
          <CardHeader><CardTitle className="text-base font-mono">DAILY INSPECTION ENTRY</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.entryDate} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Part No</Label><Input value={form.partNumber} onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Line</Label><Input value={form.lineNumber} onChange={(e) => setForm((f) => ({ ...f, lineNumber: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Shift</Label><Input value={form.shift} onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Total Checked</Label><Input type="number" min={0} value={form.totalQtyChecked} onChange={(e) => setForm((f) => ({ ...f, totalQtyChecked: e.target.value }))} /></div>
            <div className="space-y-1"><Label>First Shot</Label><Input type="number" min={0} value={form.firstShotQty} onChange={(e) => setForm((f) => ({ ...f, firstShotQty: e.target.value }))} /></div>
            <div className="space-y-1"><Label>OK</Label><Input type="number" min={0} value={form.okQty} onChange={(e) => setForm((f) => ({ ...f, okQty: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Not OK</Label><Input type="number" min={0} value={form.notOkQty} onChange={(e) => setForm((f) => ({ ...f, notOkQty: e.target.value }))} /></div>
            <div className="sm:col-span-4">
              <Button onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Save Entry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base font-mono">DATEWISE INSPECTION LOG</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Part</TableHead><TableHead>Line</TableHead><TableHead>Shift</TableHead>
              <TableHead className="text-right">Checked</TableHead><TableHead className="text-right">First Shot</TableHead>
              <TableHead className="text-right">OK</TableHead><TableHead className="text-right">Not OK</TableHead><TableHead>By</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground font-mono text-sm">No inspection entries in range</TableCell></TableRow>
              ) : entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{e.entryDate}</TableCell><TableCell>{e.partNumber}</TableCell>
                  <TableCell>{e.lineNumber ?? "—"}</TableCell><TableCell>{e.shift ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{e.totalQtyChecked}</TableCell>
                  <TableCell className="text-right font-mono">{e.firstShotQty}</TableCell>
                  <TableCell className="text-right font-mono">{e.okQty}</TableCell>
                  <TableCell className="text-right font-mono text-destructive">{e.notOkQty}</TableCell>
                  <TableCell>{e.enteredByName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Partwise Inspection Summary: aggregate the inspection log per part ----
function PartwiseTab({ from, to, line }: { from: string; to: string; line: string }) {
  const [entries, setEntries] = useState<InspectionEntry[]>([]);

  useEffect(() => {
    const p = new URLSearchParams({ from, to });
    if (line) p.set("line", line);
    void getJson(`/api/inspection-log?${p.toString()}`)
      .then((d) => setEntries(d.entries ?? []))
      .catch((error) => logger.error({ error }, "Failed to load partwise summary"));
  }, [from, to, line]);

  const rows = useMemo(() => {
    const map = new Map<string, { part: string; checked: number; ok: number; notOk: number }>();
    for (const e of entries) {
      if (!map.has(e.partNumber)) map.set(e.partNumber, { part: e.partNumber, checked: 0, ok: 0, notOk: 0 });
      const r = map.get(e.partNumber)!;
      r.checked += e.totalQtyChecked; r.ok += e.okQty; r.notOk += e.notOkQty;
    }
    return [...map.values()]
      .map((r) => ({ ...r, ppm: r.checked > 0 ? Math.round((r.notOk / r.checked) * 1_000_000) : 0 }))
      .sort((a, b) => b.ppm - a.ppm);
  }, [entries]);

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base font-mono">PARTWISE INSPECTION SUMMARY</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Part</TableHead><TableHead className="text-right">Checked</TableHead>
            <TableHead className="text-right">OK</TableHead><TableHead className="text-right">Not OK</TableHead>
            <TableHead className="text-right">PPM</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground font-mono text-sm">No data in range</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.part}>
                <TableCell>{r.part}</TableCell>
                <TableCell className="text-right font-mono">{r.checked}</TableCell>
                <TableCell className="text-right font-mono">{r.ok}</TableCell>
                <TableCell className="text-right font-mono text-destructive">{r.notOk}</TableCell>
                <TableCell className="text-right font-mono font-bold">{r.ppm}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---- Summary Graph: the 4-block QF-OP-03 dashboard ----
function SummaryGraphTab({ filterQuery, level }: { filterQuery: string; level: Level }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void getJson(`/api/qa-rejections/dashboard?${filterQuery}`)
      .then((d) => setDash(d))
      .catch((error) => logger.error({ error }, "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [filterQuery]);

  if (loading) return <div className="h-64 flex items-center justify-center mt-4"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!dash) return <div className="h-64 flex items-center justify-center mt-4 text-muted-foreground font-mono text-sm">No data</div>;

  const block1Data = [
    { name: "Total Checked", value: dash.block1.totalQtyChecked },
    { name: "First Shot", value: dash.block1.firstShotQty },
    { name: "OK", value: dash.block1.okQty },
  ];

  return (
    <div className="space-y-4 mt-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Block 1: Summary Daily Inspection Status */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-mono">1 · DAILY INSPECTION STATUS</CardTitle>
            <div className="text-right"><div className="text-xs text-muted-foreground font-mono">NOT OK</div><div className="text-2xl font-mono font-bold text-destructive">{dash.block1.notOkQty}</div></div>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={block1Data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} /><Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" name="Qty" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Block 3: Rejection PPM */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base font-mono">3 · REJECTION PPM</CardTitle></CardHeader>
          <CardContent className="h-64 flex flex-col items-center justify-center">
            <div className="text-6xl font-mono font-bold text-destructive">{dash.block3.ppm}</div>
            <div className="text-sm text-muted-foreground font-mono mt-2">
              {dash.block3.notOk} not-OK / {dash.block3.totalQtyChecked} checked × 1e6
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Block 2: Pareto */}
      <Card>
        <CardHeader><CardTitle className="text-base font-mono">2 · DEFECT PARETO</CardTitle></CardHeader>
        <CardContent className="h-80">
          {dash.block2.items.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dash.block2.items} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="defectType" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                <Legend />
                <Bar yAxisId="left" dataKey="quantity" name="Rejected Qty" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumulativePercent" name="Cumulative %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">No defect data</div>}
        </CardContent>
      </Card>

      {/* Block 4: datewise total-rejection line, zero-filled with data labels */}
      <Card>
        <CardHeader><CardTitle className="text-base font-mono">4 · REJECTIONS BY {level.toUpperCase()}</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dash.block4.series} margin={{ top: 24, right: 20, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="key" fontSize={11} /><YAxis allowDecimals={false} /><Tooltip />
              <Line type="monotone" dataKey="quantity" name="Rejections" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }}>
                <LabelList dataKey="quantity" position="top" fontSize={11} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Ref.Sheet: master-list management + document-control edit ----
function RefSheetTab({ canEdit, doc, onDocChanged }: { canEdit: boolean; doc: DocControl | null; onDocChanged: () => Promise<void> }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
      <MasterSection title="Defect Types" category="defect_type" canEdit={canEdit} />
      <MasterSection title="Machines" category="machine" canEdit={canEdit} />
      <DocControlSection canEdit={canEdit} doc={doc} onSaved={onDocChanged} />
    </div>
  );
}

function MasterSection({ title, category, canEdit }: { title: string; category: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [values, setValues] = useState<MasterValue[]>([]);
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getJson("/api/masters");
      setValues(category === "defect_type" ? (data.defectTypes ?? []) : (data.machines ?? []));
    } catch (error) {
      logger.error({ error }, "Failed to load masters");
    }
  }, [category]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const value = newValue.trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await fetch("/api/masters", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ category, value }),
      });
      if (!res.ok) throw new Error("Failed");
      setNewValue(""); await load();
    } catch (error) {
      toast({ title: "Error", description: "Failed to add value", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/masters/${id}`, { method: "DELETE", credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
      if (!res.ok && res.status !== 204) throw new Error("Failed");
      await load();
    } catch (error) {
      toast({ title: "Error", description: "Failed to remove value", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Card className="rounded-sm">
      <CardHeader><CardTitle className="font-mono tracking-wide text-primary">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {canEdit && (
          <div className="flex items-center gap-2">
            <Input value={newValue} onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
              placeholder={`Add ${title.toLowerCase()}...`} disabled={busy} />
            <Button type="button" onClick={() => void add()} disabled={busy || !newValue.trim()} className="shrink-0"><Plus className="h-4 w-4 mr-1" /> Add</Button>
          </div>
        )}
        {values.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No values yet.</p>
        ) : (
          <Table><TableBody>
            {values.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">{v.value}</TableCell>
                {canEdit && <TableCell className="text-right">
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void remove(v.id)} disabled={busy}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>}
              </TableRow>
            ))}
          </TableBody></Table>
        )}
      </CardContent>
    </Card>
  );
}

function DocControlSection({ canEdit, doc, onSaved }: { canEdit: boolean; doc: DocControl | null; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ documentNo: "", revNo: "", revDate: "", pageNo: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ documentNo: doc?.documentNo ?? "", revNo: doc?.revNo ?? "", revDate: doc?.revDate ?? "", pageNo: doc?.pageNo ?? "" });
  }, [doc]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/document-control/${DOC_KEY}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Saved", description: "Document control updated" });
      await onSaved();
    } catch (error) {
      toast({ title: "Error", description: "Failed to save document control", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <Card className="rounded-sm">
      <CardHeader><CardTitle className="font-mono tracking-wide text-primary">Document Control ({DOC_KEY})</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 items-end">
        <div className="space-y-1"><Label>Document No</Label><Input value={form.documentNo} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, documentNo: e.target.value }))} /></div>
        <div className="space-y-1"><Label>Rev No</Label><Input value={form.revNo} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, revNo: e.target.value }))} /></div>
        <div className="space-y-1"><Label>Rev Date</Label><Input value={form.revDate} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, revDate: e.target.value }))} /></div>
        <div className="space-y-1"><Label>Page No</Label><Input value={form.pageNo} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, pageNo: e.target.value }))} /></div>
        {canEdit && <div className="col-span-2"><Button onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save</Button></div>}
      </CardContent>
    </Card>
  );
}

// ---- Defect Details (7.5): changeover-autopopulate structured rejection form ----
function DefectDetailsTab({ sessions, userName, canEdit }: { sessions: SessionOption[]; userName: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SessionOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [defectTypes, setDefectTypes] = useState<string[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [rows, setRows] = useState<Rejection[]>([]);

  // Editable fields (derived line/date/bom/customer stay read-only + locked).
  const [form, setForm] = useState({
    component: "", location: "", defectType: "", machine: "", quantity: "",
    entryDate: new Date().toISOString().split("T")[0], shift: "", stage: "",
  });

  const loadMasters = useCallback(async () => {
    try {
      const data = await getJson("/api/masters");
      setDefectTypes((data.defectTypes ?? []).map((d: MasterValue) => d.value));
      setMachines((data.machines ?? []).map((m: MasterValue) => m.value));
    } catch (error) { logger.error({ error }, "Failed to load masters"); }
  }, []);

  const loadRows = useCallback(async () => {
    try {
      const data = await getJson("/api/qa-rejections");
      setRows((data.rejections ?? []).slice(0, 25));
    } catch (error) { logger.error({ error }, "Failed to load rejections"); }
  }, []);

  useEffect(() => { void loadMasters(); void loadRows(); }, [loadMasters, loadRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions.slice(0, 50);
    return sessions.filter((s) =>
      String(s.id).includes(q) || (s.panelName ?? "").toLowerCase().includes(q) ||
      (s.bomName ?? "").toLowerCase().includes(q) || (s.lineName ?? "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [sessions, search]);

  const submit = async () => {
    if (!selected) { toast({ title: "Select a changeover first", variant: "destructive" }); return; }
    if (!form.defectType) { toast({ title: "Defect type is required", variant: "destructive" }); return; }
    const qty = Number(form.quantity);
    if (!Number.isInteger(qty) || qty <= 0) { toast({ title: "Quantity must be a positive whole number", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/qa-rejections", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          sessionId: selected.id, defectType: form.defectType, quantity: qty,
          entryDate: form.entryDate || undefined, lineNumber: selected.lineName || undefined,
          bomName: selected.bomName || undefined, partNumber: selected.panelName || undefined,
          stage: form.stage || undefined, component: form.component.trim() || undefined,
          location: form.location.trim() || undefined, machine: form.machine || undefined,
          shift: form.shift.trim() || undefined,
        }),
      });
      if (!res.ok) { const p = await res.json().catch(() => null); throw new Error(p?.error ?? "Failed"); }
      toast({ title: "Logged", description: `${qty} × ${form.defectType} recorded` });
      setForm((f) => ({ ...f, component: "", location: "", defectType: "", machine: "", quantity: "", stage: "" }));
      await loadRows();
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4 mt-4">
      {canEdit && (
        <Card>
          <CardHeader><CardTitle className="text-base font-mono">7.5 DEFECT DETAILS</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Searchable changeover dropdown (Popover + filtered input) */}
            <div className="space-y-1">
              <Label>Changeover</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal">
                    <Search className="w-4 h-4 mr-2 text-muted-foreground" />
                    {selected ? `#${selected.id} — ${selected.panelName ?? selected.bomName ?? ""}` : "Select a changeover..."}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-96 p-2" align="start">
                  <Input autoFocus placeholder="Search by id / panel / BOM / line" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
                  <div className="max-h-64 overflow-auto">
                    {filtered.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No matches</p>
                    ) : filtered.map((s) => (
                      <button key={s.id} type="button"
                        className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted font-mono"
                        onClick={() => { setSelected(s); setOpen(false); }}>
                        #{s.id} — {s.panelName ?? "?"} · {s.bomName ?? "no BOM"} · {s.lineName ?? "no line"}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Auto-populated read-only (locked) derived fields */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1"><Label>Line</Label><Input value={selected?.lineName ?? ""} readOnly disabled /></div>
              <div className="space-y-1"><Label>Changeover Date</Label><Input value={selected?.shiftDate ?? ""} readOnly disabled /></div>
              <div className="space-y-1"><Label>BOM</Label><Input value={selected?.bomName ?? ""} readOnly disabled /></div>
              <div className="space-y-1"><Label>Customer</Label><Input value={selected?.customerName ?? ""} readOnly disabled /></div>
            </div>

            {/* Editable fields — locked until a changeover is selected */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <div className="space-y-1"><Label>Component</Label><Input value={form.component} disabled={!selected} onChange={(e) => setForm((f) => ({ ...f, component: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Location</Label><Input value={form.location} disabled={!selected} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></div>
              <div className="space-y-1">
                <Label>Defect Type</Label>
                <Select value={form.defectType} onValueChange={(v) => setForm((f) => ({ ...f, defectType: v }))} disabled={!selected}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{defectTypes.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Machine</Label>
                <Select value={form.machine} onValueChange={(v) => setForm((f) => ({ ...f, machine: v }))} disabled={!selected}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{machines.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Stage</Label>
                <Select value={form.stage} onValueChange={(v) => setForm((f) => ({ ...f, stage: v }))} disabled={!selected}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AOI">AOI</SelectItem><SelectItem value="SPI">SPI</SelectItem><SelectItem value="Final">Final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Quantity</Label><Input type="number" min={1} value={form.quantity} disabled={!selected} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.entryDate} disabled={!selected} onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Shift</Label><Input value={form.shift} disabled={!selected} onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))} /></div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground font-mono">Entered by: <span className="text-foreground">{userName || "—"}</span></div>
              <Button onClick={submit} disabled={submitting || !selected} className="ml-auto">
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Log Defect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base font-mono">RECENT DEFECT ENTRIES</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>CO</TableHead><TableHead>Date</TableHead><TableHead>Stage</TableHead><TableHead>Defect</TableHead>
              <TableHead>Component</TableHead><TableHead>Machine</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>By</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground font-mono text-sm">No entries yet</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">#{r.sessionId}</TableCell>
                  <TableCell className="font-mono">{r.entryDate ?? r.createdAt.split("T")[0]}</TableCell>
                  <TableCell>{r.stage ?? "—"}</TableCell><TableCell>{r.defectType}</TableCell>
                  <TableCell>{r.component ?? "—"}</TableCell><TableCell>{r.machine ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.quantity}</TableCell><TableCell>{r.recordedByName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
