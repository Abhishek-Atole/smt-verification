
import { useState } from "react";
import { useListSessions } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Loader2, Search, ChevronRight, Trash2 } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { useAuth } from "@/context/auth-context";
import { formatSmtSessionCode } from "@/lib/session-code";

export default function SessionHistory() {
  const { user } = useAuth();
  const { data: sessions, isLoading } = useListSessions();
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedShift, setSelectedShift] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("");

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  // Defensive check: ensure sessions is an array
  const sessionsArray = Array.isArray(sessions) ? sessions : [];
  const sessionsWithChangeover = sessionsArray.map((session) => ({
    ...session,
    changeoverCode: formatSmtSessionCode(session.startTime, session.id),
  }));

  const canDelete = user?.role === "qa" || user?.role === "supervisor" || user?.role === "admin";

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this session? It will be moved to trash.")) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      window.location.reload();
    } catch {
      alert("Failed to delete session.");
    }
  };

  const getRevisionLabel = (session: any) => {
    const raw =
      session?.bomVersion ||
      session?.revisionLabel ||
      session?.bomRevision ||
      session?.revision ||
      "";
    const value = String(raw).trim();
    if (!value) return "";
    return /^rev/i.test(value) ? value : `Rev ${value}`;
  };

  const renderBomText = (session: any) => {
    if (session.bomId === 0) {
      return null;
    }

    const bomText = String(session.bomName || session.bomId || "N/A");
    const revisionText = getRevisionLabel(session);
    return revisionText ? `${bomText} (${revisionText})` : bomText;
  };

  // Get unique shifts and operators for filters
  const availableShifts = [...new Set(sessionsWithChangeover.map((s) => s.shiftName).filter(Boolean))].sort();
  const availableOperators = [...new Set(sessionsWithChangeover.map((s) => s.operatorName).filter(Boolean))].sort();
  
  const filtered = sessionsWithChangeover
    .filter((s) => {
      const searchValue = search.toLowerCase();
      const matchesSearch =
        s.changeoverCode.toLowerCase().includes(searchValue) ||
        s.panelName.toLowerCase().includes(searchValue) ||
        s.operatorName.toLowerCase().includes(searchValue) ||
        s.companyName.toLowerCase().includes(searchValue) ||
        (s.customerName && s.customerName.toLowerCase().includes(searchValue)) ||
        (s.bomName && s.bomName.toLowerCase().includes(searchValue));
      
      const matchesDate = !selectedDate || s.shiftDate === selectedDate;
      const matchesShift = !selectedShift || s.shiftName === selectedShift;
      const matchesOperator = !selectedOperator || s.operatorName === selectedOperator;
      
      return matchesSearch && matchesDate && matchesShift && matchesOperator;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Separate sessions into completed and active/resumable
  const completedSessions = filtered.filter(s => s.status === 'completed');
  const pendingSessions = filtered.filter(s => s.status !== 'completed');

  return (
    <div className="w-full space-y-4 sm:space-y-6 mt-6 sm:mt-8">
      {/* Header - Responsive */}
      <div className="px-4 sm:px-6 lg:px-8 flex flex-col gap-4 sm:gap-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <AppLogo className="h-10 sm:h-14" />
            <div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-foreground">SESSION HISTORY</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 font-mono">Past verification runs</p>
            </div>
          </div>
        </div>

        {/* Search - Full Width on Mobile */}
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Search by panel, operator, or BOM..." 
            className="pl-9 w-full bg-background border-border font-mono text-sm rounded-sm"
          />
        </div>

        {/* Filter Controls - Date, Shift, and Operator */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Date Filter */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono font-bold text-muted-foreground uppercase">Filter by Date</label>
            <Input 
              type="date"
              value={selectedDate} 
              onChange={e => setSelectedDate(e.target.value)} 
              className="bg-background border-border font-mono text-sm rounded-sm"
            />
          </div>

          {/* Shift Filter */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono font-bold text-muted-foreground uppercase">Filter by Shift</label>
            <select 
              value={selectedShift} 
              onChange={e => setSelectedShift(e.target.value)}
              className="px-3 py-2 bg-background border border-border text-foreground font-mono text-sm rounded-sm cursor-pointer hover:bg-secondary/50 transition-colors"
            >
              <option value="">All Shifts</option>
              {availableShifts.map(shift => (
                <option key={shift} value={shift}>{shift}</option>
              ))}
            </select>
          </div>

          {/* Operator Filter */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-mono font-bold text-muted-foreground uppercase">Filter by Operator</label>
            <select 
              value={selectedOperator} 
              onChange={e => setSelectedOperator(e.target.value)}
              className="px-3 py-2 bg-background border border-border text-foreground font-mono text-sm rounded-sm cursor-pointer hover:bg-secondary/50 transition-colors"
            >
              <option value="">All Operators</option>
              {availableOperators.map(operator => (
                <option key={operator} value={operator}>{operator}</option>
              ))}
            </select>
          </div>

          {/* Clear Filters */}
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
            <label className="text-xs font-mono font-bold text-muted-foreground uppercase">Actions</label>
            <Button
              onClick={() => {
                setSearch("");
                setSelectedDate("");
                setSelectedShift("");
                setSelectedOperator("");
              }}
              variant="outline"
              className="rounded-sm font-mono text-sm h-9"
            >
              Clear All Filters
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop Table View - Hidden on mobile */}
      <div className="hidden lg:block px-4 sm:px-6 lg:px-8 space-y-6">
        {/* Completed Sessions Section */}
        <div>
          <h2 className="text-lg font-mono font-bold text-foreground mb-4">COMPLETED SESSIONS</h2>
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-xs sm:text-sm">DATE / TIME</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">CHANGEOVER ID</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">PANEL</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">BOM</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">OPERATOR</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">SHIFT</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">STATUS</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm text-right">ACTION</TableHead>
                  {canDelete && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {completedSessions.length === 0 ? (
                  <TableRow className="border-border hover:bg-transparent">
                    <TableCell colSpan={canDelete ? 9 : 8} className="text-center py-8 text-muted-foreground font-mono text-sm">
                      No completed sessions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  completedSessions.map((session) => (
                    <TableRow key={session.id} className="border-border hover:bg-secondary/50 transition-colors">
                      <TableCell className="font-mono text-xs sm:text-sm">
                        <div>{format(new Date(session.startTime), "MMM dd, yyyy")}</div>
                        <div className="text-muted-foreground text-xs">{format(new Date(session.startTime), "HH:mm")}</div>
                      </TableCell>
                      <TableCell className="font-mono font-mono text-xs sm:text-sm text-foreground">
                        <span className="inline-block px-2 py-1 rounded-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-[11px] tracking-wide font-semibold">
                          {session.changeoverCode}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono font-bold text-primary text-sm">{session.panelName}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">
                        {session.bomId === 0 ? (
                          <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded text-amber-800 dark:text-amber-400 text-xs font-bold">FREE SCAN</span>
                        ) : (
                          <span>{renderBomText(session)}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{session.operatorName}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{session.shiftName || session.shiftDate}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider inline-block ${
                          session.status === 'completed' 
                            ? 'bg-success/20 text-success' 
                            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-600'
                        }`}>
                          {session.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="secondary" size="sm" className="rounded-sm font-mono text-xs sm:text-sm">
                          <Link href={`/session/${session.id}/report`}>
                            REPORT
                          </Link>
                        </Button>
                      </TableCell>
                      {canDelete && (
                        <TableCell>
                          <button
                            onClick={() => handleDelete(String(session.id))}
                            className="p-1.5 rounded-sm text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="Delete session"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pending/Resume Sessions Section */}
        <div>
          <h2 className="text-lg font-mono font-bold text-foreground mb-4">PENDING / RESUME SESSIONS</h2>
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-xs sm:text-sm">DATE / TIME</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">CHANGEOVER ID</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">PANEL</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">BOM</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">OPERATOR</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">SHIFT</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm">STATUS</TableHead>
                  <TableHead className="font-mono text-xs sm:text-sm text-right">ACTION</TableHead>
                  {canDelete && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingSessions.length === 0 ? (
                  <TableRow className="border-border hover:bg-transparent">
                    <TableCell colSpan={canDelete ? 9 : 8} className="text-center py-8 text-muted-foreground font-mono text-sm">
                      No pending sessions found.
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingSessions.map((session) => (
                    <TableRow key={session.id} className="border-border hover:bg-secondary/50 transition-colors">
                      <TableCell className="font-mono text-xs sm:text-sm">
                        <div>{format(new Date(session.startTime), "MMM dd, yyyy")}</div>
                        <div className="text-muted-foreground text-xs">{format(new Date(session.startTime), "HH:mm")}</div>
                      </TableCell>
                      <TableCell className="font-mono font-mono text-xs sm:text-sm text-foreground">
                        <span className="inline-block px-2 py-1 rounded-sm bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100 text-[11px] tracking-wide font-semibold">
                          {session.changeoverCode}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono font-bold text-primary text-sm">{session.panelName}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">
                        {session.bomId === 0 ? (
                          <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded text-amber-800 dark:text-amber-400 text-xs font-bold">FREE SCAN</span>
                        ) : (
                          <span>{renderBomText(session)}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{session.operatorName}</TableCell>
                      <TableCell className="font-mono text-xs sm:text-sm">{session.shiftName || session.shiftDate}</TableCell>
                      <TableCell>
                        <span className="px-2 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider inline-block bg-primary/20 text-primary">
                          {session.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="secondary" size="sm" className="rounded-sm font-mono text-xs sm:text-sm">
                          <Link href={`/session/${session.id}`}>
                            RESUME
                          </Link>
                        </Button>
                      </TableCell>
                      {canDelete && (
                        <TableCell>
                          <button
                            onClick={() => handleDelete(String(session.id))}
                            className="p-1.5 rounded-sm text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="Delete session"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Mobile/Tablet Card View */}
      <div className="lg:hidden px-4 sm:px-6 space-y-6">
        {/* Completed Sessions Section */}
        <div>
          <h2 className="text-base font-mono font-bold text-foreground mb-3">COMPLETED SESSIONS</h2>
          {completedSessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground font-mono text-sm">
              No completed sessions found.
            </div>
          ) : (
            <div className="space-y-3">
              {completedSessions.map(session => (
                <Link key={session.id} href={`/session/${session.id}/report`}>
                  <div className="bg-card border border-border rounded-lg p-4 hover:bg-secondary/50 transition-colors active:bg-secondary cursor-pointer tap-highlight-transparent">
                    {/* Top Row: Date and Status */}
                    <div className="flex justify-between items-start mb-3 gap-2">
                      <div className="flex-1">
                        <div className="font-mono text-xs text-muted-foreground">
                          {format(new Date(session.startTime), "MMM dd, yyyy HH:mm")}
                        </div>
                      </div>
                      <span className={`px-2 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider whitespace-nowrap flex-shrink-0 ${
                        session.status === 'completed'
                          ? 'bg-success/20 text-success'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-600'
                      }`}>
                        {session.status}
                      </span>
                    </div>

                    <div className="mb-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">CHANGEOVER ID</div>
                        <div className="font-mono font-semibold text-sm truncate">{session.changeoverCode}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground font-mono">SHIFT</div>
                        <div className="font-mono text-sm truncate">{session.shiftName || session.shiftDate}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">COMPANY</div>
                        <div className="font-mono text-xs truncate">{session.companyName || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">CUSTOMER</div>
                        <div className="font-mono text-xs truncate">{session.customerName || "—"}</div>
                      </div>
                    </div>

                    {/* Panel Name - Prominent */}
                    <div className="mb-3">
                      <div className="text-xs text-muted-foreground font-mono">PANEL</div>
                      <div className="font-mono font-bold text-primary text-base truncate">
                        {session.panelName}
                      </div>
                    </div>

                    {/* BOM and Operator - Two Columns */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">BOM</div>
                        <div className="font-mono text-xs truncate flex items-center gap-2">
                          {session.bomId === 0 ? (
                            <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded text-amber-800 dark:text-amber-400 text-xs font-bold">FREE</span>
                          ) : (
                            <span>{renderBomText(session)}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">OPERATOR</div>
                        <div className="font-mono text-xs truncate">
                          {session.operatorName}
                        </div>
                      </div>
                    </div>

                    {/* Action Button - Full Width on Mobile, Icon on Tablet */}
                    <Button 
                      asChild 
                      variant="secondary" 
                      className="w-full rounded-md font-mono text-sm py-2 h-auto flex items-center justify-between"
                    >
                      <div>
                        <span>VIEW REPORT</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </Button>
                  </div>
                  {canDelete && (
                    <div className="border-t border-border px-4 py-2 flex justify-end">
                      <button
                        onClick={() => handleDelete(String(session.id))}
                        className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Pending/Resume Sessions Section */}
        <div>
          <h2 className="text-base font-mono font-bold text-foreground mb-3">PENDING / RESUME SESSIONS</h2>
          {pendingSessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground font-mono text-sm">
              No pending sessions found.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingSessions.map(session => (
                <Link key={session.id} href={`/session/${session.id}`}>
                  <div className="bg-card border border-border rounded-lg p-4 hover:bg-secondary/50 transition-colors active:bg-secondary cursor-pointer tap-highlight-transparent">
                    {/* Top Row: Date and Status */}
                    <div className="flex justify-between items-start mb-3 gap-2">
                      <div className="flex-1">
                        <div className="font-mono text-xs text-muted-foreground">
                          {format(new Date(session.startTime), "MMM dd, yyyy HH:mm")}
                        </div>
                      </div>
                      <span className="px-2 py-1 text-xs font-mono font-bold rounded-sm uppercase tracking-wider whitespace-nowrap flex-shrink-0 bg-primary/20 text-primary">
                        {session.status}
                      </span>
                    </div>

                    <div className="mb-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">CHANGEOVER ID</div>
                        <div className="font-mono font-semibold text-sm truncate">{session.changeoverCode}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground font-mono">SHIFT</div>
                        <div className="font-mono text-sm truncate">{session.shiftName || session.shiftDate}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">COMPANY</div>
                        <div className="font-mono text-xs truncate">{session.companyName || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">CUSTOMER</div>
                        <div className="font-mono text-xs truncate">{session.customerName || "—"}</div>
                      </div>
                    </div>

                    {/* Panel Name - Prominent */}
                    <div className="mb-3">
                      <div className="text-xs text-muted-foreground font-mono">PANEL</div>
                      <div className="font-mono font-bold text-primary text-base truncate">
                        {session.panelName}
                      </div>
                    </div>

                    {/* BOM and Operator - Two Columns */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">BOM</div>
                        <div className="font-mono text-xs truncate flex items-center gap-2">
                          {session.bomId === 0 ? (
                            <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded text-amber-800 dark:text-amber-400 text-xs font-bold">FREE</span>
                          ) : (
                            <span>{renderBomText(session)}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground font-mono">OPERATOR</div>
                        <div className="font-mono text-xs truncate">
                          {session.operatorName}
                        </div>
                      </div>
                    </div>

                    {/* Action Button - Full Width on Mobile, Icon on Tablet */}
                    <Button 
                      asChild 
                      variant="secondary" 
                      className="w-full rounded-md font-mono text-sm py-2 h-auto flex items-center justify-between"
                    >
                      <div>
                        <span>RESUME</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </Button>
                  </div>
                  {canDelete && (
                    <div className="border-t border-border px-4 py-2 flex justify-end">
                      <button
                        onClick={() => handleDelete(String(session.id))}
                        className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
