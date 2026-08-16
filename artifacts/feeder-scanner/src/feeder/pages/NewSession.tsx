
import { useMemo, useState } from "react";
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
import { CheckCircle2, ChevronDown, Loader2, ScanLine, Search, Upload } from "lucide-react";
import { appConfig } from "@/lib/appConfig";
import { AppLogo } from "@/components/AppLogo";

const COMPANY_NAME = "UCAL ELECTRONICS PVT.LTD.";
const SUPERVISOR_NAMES = ["Umesh Nagile", "Dhupchand Bhardwaj", "Maruti Birader"];
const QA_NAMES = ["Ravi Patel", "Priya Singh", "Amit Kumar"];
// Placeholder engineer roster (same pool as supervisors for now) — replace with the real list.
const ENGINEER_NAMES = ["Umesh Nagile", "Dhupchand Bhardwaj", "Maruti Birader"];

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
  const [supervisorName, setSupervisorName] = useState("");
  const [qaName, setQaName] = useState("");
  const [engineerName, setEngineerName] = useState("");
  const [machineName, setMachineName] = useState("");

  const operatorName = user?.name ?? "";
  const defaultLogoUrl = appConfig.logoUrl ?? "";
  const { shiftName, shiftDate } = useMemo(() => computeShift(new Date()), []);

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
    const resolvedSupervisor = supervisorName === "__other__" ? "" : supervisorName;
    const resolvedQa = qaName === "__other__" ? "" : qaName;
    const resolvedEngineer = engineerName === "__other__" ? "" : engineerName;
    if (!operatorName) return alert("Operator not identified — please sign in again");
    if (!resolvedSupervisor) return alert("Please select the supervisor");
    if (!resolvedQa) return alert("Please select the QA");
    if (!resolvedEngineer) return alert("Please select the engineer");
    if (!machineName) return alert("Please scan the machine QR");

    createSession.mutate({
      data: {
        bomId: freeScanMode ? 0 : Number(bomId),
        companyName: COMPANY_NAME,
        customerName: selectedBom?.customer || undefined,
        panelName: selectedBom?.product || selectedBom?.name || "FREE SCAN",
        supervisorName: resolvedSupervisor,
        operatorName,
        qaName: resolvedQa,
        engineerName: resolvedEngineer,
        shiftName,
        shiftDate,
        machineName,
        logoUrl: defaultLogoUrl,
      },
    }, {
      onSuccess: (session) => setLocation(`/session/${session.id}`),
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
    Boolean(operatorName) &&
    Boolean(supervisorName) && supervisorName !== "__other__" &&
    Boolean(qaName) && qaName !== "__other__" &&
    Boolean(engineerName) && engineerName !== "__other__" &&
    Boolean(machineName);

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
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="free-scan"
              checked={freeScanMode}
              onChange={(e) => { setFreeScanMode(e.target.checked); if (e.target.checked) setBomId(""); }}
              className="w-4 h-4 rounded cursor-pointer"
            />
            <Label htmlFor="free-scan" className="text-sm font-medium cursor-pointer flex items-center gap-2">
              Free Scan Mode
              <span className="text-xs text-muted-foreground font-normal">(scan without BOM validation)</span>
            </Label>
          </div>
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
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 rounded-md text-sm text-amber-700 dark:text-amber-400">
              <p className="font-bold mb-1">Free Scan Mode Active</p>
              <p>You can scan any feeder numbers and spools without BOM validation.</p>
            </div>
          )}
        </div>

        {/* Step 2: Approvers */}
        <div className="space-y-4">
          <h2 className="text-base sm:text-lg font-bold text-primary border-b border-border pb-2 tracking-wide">2 · APPROVERS</h2>
          <NameSelect label="Supervisor" names={SUPERVISOR_NAMES} value={supervisorName} onChange={setSupervisorName} required />
          <NameSelect label="QA" names={QA_NAMES} value={qaName} onChange={setQaName} required />
          <NameSelect label="Engineer" names={ENGINEER_NAMES} value={engineerName} onChange={setEngineerName} required />
        </div>

        {/* Auto shift + date */}
        <div className="rounded-sm border border-border bg-background px-4 py-3 text-sm">
          <span className="text-muted-foreground">Shift (auto): </span>
          <span className="font-bold text-foreground">{shiftName}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-bold text-foreground">{shiftDate}</span>
        </div>

        {/* Step 3: Machine scan */}
        <div className="space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-primary border-b border-border pb-2 tracking-wide">3 · SCAN MACHINE QR</h2>
          {machineName ? (
            <div className="flex items-center justify-between gap-3 rounded-sm border border-green-500/50 bg-green-50 dark:bg-green-950/20 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {machineName}
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-sm text-xs"
                onClick={() => { setMachineName(""); machineScanner.reset(); machineScanner.inputRef.current?.focus(); }}
              >
                Re-scan
              </Button>
            </div>
          ) : (
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
          )}
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


