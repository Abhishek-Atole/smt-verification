import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertCircle } from "lucide-react";

interface OperatorEntry {
  id: string;
  name: string | null;
  employeeId: string | null;
  role: string;
}

interface HandoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  onSuccess?: () => void;
}

export function HandoverModal({
  open,
  onOpenChange,
  sessionId,
  onSuccess,
}: HandoverModalProps) {
  const [operators, setOperators] = useState<OperatorEntry[]>([]);
  const [supervisors, setSupervisors] = useState<OperatorEntry[]>([]);
  const [toOperatorId, setToOperatorId] = useState("");
  const [toSupervisorId, setToSupervisorId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const fetchOperators = async () => {
      setFetching(true);
      setError(null);
      try {
        const res = await fetch("/api/verification/handover/operators", {
          credentials: "include",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error ?? "Failed to load operators");
        }
        const data = await res.json();
        setOperators(data.operators ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load operators");
        setOperators([]);
      } finally {
        setFetching(false);
      }
    };

    fetchOperators();
  }, [open]);

  const handleCancel = () => {
    if (submitting) return;
    setToOperatorId("");
    setToSupervisorId("");
    setNotes("");
    setError(null);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!toOperatorId) {
      setError("Please select an incoming operator");
      return;
    }
    if (!sessionId) {
      setError("Session ID is missing");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/verification/handover/${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toOperatorId,
            toSupervisorId: toSupervisorId || undefined,
            notes: notes.trim() || undefined,
          }),
        },
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to initiate handover");
      }

      handleCancel();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handover failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Shift Handover</DialogTitle>
          <DialogDescription>
            Transfer this session to another operator. The session will be
            paused until the incoming operator accepts the handover.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {fetching ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="handover-operator">Incoming Operator *</Label>
                <Select
                  value={toOperatorId}
                  onValueChange={setToOperatorId}
                  disabled={submitting}
                >
                  <SelectTrigger id="handover-operator">
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        No operators available
                      </SelectItem>
                    )}
                    {operators.map((op) => (
                      <SelectItem key={op.id} value={op.id}>
                        {op.name ?? "Unnamed"}{" "}
                        {op.employeeId ? `(${op.employeeId})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="handover-supervisor">
                  Supervisor (optional)
                </Label>
                <Select
                  value={toSupervisorId}
                  onValueChange={setToSupervisorId}
                  disabled={submitting}
                >
                  <SelectTrigger id="handover-supervisor">
                    <SelectValue placeholder="Select supervisor" />
                  </SelectTrigger>
                  <SelectContent>
                    {supervisors.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        No supervisors available
                      </SelectItem>
                    )}
                    {supervisors.map((sup) => (
                      <SelectItem key={sup.id} value={sup.id}>
                        {sup.name ?? "Unnamed"}{" "}
                        {sup.employeeId ? `(${sup.employeeId})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="handover-notes">Notes</Label>
                <Input
                  id="handover-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional handover notes..."
                  disabled={submitting}
                />
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-sm bg-destructive/10 border border-destructive/30">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive font-medium">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !toOperatorId || fetching}
          >
            {submitting && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Initiate Handover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
