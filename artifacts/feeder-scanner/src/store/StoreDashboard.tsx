import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";

// Module 11.4 Reel/Lot Master + 11.7 issue-to-line — the store's work surface.
// Receive a physical reel, then issue it to a line. Bin/batch/lot/DC are
// traceability fields (11.4): two reels of the same part legitimately differ
// there, so nothing here treats a difference as a mismatch.
//
// This does not touch changeover scanning. 11.5 enforcement against issued reels
// is a separate change, so an empty table can't reject an operator.

type ReelStatus = "in_stock" | "issued" | "in_use" | "consumed" | "expired";

interface Reel {
  id: number;
  partNumber: string;
  description: string | null;
  binNo: string | null;
  batchNo: string | null;
  lotNo: string | null;
  dcCode: string | null;
  expDate: string | null;
  qtyReceived: number | null;
  receivedDate: string | null;
  status: ReelStatus;
  currentLineName: string | null;
}

const STATUS_CLASS: Record<ReelStatus, string> = {
  in_stock: "text-green-600",
  issued: "text-blue-600",
  in_use: "text-amber-600",
  consumed: "text-muted-foreground",
  expired: "text-red-600",
};

const EMPTY_FORM = {
  partNumber: "",
  description: "",
  binNo: "",
  batchNo: "",
  lotNo: "",
  dcCode: "",
  mfgDate: "",
  expDate: "",
  qtyReceived: "",
};

export default function StoreDashboard() {
  const { toast } = useToast();
  const [reels, setReels] = useState<Reel[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [issueLine, setIssueLine] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const [reelRes, lineRes] = await Promise.all([
        fetch("/api/reels", { credentials: "include" }),
        fetch("/api/approvers", { credentials: "include" }),
      ]);
      if (!reelRes.ok) throw new Error(`Failed to load reels (${reelRes.status})`);
      const reelData = (await reelRes.json()) as { reels?: Reel[] };
      setReels(Array.isArray(reelData.reels) ? reelData.reels : []);

      // Line roster is the same list the New Changeover form offers, so a reel
      // can only be issued to a line a changeover can actually run on.
      if (lineRes.ok) {
        const lineData = (await lineRes.json()) as { lines?: { name: string }[] };
        setLines(Array.isArray(lineData.lines) ? lineData.lines.map((l) => l.name) : []);
      }
    } catch (error) {
      logger.error({ error }, "[StoreDashboard] Failed to load reels");
      toast({ title: "Error", description: "Failed to load reels", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (url: string, body: unknown, method = "POST") => {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
  };

  const receive = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.partNumber.trim()) return;
    setSaving(true);
    try {
      await post("/api/reels", form);
      toast({ title: "Reel received", description: `${form.partNumber.trim().toUpperCase()} added to stock` });
      setForm(EMPTY_FORM);
      await load();
    } catch (error) {
      logger.warn({ error }, "[StoreDashboard] receive failed");
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to receive reel",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const issue = async (reel: Reel) => {
    const lineName = issueLine[reel.id] ?? "";
    if (!lineName) {
      toast({ title: "Pick a line", description: "Select which line this reel goes to", variant: "destructive" });
      return;
    }
    try {
      await post(`/api/reels/${reel.id}/issue`, { lineName });
      toast({ title: "Reel issued", description: `${reel.partNumber} → ${lineName}` });
      await load();
    } catch (error) {
      logger.warn({ error }, "[StoreDashboard] issue failed");
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to issue reel",
        variant: "destructive",
      });
    }
  };

  const setStatus = async (reel: Reel, status: "in_use" | "consumed" | "expired") => {
    try {
      await post(`/api/reels/${reel.id}/status`, { status }, "PATCH");
      await load();
    } catch (error) {
      logger.warn({ error }, "[StoreDashboard] status change failed");
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update reel",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const inStock = reels.filter((r) => r.status === "in_stock").length;
  const issued = reels.filter((r) => r.status === "issued").length;

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 lg:px-8 py-6">
      <div className="border-b border-border pb-4 flex items-center gap-3">
        <Package className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight">REEL / LOT MASTER</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {reels.length} reels · {inStock} in stock · {issued} issued
          </p>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-mono">RECEIVE REEL</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={receive} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Part Number *" value={form.partNumber} onChange={(v) => setForm({ ...form, partNumber: v })} placeholder="Scan or type" />
            <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
            <Field label="Bin No." value={form.binNo} onChange={(v) => setForm({ ...form, binNo: v })} placeholder="LA G6SP.02-8E-2-K3" />
            <Field label="Batch No." value={form.batchNo} onChange={(v) => setForm({ ...form, batchNo: v })} />
            <Field label="Lot No." value={form.lotNo} onChange={(v) => setForm({ ...form, lotNo: v })} />
            <Field label="Date Code" value={form.dcCode} onChange={(v) => setForm({ ...form, dcCode: v })} placeholder="2618" />
            <Field label="Qty Received" value={form.qtyReceived} onChange={(v) => setForm({ ...form, qtyReceived: v })} placeholder="1000" type="number" />
            <Field label="Mfg Date" value={form.mfgDate} onChange={(v) => setForm({ ...form, mfgDate: v })} type="date" />
            <Field label="Exp Date" value={form.expDate} onChange={(v) => setForm({ ...form, expDate: v })} type="date" />
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={!form.partNumber.trim() || saving} className="font-bold tracking-wide">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                RECEIVE
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-mono">STOCK</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {reels.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No reels received yet. Use the form above to log the first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {["Part No.", "Description", "Bin", "Batch", "Lot", "DC", "Qty", "Exp", "Status", "Line", "Action"].map((h) => (
                    <TableHead key={h} className="font-mono text-xs">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {reels.map((reel) => (
                  <TableRow key={reel.id}>
                    <TableCell className="font-mono font-semibold">{reel.partNumber}</TableCell>
                    <TableCell className="text-sm">{reel.description ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{reel.binNo ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{reel.batchNo ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{reel.lotNo ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{reel.dcCode ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{reel.qtyReceived ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{reel.expDate ?? "—"}</TableCell>
                    <TableCell className={`font-mono text-xs font-semibold ${STATUS_CLASS[reel.status]}`}>
                      {reel.status.replace("_", " ").toUpperCase()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{reel.currentLineName ?? "—"}</TableCell>
                    <TableCell>
                      {reel.status === "in_stock" ? (
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={`Line for reel ${reel.id}`}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            value={issueLine[reel.id] ?? ""}
                            onChange={(e) => setIssueLine({ ...issueLine, [reel.id]: e.target.value })}
                          >
                            <option value="">Select line…</option>
                            {lines.map((l) => (
                              <option key={l} value={l}>{l}</option>
                            ))}
                          </select>
                          <Button size="sm" onClick={() => void issue(reel)}>ISSUE</Button>
                        </div>
                      ) : reel.status === "issued" ? (
                        <Button size="sm" variant="outline" onClick={() => void setStatus(reel, "in_use")}>
                          MARK IN USE
                        </Button>
                      ) : reel.status === "in_use" ? (
                        <Button size="sm" variant="outline" onClick={() => void setStatus(reel, "consumed")}>
                          MARK CONSUMED
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-mono font-medium text-muted-foreground">{label}</label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
