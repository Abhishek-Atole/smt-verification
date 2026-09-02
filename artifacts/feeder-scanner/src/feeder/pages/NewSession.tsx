
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useListBoms, useCreateSession } from "@workspace/api-client-react";
import { useAuth } from "@/context/auth-context";
import { useScanner } from "@/hooks/useScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ChevronDown, Loader2, ScanLine, Search, Upload } from "lucide-react";
import { appConfig } from "@/lib/appConfig";
import { AppLogo } from "@/components/AppLogo";

const COMPANY_NAME = "UCAL ELECTRONICS PVT.LTD.";

// Compute the current shift + the date the shift STARTED.
// Morning 06:30–15:00 · Afternoon 15:00–23:30 · Night 23:30–06:30.
// A Night scan between 00:00–06:30 belongs to the PREVIOUS calendar day.
function computeShift(now: Date): { shiftName: string; shiftDate: string } {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= 390 && mins < 900) return { shiftName: "Morning", shiftDate: format(now, "yyyy-MM-dd") };
  if (mins >= 900 && mins < 1410) return { shiftName: "Afternoon", shiftDate: format(now, "yyyy-MM-dd") };
  const dateObj = new Date(now);
  if (mins < 390) dateObj.setDate(dateObj.getDate() - 1);
  return {
    shiftName: "Night",
    shiftDate: format(dateObj, "yyyy-MM-dd"),
  };
}

function NameSelect({
  label,
  names,
  value,
  onChange,
  required,
}: {
  label: string;
  names: string[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const isOther = value === "__other__" || (value && !names.includes(value));
  const selectVal = isOther ? "__other__" : value;

  return (
    <div className="space-y-2">
      <Label>{label}{required ? " *" : ""}</Label>
      <Select
        value={selectVal}
        onValueChange={(v) => onChange(v)}
        required={required}
      >
        <SelectTrigger className="bg-background rounded-sm">
          <SelectValue placeholder={`Select ${label.toLowerCase()}...`} />
        </SelectTrigger>
        <SelectContent>
          {names.map((n) => (
            <SelectItem key={n} value={n}>{n}</SelectItem>
          ))}
          <SelectItem value="__other__">Other (enter manually)</SelectItem>
        </SelectContent>
      </Select>
      {isOther && (
        <Input
          autoFocus
          required={required}
          placeholder={`Enter ${label.toLowerCase()} name`}
          value={value === "__other__" ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-background rounded-sm"
        />
      )}
    </div>
  );
}

export default function SessionNew() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: boms, isLoading: bomsLoading } = useListBoms();
  const createSession = useCreateSession();

  const [bomId, setBomId] = useState("");
  const [bomSearch, setBomSearch] = useState("");
  const [bomPickerOpen, setBomPickerOpen] = useState(false);
  const [freeScanMode, setFreeScanMode] = useState(false);
  // Free Scan has no BOM to derive the PCB/panel name from, so the supervisor
  // types it in manually. Feeds `panelName` on submit.
  const [freeScanPcbName, setFreeScanPcbName] = useState("");
  const [supervisorName, setSupervisorName] = useState("");
  const [qaName, setQaName] = useState("");
  const [machineName, setMachineName] = useState("");
  const [supervisorNames, setSupervisorNames] = useState<string[]>([]);
  const [qaNames, setQaNames] = useState<string[]>([]);
  const [lineNames, setLineNames] = useState<string[]>([]);
  const [machineNames, setMachineNames] = useState<string[]>([]);
  const [lineName, setLineName] = useState("");
  const [bomVerificationSkipped, setBomVerificationSkipped] = useState(false);
  const [verificationMode, setVerificationMode] = useState<"AUTO" | "AUTO_LEGACY">("AUTO");

  const operatorName = user?.name ?? "";
  // Free Scan Mode bypasses all BOM validation, so only supervisors may enable it.
  // Operators must run against a selected BOM. (The route only admits
  // supervisor/operator, so no qa branch is reachable here.)
  const canFreeScan = user?.role === "supervisor";
  // Trial (skip-BOM, data-collection) sessions are supervisor-only, same as Free Scan.
  const canStartTrial = user?.role === "supervisor";
  const defaultLogoUrl = appConfig.logoUrl ?? "";
  const { shiftName, shiftDate } = useMemo(() => computeShift(new Date()), []);

  // Approver rosters are managed at runtime (Manage Approvers screen) and read
  // from the API here. NameSelect still offers "Other" for one-off names.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/approvers", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          supervisors?: { name: string }[];
          qa?: { name: string }[];
          lines?: { name: string }[];
        };
        if (!active) return;
        setSupervisorNames(Array.isArray(data.supervisors) ? data.supervisors.map((s) => s.name) : []);
        setQaNames(Array.isArray(data.qa) ? data.qa.map((q) => q.name) : []);
        setLineNames(Array.isArray(data.lines) ? data.lines.map((l) => l.name) : []);
      } catch {
        // Leave lists empty on failure; "Other" still allows manual entry.
      }
    })();
    // Machine names come from the shared QA master list (/api/masters) — the same
    // list managed on Manage Approvers and the QA In-house Rejection screen.
    void (async () => {
      try {
        const res = await fetch("/api/masters", { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { machines?: { value: string }[] };
        if (!active) return;
        setMachineNames(Array.isArray(data.machines) ? data.machines.map((m) => m.value) : []);
      } catch {
        // Leave empty on failure; scan + "Other" still allow entry.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const machineScanner = useScanner({
    onSubmit: (v) => setMachineName(v),
    autoFocus: false,
  });

  const bomsArray = (Array.isArray(boms) ? boms : []).filter(
    (bom: any) => (bom.status ?? "active") === "active",
  );
  const selectedBom = bomsArray.find((bom) => bom.id.toString() === bomId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!freeScanMode && !bomId) return alert("Please select a BOM or enable Free Scan Mode");
    if (freeScanMode && !freeScanPcbName.trim()) return alert("Please enter the PCB name");
    const resolvedSupervisor = supervisorName === "__other__" ? "" : supervisorName;
    const resolvedQa = qaName === "__other__" ? "" : qaName;
    const resolvedMachine = machineName === "__other__" ? "" : machineName;
    if (!operatorName) return alert("Operator not identified — please sign in again");
    if (!lineName) return alert("Please select the line number");
    if (!resolvedSupervisor) return alert("Please select the supervisor");
    if (!resolvedQa) return alert("Please select the QA");
    if (!resolvedMachine) return alert("Please select or scan the machine");

    createSession.mutate({
      data: {
        bomId: freeScanMode ? 0 : Number(bomId),
        companyName: COMPANY_NAME,
        customerName: selectedBom?.customer || undefined,
        panelName: freeScanMode
          ? freeScanPcbName.trim()
          : selectedBom?.product || selectedBom?.name || "FREE SCAN",
        pcbName: freeScanMode ? freeScanPcbName.trim() : undefined,
        supervisorName: resolvedSupervisor,
        operatorName,
        qaName: resolvedQa,
        shiftName,
        shiftDate,
        machineName: resolvedMachine,
        lineName,
        logoUrl: defaultLogoUrl,
        verificationMode,
        bomVerificationSkipped,
      },
    }, {
      onSuccess: (session) => setLocation(`/session/${session.id}`),
      onError: (err: unknown) => {
        // Surface server-side gates (Module 2.1 max-2-per-line, Module 1 approval
        // requirements) to the operator instead of failing silently.
        const data = (err as { data?: { error?: string } })?.data;
        const message = (err as { message?: string })?.message;
        alert(data?.error ?? message ?? "Failed to start changeover");
      },
    });
  };

  if (bomsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const normalizedBomSearch = bomSearch.trim().toLowerCase();
  const showBomSearchResults = normalizedBomSearch.length >= 1;
  const filteredBoms = showBomSearchResults
    ? bomsArray.filter((bom) => {
        const name = (bom.name || "").toLowerCase();
        const description = (bom.description || "").toLowerCase();
        return name.includes(normalizedBomSearch) || description.includes(normalizedBomSearch);
      })
    : bomsArray;

  const canStart =
    !createSession.isPending &&
    (freeScanMode || Boolean(bomId)) &&
    (!freeScanMode || Boolean(freeScanPcbName.trim())) &&
    Boolean(operatorName) &&
    Boolean(lineName) &&
    Boolean(supervisorName) && supervisorName !== "__other__" &&
    Boolean(qaName) && qaName !== "__other__" &&
    Boolean(machineName) && machineName !== "__other__";

  return (
    <div className="w-full space-y-4 sm:space-y-6 lg:space-y-8 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
      {/* Header */}
      <div className="border-b border-border pb-3 sm:pb-4 flex items-center gap-2 sm:gap-3 lg:gap-4">
        <AppLogo className="h-10 sm:h-12 lg:h-14" />
        <div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-mono font-bold tracking-tight text-foreground">NEW CHANGEOVER</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 font-mono">
            Operator: <span className="text-foreground font-bold">{operatorName || "—"}</span>
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl bg-card p-4 sm:p-6 lg:p-8 border border-border rounded-sm space-y-6 sm:space-y-8 font-mono">
        {/* Step 1: BOM */}
        <div className="space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-primary border-b border-border pb-2 tracking-wide">1 · SELECT BOM</h2>
          {canFreeScan && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="free-scan"
                checked={freeScanMode}
                onChange={(e) => { setFreeScanMode(e.target.checked); if (e.target.checked) { setBomId(""); } else { setFreeScanPcbName(""); } }}
                className="w-4 h-4 rounded cursor-pointer"
              />
              <Label htmlFor="free-scan" className="text-sm font-medium cursor-pointer flex items-center gap-2">
                Free Scan Mode
                <span className="text-xs text-muted-foreground font-normal">(scan without BOM validation)</span>
              </Label>
            </div>
          )}
          {!freeScanMode && (
            <Popover
              open={bomPickerOpen}
              onOpenChange={(open) => { setBomPickerOpen(open); if (!open) setBomSearch(""); }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="flex w-full items-center justify-between whitespace-nowrap border px-3 py-2 shadow-sm bg-background rounded-sm border-primary text-sm h-10"
                  aria-expanded={bomPickerOpen}
                >
                  <span className="truncate">
                    {selectedBom ? `${selectedBom.name} (${selectedBom.itemCount} items)` : "Select a BOM..."}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <div className="border-b px-3 py-2">
                  <div className="flex items-center gap-2 rounded-sm border border-input bg-background px-3 py-2">
                    <Search className="h-4 w-4 shrink-0 opacity-50" />
                    <Input
                      value={bomSearch}
                      onChange={(e) => setBomSearch(e.target.value)}
                      placeholder="Type to search BOMs..."
                      className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                      autoComplete="off"
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {showBomSearchResults
                      ? `${filteredBoms.length} BOM${filteredBoms.length === 1 ? "" : "s"} found`
                      : "Start typing to see BOMs..."}
                  </p>
                </div>
                <ScrollArea className="h-72 w-full">
                  <div className="p-1">
                    {filteredBoms.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-muted-foreground">No BOMs match your search.</div>
                    ) : (
                      filteredBoms.map((bom) => (
                        <button
                          key={bom.id}
                          type="button"
                          onClick={() => { setBomId(bom.id.toString()); setBomPickerOpen(false); setBomSearch(""); }}
                          className={`flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${bomId === bom.id.toString() ? "bg-accent text-accent-foreground" : ""}`}
                        >
                          <span className="truncate">{bom.name}</span>
                          <span className="ml-3 shrink-0 text-xs text-muted-foreground">{bom.itemCount} items</span>
                        </button>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
          {freeScanMode && (
            <div className="space-y-3">
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 rounded-md text-sm text-amber-700 dark:text-amber-400">
                <p className="font-bold mb-1">Free Scan Mode Active</p>
                <p>You can scan any feeder numbers and spools without BOM validation.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="free-scan-pcb">PCB Name *</Label>
                <Input
                  id="free-scan-pcb"
                  value={freeScanPcbName}
                  onChange={(e) => setFreeScanPcbName(e.target.value)}
                  placeholder="Enter PCB / panel name"
                  className="bg-background rounded-sm"
                  autoComplete="off"
                />
              </div>
            </div>
          )}
          {/* Trial Session: skip BOM verification for data collection. Supervisor-only;
              no approval step — the supervisor starting it is the authority. */}
          {canStartTrial && (
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="skip-bom"
                checked={bomVerificationSkipped}
                onChange={(e) => setBomVerificationSkipped(e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer"
              />
              <label htmlFor="skip-bom" className="text-sm cursor-pointer flex items-center gap-2">
                Trial Session — skip BOM
                <span className="text-xs text-muted-foreground font-normal">(data collection · supervisor only)</span>
              </label>
            </div>
          )}

          {/* Verification mode: AUTO (scan feeder→MPN→auto-submit) or AUTO_LEGACY
              (feeders pre-loaded in BOM order — operator scans MPN + lot only). */}
          <div className="pt-2 space-y-2">
            <Label>Verification Mode</Label>
            <Select value={verificationMode} onValueChange={(v) => setVerificationMode(v as typeof verificationMode)}>
              <SelectTrigger className="bg-background rounded-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">Auto (scan feeder, then MPN — auto-submit)</SelectItem>
                <SelectItem value="AUTO_LEGACY">Auto Legacy (serial feeders — scan MPN + lot only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Step 2: Approvers */}
        <div className="space-y-4">
          <h2 className="text-base sm:text-lg font-bold text-primary border-b border-border pb-2 tracking-wide">2 · LINE & APPROVERS</h2>
          <NameSelect label="Line Number" names={lineNames} value={lineName} onChange={setLineName} required />
          <NameSelect label="Supervisor" names={supervisorNames} value={supervisorName} onChange={setSupervisorName} required />
          <NameSelect label="QA" names={qaNames} value={qaName} onChange={setQaName} required />
        </div>

        {/* Auto shift + date */}
        <div className="rounded-sm border border-border bg-background px-4 py-3 text-sm">
          <span className="text-muted-foreground">Shift (auto): </span>
          <span className="font-bold text-foreground">{shiftName}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-bold text-foreground">{shiftDate}</span>
        </div>

        {/* Step 3: Machine — pick from the shared machine list (/api/masters) or scan its QR */}
        <div className="space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-primary border-b border-border pb-2 tracking-wide">3 · MACHINE</h2>
          <NameSelect label="Machine" names={machineNames} value={machineName} onChange={setMachineName} required />
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or scan
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="flex items-center gap-2 rounded-sm border border-primary bg-background px-3 py-2">
            <ScanLine className="h-4 w-4 shrink-0 opacity-50" />
            <Input
              ref={machineScanner.inputRef}
              value={machineScanner.value}
              onChange={(e) => machineScanner.setValue(e.target.value)}
              onKeyDown={machineScanner.handleKeyDown}
              placeholder="Click here, then scan the machine QR..."
              className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 text-sm"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="pt-4 flex justify-center lg:justify-end">
          <Button
            type="submit"
            disabled={!canStart}
            className="w-full sm:w-auto font-mono text-sm sm:text-base tracking-wider rounded-sm px-6 sm:px-10 lg:px-12 py-2 h-10 sm:h-auto"
            data-testid="btn-start-run"
          >
            {createSession.isPending ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin mr-2" /> : <Upload className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />}
            <span className="hidden sm:inline">START CHANGEOVER</span>
            <span className="sm:hidden">START</span>
          </Button>
        </div>
      </form>
    </div>
  );
}


