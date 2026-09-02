
import { useListSessions, useListBoms, useGetAnalyticsOverview, getGetAnalyticsOverviewQueryKey, getListSessionsQueryKey, useGetAnalyticsPareto, getGetAnalyticsParetoQueryKey, useGetAnalyticsTrends, getGetAnalyticsTrendsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Play, Boxes, CheckCircle2, Loader2, BarChart3, Clock, Trash2, TrendingUp, AlertTriangle, Zap, ChevronDown, ChevronUp, Activity, Target, Timer, GitBranch } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useState, useEffect, useMemo } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AppLogo } from "@/components/AppLogo";
import { appConfig } from "@/lib/appConfig";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, AreaChart, Area, RadialBarChart, RadialBar } from "recharts";

export default function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: sessions, isLoading: sessionsLoading, refetch: refetchSessions } = useListSessions();
  
  // ALTERNATIVE APPROACH: Try using mutation-level callbacks instead
  // Uncomment this entire section and comment out the handleDeleteSession function below
  // if call-level callbacks don't work
  /*
  const deleteSessionMutation = useDeleteSession({
        setDeletingSessionId(null);
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        alert("Session deleted successfully");
      },
      onError: (error: any) => {
        setDeletingSessionId(null);
        const errorMsg = error?.data?.error || error?.message || "Unknown error";
        alert(`Failed to delete session: ${errorMsg}`);
      }
    }
  });
  
  const handleDeleteSession = (sessionId: number) => {
    const confirmed = window.confirm("Are you sure you want to delete this session? This action cannot be undone.");
    if (!confirmed) return;
    setDeletingSessionId(sessionId);
    deleteSessionMutation.mutate({ sessionId });
  };
  */

  // PRIMARY APPROACH: Using call-level callbacks
  const deleteSessionMutation = useMutation({
    mutationFn: ({ sessionId }: { sessionId: number }) =>
      api.delete(`/api/sessions/${sessionId}`),
  });
  const { data: boms, isLoading: bomsLoading } = useListBoms();
  const { data: overview, isLoading: overviewLoading, isError: overviewError } = useGetAnalyticsOverview({
    query: { 
      queryKey: getGetAnalyticsOverviewQueryKey(),
      enabled: user?.role === "qa" || user?.role === "supervisor",
      retry: 1
    }
  });

  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showTrashBin, setShowTrashBin] = useState(false);
  const [showAllActiveSessions, setShowAllActiveSessions] = useState(false);
  const [showAllCompletedSessions, setShowAllCompletedSessions] = useState(false);
  const [showAllAdminControls, setShowAllAdminControls] = useState(false);
  const [recoveringSessionId, setRecoveringSessionId] = useState<number | null>(null);
  // Module 4: pending handovers now come from the live session model
  // (changeover_operators joined to sessions), so id/sessionId are integers —
  // they used to be the dead changeover_sessions text ids.
  const [pendingHandovers, setPendingHandovers] = useState<Array<{
    id: number;
    sessionId: number;
    fromOperatorName: string | null;
    initiatedAt: string;
    notes: string | null;
  }>>([]);
  const [showRealTimeDashboard, setShowRealTimeDashboard] = useState(false);
  const [showAnalyticsDashboard, setShowAnalyticsDashboard] = useState(false);
  const [sessionIdForRealTime, setSessionIdForRealTime] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("verification");
  const [activeSessionsList, setActiveSessionsList] = useState<Array<{ id: number; bomName: string; status: string }>>([]);
  
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
  const COLORS = {
    pass: "#047857", mismatch: "#B91C1C", alternate: "#B45309", neutral: "#475569",
    slate100: "#F1F5F9", slate200: "#E2E8F0", slate400: "#94A3B8", slate700: "#334155", slate900: "#0F172A",
    amber700: "#B45309", indigo700: "#4338CA", emerald700: "#047857", ruby700: "#B91C1C",
  };

  // Industrial palette for charts
  const PALETTE = {
    slate900: "#0F172A", slate800: "#1E293B", slate700: "#334155", slate600: "#475569",
    slate500: "#64748B", slate400: "#94A3B8", slate300: "#CBD5E1", slate200: "#E2E8F0",
    slate100: "#F1F5F9", slate50: "#F8FAFC", white: "#FFFFFF",
    amber700: "#B45309", amber50: "#FFFBEB",
    emerald700: "#047857", emerald50: "#ECFDF5",
    ruby700: "#B91C1C", ruby50: "#FEF2F2",
    indigo700: "#4338CA", indigo50: "#EEF2FF",
  };

  // Splice stats for hero KPIs
  const { data: spliceStats } = useQuery({
    queryKey: ["dashboard-splice-stats"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/dashboard/splice-stats`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{
        total: number; last7d: number; last30d: number; avgDurationSeconds: number;
        byMatchField: Array<{ field: string; count: number }>;
        dailyTrend: Array<{ day: string; count: number }>;
      }>;
    },
    refetchInterval: 30000,
  });

  // Trash bin hooks
  const deletedSessionsQueryKey = ["deleted-sessions"] as const;
  const { data: deletedSessions, isLoading: deletedSessionsLoading, refetch: refetchDeletedSessions } = useQuery({
    queryKey: deletedSessionsQueryKey,
    queryFn: async () => {
      const response = await api.get("/api/sessions/deleted");
      return response.data;
    },
    enabled: showTrashBin,
  });
  
  // Fetch comprehensive trash items (all data types)
  const { data: trashItems, isLoading: trashItemsLoading } = useQuery({
    queryKey: ["trash-items"],
    queryFn: async () => {
      const response = await api.get("/api/trash/items", {
        params: { limit: 100 }
      });
      return response.data as any;
    },
    enabled: showTrashBin,
    refetchInterval: 5000,
  });
  
  // Fetch comprehensive trash stats
  const { data: trashStats } = useQuery({
    queryKey: ["trash-stats"],
    queryFn: async () => {
      const response = await api.get("/api/trash/stats");
      return response.data as any;
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Real-Time Dashboard Queries (only when section is expanded and user is QA)
  const { data: kpi, isLoading: loadingKpi } = useQuery({
    queryKey: ["dashboard-kpi", sessionIdForRealTime],
    queryFn: async () => {
      const params = sessionIdForRealTime ? `?sessionId=${sessionIdForRealTime}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/kpi${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPI");
      return res.json();
    },
    enabled: showRealTimeDashboard && (user?.role === "qa" || user?.role === "supervisor"),
    refetchInterval: sessionIdForRealTime ? 2000 : false,
    staleTime: 0,
  });

  const { data: feeders, isLoading: loadingFeeders } = useQuery({
    queryKey: ["dashboard-feeder-analysis", sessionIdForRealTime],
    queryFn: async () => {
      const params = sessionIdForRealTime ? `?sessionId=${sessionIdForRealTime}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/feeder-analysis${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch feeder analysis");
      return res.json();
    },
    enabled: showRealTimeDashboard && (user?.role === "qa" || user?.role === "supervisor"),
    refetchInterval: sessionIdForRealTime ? 2000 : false,
  });

  const { data: components, isLoading: loadingComponents } = useQuery({
    queryKey: ["dashboard-component-analysis", sessionIdForRealTime],
    queryFn: async () => {
      const params = sessionIdForRealTime ? `?sessionId=${sessionIdForRealTime}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/component-analysis${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch component analysis");
      return res.json();
    },
    enabled: showRealTimeDashboard && (user?.role === "qa" || user?.role === "supervisor"),
    refetchInterval: sessionIdForRealTime ? 2000 : false,
  });

  const { data: timeAnalysis, isLoading: loadingTime } = useQuery({
    queryKey: ["dashboard-time-analysis", sessionIdForRealTime],
    queryFn: async () => {
      const params = sessionIdForRealTime ? `?sessionId=${sessionIdForRealTime}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/time-analysis${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch time analysis");
      return res.json();
    },
    enabled: showRealTimeDashboard && (user?.role === "qa" || user?.role === "supervisor"),
    refetchInterval: sessionIdForRealTime ? 2000 : false,
  });

  // Analytics Dashboard Queries (only when section is expanded)
  const [analyticsSessionId, setAnalyticsSessionId] = useState<string>("all");
  const paretoParams = analyticsSessionId !== "all" ? { sessionId: Number(analyticsSessionId) } : undefined;
  
  const { data: pareto, isLoading: loadingPareto } = useGetAnalyticsPareto(paretoParams, {
    query: { 
      enabled: showAnalyticsDashboard && (user?.role === "qa" || user?.role === "supervisor"),
      queryKey: getGetAnalyticsParetoQueryKey(paretoParams)
    }
  });

  const { data: trends, isLoading: loadingTrends } = useGetAnalyticsTrends({
    query: { 
      enabled: showAnalyticsDashboard && (user?.role === "qa" || user?.role === "supervisor"),
      queryKey: getGetAnalyticsTrendsQueryKey()
    }
  });

  // Fetch active sessions for real-time dashboard selector
  useEffect(() => {
    if (showRealTimeDashboard) {
      const fetchSessions = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/sessions`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            const actives = data.sessions?.filter((s: any) => s.status === "active") || [];
            setActiveSessionsList(actives);
            if (actives.length > 0 && !sessionIdForRealTime) {
              setSessionIdForRealTime(String(actives[0].id));
            }
          }
        } catch (err) {
          // Failed to fetch sessions
        }
      };
      fetchSessions();
    }
  }, [showRealTimeDashboard]);
  
  const recoverSessionMutation = useMutation({
    mutationFn: ({ sessionId }: { sessionId: number }) =>
      api.post(`/api/sessions/${sessionId}/recover`),
  });

  useEffect(() => {
    if (!deletingSessionId || !deleteSessionMutation.isPending) {
      setElapsedMs(0);
      return;
    }

    const startTime = Date.now();
    let frameId: number;
    
    const updateElapsed = () => {
      const elapsed = Date.now() - startTime;
      setElapsedMs(elapsed);
      frameId = requestAnimationFrame(updateElapsed);
    };
    
    frameId = requestAnimationFrame(updateElapsed);
    return () => cancelAnimationFrame(frameId);
  }, [deletingSessionId, deleteSessionMutation.isPending]);

  const acceptHandover = async (handoverId: number, sessionId: number) => {
    try {
      const res = await fetch(`/api/verification/handover/${sessionId}/accept`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setPendingHandovers((prev) => prev.filter((h) => h.id !== handoverId));
        // Accepting grants session access, so the scoped session lists change.
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      }
    } catch {
      // Silently fail
    }
  };

  const rejectHandover = async (handoverId: number, sessionId: number) => {
    try {
      const res = await fetch(`/api/verification/handover/${sessionId}/reject`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setPendingHandovers((prev) => prev.filter((h) => h.id !== handoverId));
      }
    } catch {
      // Silently fail
    }
  };

  useEffect(() => {
    const fetchPendingHandovers = async () => {
      try {
        const res = await fetch("/api/verification/handover/pending", {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setPendingHandovers(data.handovers ?? []);
        }
      } catch {
        setPendingHandovers([]);
      }
    };
    fetchPendingHandovers();
    const interval = setInterval(fetchPendingHandovers, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleDeleteSession = async (sessionId: number) => {
    const confirmed = window.confirm("Are you sure you want to delete this session? This action cannot be undone.");
    if (!confirmed) {
      return;
    }
    
    // Show loading immediately
    setDeletingSessionId(sessionId);
    
    try {
      deleteSessionMutation.mutate(
        { sessionId },
        {
          onSuccess: (data) => {
            setDeletingSessionId(null);
            // Invalidate sessions query to refetch
            queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          },
          onError: (error: any) => {
            setDeletingSessionId(null);
            const errorMsg = error?.response?.data?.error || error?.data?.error || error?.message || "Unknown error";
            alert(`Failed to delete session: ${errorMsg}`);
          },
          onSettled: () => {
          }
        }
      );
    } catch (err) {
      setDeletingSessionId(null);
      alert("An unexpected error occurred");
    }
  };

  const [recoveringTrashItem, setRecoveringTrashItem] = useState<{ type: string; id: number } | null>(null);
  const [deletingTrashItem, setDeletingTrashItem] = useState<{ type: string; id: number } | null>(null);

  const handleRecoverSession = async (sessionId: number, sessionName: string) => {
    const confirmed = window.confirm(`Are you sure you want to recover "${sessionName}" from trash?`);
    if (!confirmed) return;

    setRecoveringSessionId(sessionId);
    
    recoverSessionMutation.mutate(
      { sessionId },
      {
        onSuccess: () => {
          setRecoveringSessionId(null);
          queryClient.invalidateQueries({ queryKey: deletedSessionsQueryKey });
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
          refetchDeletedSessions();
        },
        onError: (error: any) => {
          setRecoveringSessionId(null);
          const errorMsg = error?.response?.data?.error || error?.data?.error || error?.message || "Unknown error";
          alert(`Failed to recover session: ${errorMsg}`);
        }
      }
    );
  };

  const handleRecoverTrashItem = async (itemType: string, itemId: number, itemName: string) => {
    const confirmed = window.confirm(`Are you sure you want to recover "${itemName}" from trash?`);
    if (!confirmed) return;

    setRecoveringTrashItem({ type: itemType, id: itemId });
    
    try {
      const response = await api.post(`/api/trash/${itemType}/${itemId}/recover`);
      if ((response as any).status === 200 || (response as any).status === 204) {
        queryClient.invalidateQueries({ queryKey: ["trash-items"] });
        queryClient.invalidateQueries({ queryKey: ["trash-stats"] });
        setRecoveringTrashItem(null);
        alert(`"${itemName}" recovered successfully!`);
      }
    } catch (error: any) {
      setRecoveringTrashItem(null);
      const errorMsg = error?.response?.data?.error || error?.message || "Unknown error";
      alert(`Failed to recover item: ${errorMsg}`);
    }
  };

  const handlePermanentDeleteTrashItem = async (itemType: string, itemId: number, itemName: string) => {
    const confirmed = window.confirm(`Permanently delete "${itemName}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingTrashItem({ type: itemType, id: itemId });
    
    try {
      const response = await api.delete(`/api/trash/${itemType}/${itemId}`);
      if ((response as any).status === 200 || (response as any).status === 204) {
        queryClient.invalidateQueries({ queryKey: ["trash-items"] });
        queryClient.invalidateQueries({ queryKey: ["trash-stats"] });
        setDeletingTrashItem(null);
        alert(`"${itemName}" permanently deleted.`);
      }
    } catch (error: any) {
      setDeletingTrashItem(null);
      const errorMsg = error?.response?.data?.error || error?.message || "Unknown error";
      alert(`Failed to delete item: ${errorMsg}`);
    }
  };

  // Show loading screen only if sessions or boms are loading
  // For overview, if it errors, we'll just render without it
  if (sessionsLoading || bomsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Delete loading overlay
  const DeleteLoadingOverlay = () => {
    if (!deletingSessionId || !deleteSessionMutation.isPending) return null;
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 pointer-events-auto animate-in fade-in duration-300">
        <div className="bg-background rounded-xl shadow-2xl p-8 flex flex-col items-center gap-4 border border-primary/30">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
          <p className="text-base font-semibold text-foreground">Deleting session...</p>
          <p className="text-xs text-muted-foreground">Please wait</p>
          <p className="text-xs text-primary/70 font-mono">{elapsedMs}ms</p>
        </div>
      </div>
    );
  };

  // Recovery loading overlay
  const RecoveryLoadingOverlay = () => {
    if (!recoveringSessionId || !recoverSessionMutation.isPending) return null;
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 pointer-events-auto animate-in fade-in duration-300">
        <div className="bg-background rounded-xl shadow-2xl p-8 flex flex-col items-center gap-4 border border-success/30">
          <Loader2 className="w-12 h-12 animate-spin text-success" />
          <p className="text-base font-semibold text-foreground">Recovering session...</p>
          <p className="text-xs text-muted-foreground">Please wait</p>
        </div>
      </div>
    );
  };

  // Defensive check: ensure sessions is an array
  const sessionsArray = Array.isArray(sessions) ? sessions : [];
  const bomsArray = Array.isArray(boms) ? boms : [];

  const activeSessions = sessionsArray.filter(s => s.status === "active");
  const completedSessions = sessionsArray.filter(s => s.status === "completed");
  const totalBoms = bomsArray.length;

  // OPERATOR VIEW
  if (user?.role === "operator") {
    return (
      <>
        <div className="min-h-screen bg-gradient-to-b from-background to-secondary/5 p-4 sm:p-8 lg:p-12">
          <div className="w-full space-y-10 animate-in fade-in duration-500">
            <div className="flex flex-col items-center justify-center py-12 sm:py-16 text-center space-y-6">
              <div className="flex items-center justify-center gap-3 mb-2">
                  <AppLogo className="h-12 sm:h-16" />
                <div className="hidden sm:block h-8 w-px bg-border" />
                <div className="text-left">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Welcome • {appConfig.companyShort}</p>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground">Ready to Scan</h1>
                </div>
              </div>
              <p className="text-sm sm:text-base text-muted-foreground max-w-2xl leading-relaxed">
                Start a new verification session or resume an active one to begin quality assurance checks.
              </p>
              <div className="pt-6">
                <Button asChild size="lg" className="h-16 px-10 text-lg font-bold rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 active:translate-y-0 transition-all duration-300 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70" data-testid="btn-start-session">
                  <Link href="/session/new">⚡ Start New Session</Link>
                </Button>
              </div>
            </div>

            {pendingHandovers.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-4 rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                      ⏳ Pending Shift Handover{pendingHandovers.length > 1 ? "s" : ""}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      {pendingHandovers.length === 1
                        ? "A session has been handed over to you. Accept or reject to continue."
                        : `${pendingHandovers.length} sessions have been handed over to you.`}
                    </p>
                  </div>
                </div>
                {pendingHandovers.map((ho) => (
                  <div key={ho.id} className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-white dark:bg-amber-950/10">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        Changeover #{ho.sessionId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        From: {ho.fromOperatorName ?? "Unknown"} &middot;{" "}
                        {new Date(ho.initiatedAt).toLocaleString()}
                      </p>
                      {ho.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic truncate">{ho.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="h-8 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => acceptHandover(ho.id, ho.sessionId)}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 text-xs font-bold border-red-300 text-red-700 hover:bg-red-50"
                        onClick={() => rejectHandover(ho.id, ho.sessionId)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeSessions.length > 0 && (
              <div className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg sm:text-xl font-bold border-b border-border pb-2 flex items-center gap-2">
                    <Play className="w-4 sm:w-5 h-4 sm:h-5 text-primary flex-shrink-0" /> Active Sessions
                  </h2>
                  {activeSessions.length > 4 && (
                    <button
                      onClick={() => setShowAllActiveSessions(!showAllActiveSessions)}
                      className="text-xs px-3 py-1  text-blue-600 hover:text-blue-700 font-semibold transition-colors"
                    >
                      {showAllActiveSessions ? "Show Less ↑" : `View All (${activeSessions.length}) ↓`}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5 items-stretch">
                  {(showAllActiveSessions ? activeSessions : activeSessions.slice(0, 4)).map(session => (
                    <Card key={session.id} className="h-full flex flex-col bg-gradient-to-br from-blue-50/50 to-blue-50/20 dark:from-blue-950/20 dark:to-background border-blue-200 dark:border-blue-800 hover:border-blue-400 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 cursor-pointer overflow-hidden">
                      <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-400"></div>
                      <CardHeader className="pb-3 sm:pb-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <CardTitle className="text-base sm:text-lg font-bold truncate leading-tight text-foreground">
                            {session.panelName}
                          </CardTitle>
                          <span className="text-xs px-3 py-1 bg-blue-500/90 text-white rounded-full font-semibold flex-shrink-0 whitespace-nowrap">Active</span>
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground line-clamp-1">{session.shiftName}</p>
                      </CardHeader>
                      <CardContent className="mt-auto space-y-3">
                        <div className="text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded line-clamp-1">
                          BOM: {session.bomName || session.bomId}
                        </div>
                        <Button asChild className="w-full font-bold py-2 h-10 rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50 hover:shadow-md transition-all duration-200" data-testid={`btn-resume-session-${session.id}`}>
                          <Link href={`/session/${session.id}`}>▶ RESUME</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {completedSessions.length > 0 && (
              <div className="space-y-3 sm:space-y-4">
                <h2 className="text-lg sm:text-xl font-bold border-b border-border pb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 sm:w-5 h-4 sm:h-5 text-success flex-shrink-0" /> Completed Sessions
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground mb-3">Incomplete sessions available for deletion:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5 items-stretch">
                  {completedSessions.map(session => {
                    const isIncomplete = !session.scans || session.scans.length === 0;
                    if (!isIncomplete) return null;
                    return (
                      <Card key={session.id} className="h-full flex flex-col bg-gradient-to-br from-amber-50/50 to-amber-50/20 dark:from-amber-950/20 dark:to-background border-amber-200 dark:border-amber-800 hover:border-amber-400 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-amber-500 to-amber-400"></div>
                        <CardHeader className="pb-3 sm:pb-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <CardTitle className="text-base sm:text-lg font-bold truncate leading-tight text-foreground">
                              {session.panelName}
                            </CardTitle>
                            <span className="text-xs px-3 py-1 bg-amber-500/90 text-white rounded-full font-semibold flex-shrink-0 whitespace-nowrap">Incomplete</span>
                          </div>
                          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-1">{session.shiftName}</p>
                        </CardHeader>
                        <CardContent className="mt-auto space-y-3">
                          <div className="text-xs text-muted-foreground bg-muted/40 px-2 py-1 rounded line-clamp-1">
                            BOM: {session.bomName || "N/A"}
                          </div>
                          <div className="flex gap-2 w-full">
                            {(user?.role === "qa" || user?.role === "supervisor") && (
                              <Button asChild className="flex-1 font-semibold py-2 h-9 text-sm rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50" size="sm">
                                <Link href={`/session/${session.id}/report`}>📋 VIEW</Link>
                              </Button>
                            )}
                            <Button className="font-semibold py-2 h-9 text-sm rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50 transition-all duration-200" size="sm" disabled={deleteSessionMutation.isPending && deletingSessionId === session.id} onClick={() => handleDeleteSession(session.id)}>
                              {deleteSessionMutation.isPending && deletingSessionId === session.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <>🗑️ DELETE</>
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
        <DeleteLoadingOverlay />
        <RecoveryLoadingOverlay />
      </>
    );
  }

  // QA ENGINEER VIEW
  if (user?.role === "qa") {
    return (
      <>
        <div className="min-h-screen bg-gradient-to-b from-background to-secondary/5 p-4 sm:p-8 lg:p-12">
        <div className="w-full space-y-10 animate-in fade-in duration-500">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div className="flex items-center gap-4">
              <AppLogo className="h-14 sm:h-16 flex-shrink-0" />
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">{appConfig.companyShort} Quality Assurance</p>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-foreground">QA Dashboard</h1>
              </div>
            </div>
            <Button asChild className="font-bold gap-2 h-12 px-6 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5" size="lg">
              <Link href="/analytics">
                📊 Analytics
              </Link>
            </Button>
          </div>

          {/* HERO KPIs — Industrial palette */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {(() => {
              const fpy = overview?.overallOkRate ?? 0;
              const active = overview?.activeSessions ?? 0;
              const avgMin = overview?.avgDurationMinutes ?? 0;
              const totalSplices = spliceStats?.total ?? 0;
              const heroes = [
                { label: "First Pass Yield", value: `${fpy.toFixed(1)}%`, sub: "Overall OK rate", icon: Target, accent: fpy >= 95 ? "emerald" : fpy >= 85 ? "amber" : "ruby" },
                { label: "Active Changeovers", value: String(active), sub: "In progress now", icon: Activity, accent: active > 0 ? "indigo" : "slate" },
                { label: "Avg Duration", value: avgMin >= 60 ? `${(avgMin/60).toFixed(1)}h` : `${avgMin}m`, sub: "Per changeover", icon: Timer, accent: "slate" },
                { label: "Total Splices", value: String(totalSplices), sub: `${spliceStats?.last7d ?? 0} in last 7d`, icon: GitBranch, accent: "amber" },
              ];
              const accentMap: Record<string, { bg: string; icon: string; ring: string }> = {
                emerald: { bg: "bg-emerald-700/5", icon: "text-emerald-700", ring: "ring-emerald-700/20" },
                amber:   { bg: "bg-amber-700/5",   icon: "text-amber-700",   ring: "ring-amber-700/20" },
                ruby:    { bg: "bg-ruby-700/5",    icon: "text-ruby-700",    ring: "ring-ruby-700/20" },
                indigo:  { bg: "bg-indigo-700/5",  icon: "text-indigo-700",  ring: "ring-indigo-700/20" },
                slate:   { bg: "bg-slate-700/5",   icon: "text-slate-700",   ring: "ring-slate-700/20" },
              };
              return heroes.map((h) => {
                const Icon = h.icon;
                const a = accentMap[h.accent];
                return (
                  <div key={h.label} className={`relative rounded-md border border-slate-200 bg-white px-4 py-4 shadow-sm hover:shadow-md transition-shadow ring-1 ${a.ring}`}>
                    <div className={`absolute inset-y-0 left-0 w-1 rounded-l-md ${a.bg.replace('/5','')} bg-current opacity-80`} style={{ color: h.accent === "emerald" ? "#047857" : h.accent === "amber" ? "#B45309" : h.accent === "ruby" ? "#B91C1C" : h.accent === "indigo" ? "#4338CA" : "#334155" }} />
                    <div className="flex items-start justify-between gap-3 pl-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{h.label}</p>
                        <p className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{h.value}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 truncate">{h.sub}</p>
                      </div>
                      <div className={`shrink-0 rounded p-1.5 ${a.bg}`}>
                        <Icon className={`h-4 w-4 ${a.icon}`} />
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          <Card className="border-l-4 border-l-blue-500 bg-gradient-to-br from-blue-50/80 to-blue-50/40 dark:from-blue-950/30 dark:to-background shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/10 rounded-full -mr-10 -mt-10"></div>
            <CardHeader className="pb-2 sm:pb-3">
              <CardTitle className="text-xs uppercase tracking-wider font-bold text-muted-foreground">📊 Scans</CardTitle>
            </CardHeader>
            <CardContent><div className="text-3xl sm:text-4xl font-black text-blue-600">{overview?.totalScans ?? '-'}</div></CardContent>
          </Card>
          <Card className="border-l-4 border-l-green-500 bg-gradient-to-br from-green-50/80 to-green-50/40 dark:from-green-950/30 dark:to-background shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-green-500/10 rounded-full -mr-10 -mt-10"></div>
            <CardHeader className="pb-2 sm:pb-3">
              <CardTitle className="text-xs uppercase tracking-wider font-bold text-muted-foreground">✅ OK Rate</CardTitle>
            </CardHeader>
            <CardContent><div className="text-3xl sm:text-4xl font-black text-green-600">{overview?.overallOkRate?.toFixed(1) ?? '-'}%</div></CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500 bg-gradient-to-br from-red-50/80 to-red-50/40 dark:from-red-950/30 dark:to-background shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-red-500/10 rounded-full -mr-10 -mt-10"></div>
            <CardHeader className="pb-2 sm:pb-3">
              <CardTitle className="text-xs uppercase tracking-wider font-bold text-muted-foreground">❌ Rejected</CardTitle>
            </CardHeader>
            <CardContent><div className="text-3xl sm:text-4xl font-black text-red-600">{overview?.totalReject ?? '-'}</div></CardContent>
          </Card>
          <Card className="border-l-4 border-l-purple-500 bg-gradient-to-br from-purple-50/80 to-purple-50/40 dark:from-purple-950/30 dark:to-background shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/10 rounded-full -mr-10 -mt-10"></div>
            <CardHeader className="pb-2 sm:pb-3">
              <CardTitle className="text-xs uppercase tracking-wider font-bold text-muted-foreground">▶️ Active</CardTitle>
            </CardHeader>
            <CardContent><div className="text-3xl sm:text-4xl font-black text-purple-600">{overview?.activeSessions ?? '-'}</div></CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* NEW ANALYTICS — Splice activity + Shift performance */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Splice activity (14d) */}
            <div className="lg:col-span-2 rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Material Continuity</p>
                  <h3 className="text-base font-bold text-slate-900">Splice Activity (14 days)</h3>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-900 tabular-nums">{spliceStats?.total ?? 0}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total splices</p>
                </div>
              </div>
              <div className="h-44">
                {spliceStats?.dailyTrend && spliceStats.dailyTrend.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={spliceStats.dailyTrend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="spliceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#B45309" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#B45309" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#E2E8F0" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#64748B" }} tickFormatter={(d) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: "#64748B" }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "#0F172A", border: "none", borderRadius: 4, fontSize: 12, color: "#fff" }} />
                      <Area type="monotone" dataKey="count" stroke="#B45309" strokeWidth={2} fill="url(#spliceGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-slate-400">No splice activity recorded</div>
                )}
              </div>
            </div>

            {/* Splice match field breakdown */}
            <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Match Strategy</p>
              <h3 className="text-base font-bold text-slate-900 mb-3">Verification Method</h3>
              <div className="space-y-2">
                {spliceStats?.byMatchField && spliceStats.byMatchField.length > 0 ? (
                  spliceStats.byMatchField.slice(0, 5).map((row) => {
                    const pct = spliceStats.total > 0 ? (row.count / spliceStats.total) * 100 : 0;
                    return (
                      <div key={row.field}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-slate-700 capitalize">{row.field.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="tabular-nums text-slate-500">{row.count} ({pct.toFixed(0)}%)</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-amber-700" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">No data</p>
                )}
              </div>
              {spliceStats && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Avg splice duration</span>
                  <span className="font-semibold text-slate-700 tabular-nums">{spliceStats.avgDurationSeconds}s</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                <div className="w-1 h-8 bg-green-500 rounded-full"></div>
                Recently Completed
              </h2>
              <p className="text-sm text-muted-foreground">Latest verification session results</p>
            </div>
            {completedSessions.length > 4 && (
              <button
                onClick={() => setShowAllCompletedSessions(!showAllCompletedSessions)}
                className="text-sm px-4 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg font-semibold transition-colors"
              >
                {showAllCompletedSessions ? "Show Less" : `View All (${completedSessions.length})`}
              </button>
            )}
          </div>
          {completedSessions.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">No completed sessions.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {(showAllCompletedSessions ? completedSessions : completedSessions.slice(0, 4)).map(session => (
                <Card key={session.id} className="bg-card shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span className="truncate">{session.panelName}</span>
                      <span className="text-xs text-muted-foreground">{new Date(session.createdAt).toLocaleDateString()}</span>
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">BOM: {session.bomName || session.bomId}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      {(user?.role === "qa" || user?.role === "supervisor") && (
                        <Button asChild variant="secondary" size="sm" className="flex-1 font-medium">
                          <Link href={`/session/${session.id}/report`}>VIEW REPORT</Link>
                        </Button>
                      )}
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        className="font-medium gap-1"
                        disabled={deleteSessionMutation.isPending && deletingSessionId === session.id}
                        onClick={() => handleDeleteSession(session.id)}
                      >
                        {deleteSessionMutation.isPending && deletingSessionId === session.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        DELETE
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* TRASH BIN SECTION */}
        <div className="space-y-4 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <button 
              onClick={() => setShowTrashBin(!showTrashBin)}
              className="text-xl font-bold border-b border-border pb-2 flex items-center gap-2 hover:text-muted-foreground transition-colors"
            >
              <Trash2 className="w-5 h-5 text-destructive flex-shrink-0" /> 
              Trash Bin
              <span className="text-xs px-2 py-1 bg-destructive/10 text-destructive rounded-md">
                {trashStats?.totalCount || 0}
              </span>
            </button>
            {(trashStats?.totalCount || 0) > 0 && (
              <Link href="/trash" className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
                View All →
              </Link>
            )}
          </div>
          
          {showTrashBin && (
            <div>
              {trashItemsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !trashItems || trashItems.items?.length === 0 ? (
                <p className="text-muted-foreground text-sm py-4">Trash is empty. Deleted items will appear here.</p>
              ) : (
                <div>
                  {/* Trash Stats Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                    <div className="bg-destructive/5 p-3 rounded">
                      <p className="text-xs text-muted-foreground">Sessions</p>
                      <p className="text-xl font-bold">{trashStats?.sessionCount || 0}</p>
                    </div>
                    <div className="bg-destructive/5 p-3 rounded">
                      <p className="text-xs text-muted-foreground">BOMs</p>
                      <p className="text-xl font-bold">{trashStats?.bomCount || 0}</p>
                    </div>
                    <div className="bg-destructive/5 p-3 rounded">
                      <p className="text-xs text-muted-foreground">BOM Items</p>
                      <p className="text-xl font-bold">{trashStats?.itemCount || 0}</p>
                    </div>
                    <div className="bg-destructive/5 p-3 rounded">
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-xl font-bold">{trashStats?.totalCount || 0}</p>
                    </div>
                  </div>

                  {/* Recent Trash Items */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 mt-4">
                    {trashItems.items?.slice(0, 6).map((item: any) => {
                      const isRecovering = recoveringTrashItem?.type === item.type && recoveringTrashItem?.id === item.id;
                      const isDeleting = deletingTrashItem?.type === item.type && deletingTrashItem?.id === item.id;
                      return (
                        <Card key={`${item.type}-${item.id}`} className="bg-gradient-to-br from-red-50/50 to-red-50/20 dark:from-red-950/20 dark:to-background border-red-200 dark:border-red-800 hover:border-red-400 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                          <div className="h-1 bg-gradient-to-r from-red-500 to-red-400"></div>
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <CardTitle className="text-sm font-bold truncate text-foreground leading-tight">{item.name}</CardTitle>
                              <span className="text-xs px-3 py-1 bg-red-500/90 text-white rounded-full font-semibold flex-shrink-0 whitespace-nowrap">
                                {item.type.replace('_', ' ')}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {new Date(item.deletedAt).toLocaleDateString()}
                              {item.deletedBy && ` • by ${item.deletedBy}`}
                            </p>
                          </CardHeader>
                          <CardContent>
                            <div className="flex gap-2 w-full">
                              <Button 
                                className="flex-1 font-semibold py-2 h-9 text-sm rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50 transition-all duration-200" 
                                size="sm" 
                                disabled={isRecovering || isDeleting}
                                onClick={() => handleRecoverTrashItem(item.type, item.id, item.name)}
                              >
                                {isRecovering ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <>↩️ RESTORE</>
                                )}
                              </Button>
                              <Button 
                                className="font-semibold py-2 h-9 text-sm rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50 transition-all duration-200" 
                                size="sm" 
                                disabled={isRecovering || isDeleting}
                                onClick={() => handlePermanentDeleteTrashItem(item.type, item.id, item.name)}
                              >
                                {isDeleting ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <>🗑️</>
                                )}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {(trashItems.items?.length || 0) > 6 && (
                    <Button asChild variant="link" className="mt-4 p-0 h-auto text-sm font-semibold text-blue-600 hover:text-blue-700">
                      <Link href="/trash" className="no-underline text-blue-600 hover:text-blue-700">
                        See all {trashStats?.totalCount} deleted items →
                      </Link>
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* REAL-TIME DASHBOARD SECTION */}
        <div className="space-y-4 border rounded-lg p-6 bg-gradient-to-br from-cyan-50/50 to-cyan-50/20 dark:from-cyan-950/20 dark:to-background border-cyan-200 dark:border-cyan-800">
          <button
            onClick={() => setShowRealTimeDashboard(!showRealTimeDashboard)}
            className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
          >
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <div className="w-1 h-8 bg-cyan-500 rounded-full"></div>
              📊 Real-Time Monitoring Dashboard
            </h2>
            <div className="text-cyan-600">
              {showRealTimeDashboard ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
            </div>
          </button>
          
          {showRealTimeDashboard && (
            <div className="space-y-6 mt-4 pt-4 border-t border-cyan-200 dark:border-cyan-800">
              {/* Session Selector */}
              <div className="w-full md:w-64">
                <label className="text-sm font-medium text-muted-foreground mb-2 block">Select Session</label>
                <Select value={sessionIdForRealTime || "all"} onValueChange={(val) => setSessionIdForRealTime(val === "all" ? null : val)}>
                  <SelectTrigger className="bg-white dark:bg-slate-950">
                    <SelectValue placeholder="Select Session" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sessions</SelectItem>
                    {activeSessionsList.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.bomName} ({s.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* KPI Cards Grid */}
              {loadingKpi ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    <KpiCard
                      title="Pass Rate"
                      value={`${kpi?.passRate?.toFixed(1) || 0}%`}
                      icon={<TrendingUp className="w-4 h-4" />}
                      bgColor="bg-blue-50 dark:bg-blue-950"
                      textColor="text-blue-900 dark:text-blue-100"
                    />
                    <KpiCard
                      title="Passes"
                      value={kpi?.passScanCount || 0}
                      bgColor="bg-green-50 dark:bg-green-950"
                      textColor="text-green-900 dark:text-green-100"
                    />
                    <KpiCard
                      title="Defect Rate"
                      value={`${kpi?.defectRate?.toFixed(1) || 0}%`}
                      icon={<AlertTriangle className="w-4 h-4" />}
                      bgColor="bg-gray-50 dark:bg-gray-950"
                      textColor="text-gray-900 dark:text-gray-100"
                    />
                    <KpiCard
                      title="Mismatches"
                      value={kpi?.mismatchCount || 0}
                      bgColor="bg-emerald-50 dark:bg-emerald-950"
                      textColor="text-emerald-900 dark:text-emerald-100"
                    />
                    <KpiCard
                      title="Rec Scan Time"
                      value={`${kpi?.avgCycleTime || 0}s`}
                      bgColor="bg-red-50 dark:bg-red-950"
                      textColor="text-red-900 dark:text-red-100"
                    />
                    <KpiCard
                      title="Scans"
                      value={kpi?.totalScans || 0}
                      bgColor="bg-amber-50 dark:bg-amber-950"
                      textColor="text-amber-900 dark:text-amber-100"
                    />
                    <KpiCard
                      title="Alt Pass"
                      value={kpi?.alternatePassCount || 0}
                      icon={<Zap className="w-4 h-4" />}
                      bgColor="bg-teal-50 dark:bg-teal-950"
                      textColor="text-teal-900 dark:text-teal-100"
                    />
                  </div>

                  {/* Charts Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                    {/* Validation Results Pie Chart */}
                    <Card className="bg-card shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">Validation Results</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px] w-full">
                          {kpi && (kpi.passScanCount > 0 || kpi.mismatchCount > 0 || kpi.alternatePassCount > 0) ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={[
                                    { name: "Pass", value: kpi.passScanCount, color: COLORS.pass },
                                    { name: "Mismatch", value: kpi.mismatchCount, color: COLORS.mismatch },
                                    { name: "Alternate Pass", value: kpi.alternatePassCount, color: COLORS.alternate },
                                  ].filter((item) => item.value > 0)}
                                  cx="50%"
                                  cy="50%"
                                  labelLine={false}
                                  label={({ name, value, percent }) => `${name} (${value})`}
                                  outerRadius={100}
                                  fill="#8884d8"
                                  dataKey="value"
                                >
                                  {[COLORS.pass, COLORS.mismatch, COLORS.alternate].map((color, index) => (
                                    <Cell key={`cell-${index}`} fill={color} />
                                  ))}
                                </Pie>
                                <Tooltip />
                              </PieChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground">No validation data</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Feeder Defects Bar Chart */}
                    <Card className="bg-card shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">Top Feeder Defects</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px] w-full">
                          {feeders?.feeders && feeders.feeders.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={feeders.feeders.slice(0, 10)} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="feederNumber" stroke="hsl(var(--muted-foreground))" fontSize={11} angle={-45} textAnchor="end" height={80} />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                                <Bar dataKey="defectCount" fill="#ef4444" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground">No feeder data</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Hourly Trends Line Chart */}
                    <Card className="bg-card shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">Hourly Trends</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px] w-full">
                          {timeAnalysis?.timeline && timeAnalysis.timeline.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={timeAnalysis.timeline} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={11} interval={2} />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                                <Legend />
                                <Line type="monotone" dataKey="passRate" name="Pass Rate %" stroke="#22c55e" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="defectRate" name="Defect Rate %" stroke="#ef4444" strokeWidth={2} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground">No time data</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Component Defects Bar Chart */}
                    <Card className="bg-card shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">Top Component Defects</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px] w-full">
                          {components?.components && components.components.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={components.components.slice(0, 10)} margin={{ top: 20, right: 30, left: 0, bottom: 80 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="partNumber" stroke="hsl(var(--muted-foreground))" fontSize={10} angle={-45} textAnchor="end" height={100} />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} />
                                <Bar dataKey="defectCount" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground">No component data</div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Navigation to Full Real-Time Dashboard */}
                  <Button asChild className="w-full font-bold gap-2 h-11 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800 transition-all duration-200 mt-4">
                    <Link href="/real-time-dashboard">
                      ⚡ View Full Real-Time Dashboard
                    </Link>
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ANALYTICS DASHBOARD SECTION */}
        <div className="space-y-4 border rounded-lg p-6 bg-gradient-to-br from-purple-50/50 to-purple-50/20 dark:from-purple-950/20 dark:to-background border-purple-200 dark:border-purple-800">
          <button
            onClick={() => setShowAnalyticsDashboard(!showAnalyticsDashboard)}
            className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
          >
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <div className="w-1 h-8 bg-purple-500 rounded-full"></div>
              📈 Advanced Analytics Dashboard
            </h2>
            <div className="text-purple-600">
              {showAnalyticsDashboard ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
            </div>
          </button>

          {showAnalyticsDashboard && (
            <div className="space-y-6 mt-4 pt-4 border-t border-purple-200 dark:border-purple-800">
              {loadingPareto || loadingTrends ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Metric Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <MetricCard title="Total Sessions" value={overview?.totalSessions} />
                    <MetricCard title="Active Sessions" value={overview?.activeSessions} />
                    <MetricCard title="Total Scans" value={overview?.totalScans} />
                    <MetricCard title="Overall OK Rate" value={`${overview?.overallOkRate?.toFixed(1) || 0}%`} />
                    <MetricCard title="Avg Duration (min)" value={overview?.avgDurationMinutes?.toFixed(1) || "-"} />
                  </div>

                  {/* Pareto Analysis Chart */}
                  <Card className="bg-card shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle>Pareto Rejection Analysis</CardTitle>
                      <Select value={analyticsSessionId} onValueChange={setAnalyticsSessionId}>
                        <SelectTrigger className="w-[180px] bg-white dark:bg-slate-950">
                          <SelectValue placeholder="All Sessions" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Sessions</SelectItem>
                        </SelectContent>
                      </Select>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="h-[400px] w-full">
                        {pareto?.items && pareto.items.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={pareto.items} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                              <XAxis dataKey="feederNumber" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                              <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                              <Legend />
                              <Bar yAxisId="left" dataKey="rejectCount" name="Reject Count" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                              <Line yAxisId="right" type="monotone" dataKey="cumulativePercent" name="Cumulative %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-muted-foreground">No rejection data available</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Scan Trends Chart */}
                  <Card className="bg-card shadow-sm">
                    <CardHeader>
                      <CardTitle>Scan Trends (Last 30 Days)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px] w-full">
                        {trends && trends.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trends} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                              <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                              <Legend />
                              <Line type="monotone" dataKey="okCount" name="OK Scans" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="rejectCount" name="Reject Scans" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-muted-foreground">No trend data available</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Navigation to Full Analytics Dashboard */}
                  <Button asChild className="w-full font-bold gap-2 h-11 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 transition-all duration-200 mt-4">
                    <Link href="/analytics">
                      📊 View Full Analytics Dashboard
                    </Link>
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {/* ADMIN CONTROL PANEL - QA FULL ACCESS */}
        <div className="space-y-6 border-t border-border pt-8">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                <div className="w-1 h-8 bg-orange-500 rounded-full"></div>
                Admin Controls
              </h2>
              <p className="text-sm text-muted-foreground">System management and access</p>
            </div>
            {showAllAdminControls && (
              <button
                onClick={() => setShowAllAdminControls(!showAllAdminControls)}
                className="text-sm px-4 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg font-semibold transition-colors"
              >
                Show Less
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
            <Card className="bg-gradient-to-br from-blue-50/50 to-blue-50/20 dark:from-blue-950/20 dark:to-background border-blue-200 dark:border-blue-800 hover:border-blue-400 hover:shadow-xl transition-all duration-300 hover:-translate-y-2 cursor-pointer overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-400"></div>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-3 text-foreground">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg"><Boxes className="w-5 h-5 text-blue-600" /></div>
                  BOMs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-2">Create & manage bill of materials</p>
                <Button asChild className="w-full font-bold py-2 h-10 rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50 hover:shadow-md transition-all duration-200">
                  <Link href="/bom">📦 Manage</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-50/50 to-purple-50/20 dark:from-purple-950/20 dark:to-background border-purple-200 dark:border-purple-800 hover:border-purple-400 hover:shadow-xl transition-all duration-300 hover:-translate-y-2 cursor-pointer overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-purple-500 to-purple-400"></div>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-3 text-foreground">
                  <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg"><BarChart3 className="w-5 h-5 text-purple-600" /></div>
                  Reports
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-2">Analytics & export data</p>
                <Button asChild className="w-full font-bold py-2 h-10 rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50 hover:shadow-md transition-all duration-200">
                  <Link href="/analytics">📊 View</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-red-50/50 to-red-50/20 dark:from-red-950/20 dark:to-background border-red-200 dark:border-red-800 hover:border-red-400 hover:shadow-xl transition-all duration-300 hover:-translate-y-2 cursor-pointer overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-red-500 to-red-400"></div>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-3 text-foreground">
                  <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg"><Trash2 className="w-5 h-5 text-red-600" /></div>
                  Trash
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground line-clamp-2">Recover or delete items</p>
                <Button asChild className="w-full font-bold py-2 h-10 rounded-lg bg-white text-navy border-navy border-2 hover:bg-gray-50 hover:shadow-md transition-all duration-200">
                  <Link href="/trash">🗑️ Access</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
        </div>
      </div>
      <DeleteLoadingOverlay />
      <RecoveryLoadingOverlay />
      </>
    );
  }

  // ENGINEER VIEW (Default)
  return (
    <>
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary/5 p-4 sm:p-8 lg:p-12">
        <div className="w-full space-y-10 animate-in fade-in duration-500">
          <div className="flex justify-between items-start sm:items-center gap-6 flex-col sm:flex-row">
            <div className="flex items-center gap-4">
              <AppLogo className="h-16" />
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">{appConfig.systemTitle}</p>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-foreground">Engineer Dashboard</h1>
              </div>
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              <Button asChild variant="outline" className="font-semibold gap-2 flex-1 sm:flex-none h-11">
                <Link href="/analytics">
                  <BarChart3 className="w-4 h-4" /> Analytics
                </Link>
              </Button>
              <Button asChild className="font-semibold flex-1 sm:flex-none h-11" data-testid="btn-start-session">
                <Link href="/session/new">New Session</Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-0 bg-gradient-to-br from-blue-50/50 to-background hover:shadow-md transition-shadow duration-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs uppercase tracking-widest font-semibold text-muted-foreground flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  Active Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-blue-600">{activeSessions.length}</div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-gradient-to-br from-green-50/50 to-background hover:shadow-md transition-shadow duration-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs uppercase tracking-widest font-semibold text-muted-foreground flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  Completed Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-bold text-green-600">{completedSessions.length}</div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-gradient-to-br from-purple-50/50 to-background hover:shadow-md transition-shadow duration-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs uppercase tracking-widest font-semibold text-muted-foreground flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  BOMs Configured
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div className="text-4xl font-bold text-purple-600">{totalBoms}</div>
                  <Button asChild variant="link" className="p-0 h-auto text-xs text-purple-600 font-semibold">
                    <Link href="/bom">Manage →</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <div className="w-1 h-8 bg-blue-500 rounded-full"></div>
              Active Sessions
            </h2>
            <p className="text-sm text-muted-foreground">Currently running verification sessions</p>
          </div>
          {activeSessions.length > 4 && (
            <button
              onClick={() => setShowAllActiveSessions(!showAllActiveSessions)}
              className="text-sm px-4 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg font-semibold transition-colors"
            >
              {showAllActiveSessions ? "Show Less" : `View All (${activeSessions.length})`}
            </button>
          )}
        </div>
        {activeSessions.length === 0 ? (
          <div className="p-8 text-center bg-secondary/30 rounded-lg border border-border border-dashed">
            <p className="text-muted-foreground font-medium">No active sessions. Start a new session to begin verification.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(showAllActiveSessions ? activeSessions : activeSessions.slice(0, 4)).map(session => (
              <Card key={session.id} className="bg-card border-border hover:border-primary/50 transition-colors shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span className="truncate">{session.panelName}</span>
                    <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-md uppercase tracking-wider font-semibold">Active</span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{session.shiftName} - {session.operatorName}</p>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="text-sm text-muted-foreground">
                      BOM: {session.bomName || session.bomId}
                    </div>
                    <div className="flex gap-2">
                      <Button asChild size="sm" className="flex-1 font-bold tracking-wide" data-testid={`btn-resume-session-${session.id}`}>
                        <Link href={`/session/${session.id}`}>RESUME</Link>
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="sm" 
                        className="font-medium gap-1"
                        disabled={deleteSessionMutation.isPending && deletingSessionId === session.id}
                        onClick={() => handleDeleteSession(session.id)}
                      >
                        {deleteSessionMutation.isPending && deletingSessionId === session.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        DELETE
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <div className="w-1 h-8 bg-green-500 rounded-full"></div>
              Recently Completed
            </h2>
            <p className="text-sm text-muted-foreground">Latest verification session results</p>
          </div>
          {completedSessions.length > 4 && (
            <button
              onClick={() => setShowAllCompletedSessions(!showAllCompletedSessions)}
              className="text-sm px-4 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg font-semibold transition-colors"
            >
              {showAllCompletedSessions ? "Show Less" : `View All (${completedSessions.length})`}
            </button>
          )}
        </div>
        {completedSessions.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No completed sessions.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(showAllCompletedSessions ? completedSessions : completedSessions.slice(0, 4)).map(session => (
              <Card key={session.id} className="bg-card shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span className="truncate">{session.panelName}</span>
                    <span className="text-xs text-muted-foreground">{new Date(session.createdAt).toLocaleDateString()}</span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">BOM: {session.bomName || session.bomId}</p>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    {(user?.role === "qa" || user?.role === "supervisor") && (
                      <Button asChild variant="secondary" size="sm" className="flex-1 font-medium">
                        <Link href={`/session/${session.id}/report`}>VIEW REPORT</Link>
                      </Button>
                    )}
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      className="font-medium gap-1"
                      disabled={deleteSessionMutation.isPending && deletingSessionId === session.id}
                      onClick={() => handleDeleteSession(session.id)}
                    >
                      {deleteSessionMutation.isPending && deletingSessionId === session.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                      DELETE
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

    </div>
    </div>
    <DeleteLoadingOverlay />
    <RecoveryLoadingOverlay />
    </>
  );
}

// KPI Card Component for Real-Time Dashboard
function KpiCard({
  title,
  value,
  icon,
  bgColor = "bg-blue-50 dark:bg-blue-950",
  textColor = "text-blue-900 dark:text-blue-100",
}: {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  bgColor?: string;
  textColor?: string;
}) {
  return (
    <Card className={`${bgColor} border-0 shadow-sm`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className={`text-xs font-medium ${textColor}`}>{title}</CardTitle>
          {icon && <div className={textColor}>{icon}</div>}
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${textColor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// Metric Card Component for Analytics Dashboard
function MetricCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card className="bg-card shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value !== undefined ? value : "-"}</div>
      </CardContent>
    </Card>
  );
}
