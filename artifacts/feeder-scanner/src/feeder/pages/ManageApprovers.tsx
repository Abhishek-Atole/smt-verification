import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Trash2, UserCog } from "lucide-react";
import { logger } from "@/lib/logger";

type Category = "supervisor" | "qa" | "line";

interface Approver {
  id: number;
  name: string;
}

interface ApproversResponse {
  supervisors: Approver[];
  qa: Approver[];
  lines: Approver[];
}

// Manage the Supervisor / QA name rosters that the New Changeover form offers.
// Role-gated (qa/supervisor/admin) at the route level. Names are stored server
// side; add/delete go through /api/approvers and re-fetch the lists.
export default function ManageApprovers() {
  const { toast } = useToast();
  const [supervisors, setSupervisors] = useState<Approver[]>([]);
  const [qa, setQa] = useState<Approver[]>([]);
  const [lines, setLines] = useState<Approver[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvers", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load approvers (${res.status})`);
      const data = (await res.json()) as ApproversResponse;
      setSupervisors(Array.isArray(data.supervisors) ? data.supervisors : []);
      setQa(Array.isArray(data.qa) ? data.qa : []);
      setLines(Array.isArray(data.lines) ? data.lines : []);
    } catch (error) {
      logger.error({ error }, "Failed to load approvers");
      toast({ title: "Error", description: "Failed to load approvers", variant: "destructive" });
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

  return (
    <div className="w-full space-y-6 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="border-b border-border pb-4 flex items-center gap-3">
        <UserCog className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl lg:text-3xl font-mono font-bold tracking-tight text-foreground">
            MANAGE APPROVERS
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Names shown in the New Changeover Line, Supervisor and QA dropdowns
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ApproverSection
          title="Supervisors"
          category="supervisor"
          names={supervisors}
          onChanged={load}
        />
        <ApproverSection title="QA" category="qa" names={qa} onChanged={load} />
        <ApproverSection title="Lines" category="line" names={lines} onChanged={load} />
      </div>
    </div>
  );
}

function ApproverSection({
  title,
  category,
  names,
  onChanged,
}: {
  title: string;
  category: Category;
  names: Approver[];
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/approvers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ category, name }),
      });
      if (!res.ok) throw new Error(`Failed to add (${res.status})`);
      toast({ title: "Added", description: `${name} added to ${title}` });
      setNewName("");
      await onChanged();
    } catch (error) {
      logger.error({ error }, "Failed to add approver");
      toast({ title: "Error", description: "Failed to add name", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [newName, category, title, onChanged, toast]);

  const remove = useCallback(
    async (approver: Approver) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/approvers/${approver.id}`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        if (!res.ok) throw new Error(`Failed to delete (${res.status})`);
        toast({ title: "Removed", description: `${approver.name} removed from ${title}` });
        await onChanged();
      } catch (error) {
        logger.error({ error }, "Failed to remove approver");
        toast({ title: "Error", description: "Failed to remove name", variant: "destructive" });
      } finally {
        setBusy(false);
      }
    },
    [title, onChanged, toast],
  );

  return (
    <Card className="rounded-sm">
      <CardHeader>
        <CardTitle className="font-mono tracking-wide text-primary">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder={`Add ${title.toLowerCase()} name...`}
            className="rounded-sm"
            disabled={busy}
          />
          <Button type="button" onClick={() => void add()} disabled={busy || !newName.trim()} className="rounded-sm shrink-0">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>

        {names.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No names yet. Add one above.</p>
        ) : (
          <Table>
            <TableBody>
              {names.map((approver) => (
                <TableRow key={approver.id}>
                  <TableCell className="font-medium">{approver.name}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => void remove(approver)}
                      disabled={busy}
                      aria-label={`Remove ${approver.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
