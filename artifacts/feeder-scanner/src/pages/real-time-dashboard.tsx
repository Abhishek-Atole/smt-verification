import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, TrendingUp, Zap } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { AppLogo } from "@/components/AppLogo";
import { appConfig } from "@/lib/appConfig";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

// Color palette for components
const COLORS = {
  pass: "#22c55e",
  mismatch: "#ef4444",
  alternate: "#eab308",
  neutral: "#8b5cf6",
};

export default function RealTimeDashboard() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Array<{ id: number; bomName: string; status: string }>>([]);
  const [activeTab, setActiveTab] = useState("verification");

  // Fetch active sessions
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sessions`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions || []);
          if (data.sessions?.length > 0 && !sessionId) {
            setSessionId(String(data.sessions[0].id));
          }
        }
      } catch (err) {
        // Failed to fetch sessions
      }
    };
    fetchSessions();
  }, []);

  // KPI Query - 2 second refetch when session is active
  const { data: kpi, isLoading: loadingKpi } = useQuery({
    queryKey: ["dashboard-kpi", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/kpi${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPI");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
    staleTime: 0,
  });

  // Verification Records Query
  const { data: verification, isLoading: loadingVerification } = useQuery({
    queryKey: ["dashboard-verification", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/verification${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch verification");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
  });

  // Alarms Query
  const { data: alarms, isLoading: loadingAlarms } = useQuery({
    queryKey: ["dashboard-alarms", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/alarms${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch alarms");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
  });

  // Operator Metrics Query
  const { data: operators, isLoading: loadingOperators } = useQuery({
    queryKey: ["dashboard-operator", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/operator${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch operators");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
  });

  // Time Analysis Query
  const { data: timeAnalysis, isLoading: loadingTime } = useQuery({
    queryKey: ["dashboard-time-analysis", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/time-analysis${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch time analysis");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
  });

  // Feeder Analysis Query
  const { data: feeders, isLoading: loadingFeeders } = useQuery({
    queryKey: ["dashboard-feeder-analysis", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/feeder-analysis${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch feeder analysis");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
  });

  // Component Analysis Query
  const { data: components, isLoading: loadingComponents } = useQuery({
    queryKey: ["dashboard-component-analysis", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/component-analysis${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch component analysis");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
  });

  // Efficiency Query
  const { data: efficiency, isLoading: loadingEfficiency } = useQuery({
    queryKey: ["dashboard-efficiency", sessionId],
    queryFn: async () => {
      const params = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await fetch(`${API_BASE}/api/dashboard/efficiency${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch efficiency");
      return res.json();
    },
    refetchInterval: sessionId ? 2000 : false,
  });

  const isLoading = loadingKpi || loadingVerification || loadingAlarms || loadingOperators;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // Prepare pie chart data
  const pieData = kpi
    ? [
        { name: "Pass", value: kpi.passScanCount, color: COLORS.pass },
        { name: "Mismatch", value: kpi.mismatchCount, color: COLORS.mismatch },
        { name: "Alternate Pass", value: kpi.alternatePassCount, color: COLORS.alternate },
      ].filter((item) => item.value > 0)
    : [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <AppLogo className="h-14" />
          <div>
            <h1 className="text-3xl font-black tracking-tight">{appConfig.systemTitle}</h1>
            <p className="text-sm text-muted-foreground font-medium">Real-Time Dashboard</p>
          </div>
        </div>
        <div className="w-[250px]">
          <Select value={sessionId || "all"} onValueChange={(val) => setSessionId(val === "all" ? null : val)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Session" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sessions</SelectItem>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.bomName} ({s.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Validation Results Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Validation Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" labelLine={false} label={({ name, value, percent }) => `${name} (${value})`} outerRadius={100} fill="#8884d8" dataKey="value">
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
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
        <Card>
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
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Time Analysis Line Chart */}
        <Card>
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
        <Card>
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

      {/* Tabbed Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="verification">Verification</TabsTrigger>
              <TabsTrigger value="alarms">Alarms</TabsTrigger>
              <TabsTrigger value="operators">Operators</TabsTrigger>
            </TabsList>

            {/* Verification Tab */}
            <TabsContent value="verification" className="mt-4">
              {loadingVerification ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : verification?.records && verification.records.length > 0 ? (
                <div className="border rounded-md overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feeder</TableHead>
                        <TableHead>Part #</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Scanned At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {verification.records.map((record: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{record.feederNumber}</TableCell>
                          <TableCell className="text-sm">{record.partNumber || "-"}</TableCell>
                          <TableCell>
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                record.validationResult === "pass" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" : record.validationResult === "mismatch" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
                              }`}
                            >
                              {record.validationResult}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{record.status}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(record.scannedAt).toLocaleTimeString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">No verification records</div>
              )}
            </TabsContent>

            {/* Alarms Tab */}
            <TabsContent value="alarms" className="mt-4">
              {loadingAlarms ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : alarms?.alarms && alarms.alarms.length > 0 ? (
                <div className="space-y-3">
                  {alarms.alarms.map((alarm: any, i: number) => (
                    <div key={i} className={`border rounded-lg p-3 ${alarm.severity === "critical" ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800" : alarm.severity === "warning" ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800" : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold">Feeder {alarm.feederNumber}</h4>
                          <p className="text-sm text-muted-foreground">{alarm.mismatchCount} mismatches</p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${alarm.severity === "critical" ? "bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-100" : alarm.severity === "warning" ? "bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100" : "bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-100"}`}>
                          {alarm.severity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">No alarms</div>
              )}
            </TabsContent>

            {/* Operators Tab */}
            <TabsContent value="operators" className="mt-4">
              {loadingOperators ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : operators?.operators && operators.operators.length > 0 ? (
                <div className="border rounded-md overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Operator</TableHead>
                        <TableHead className="text-right">Scans</TableHead>
                        <TableHead className="text-right">Pass Rate</TableHead>
                        <TableHead className="text-right">Defect Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {operators.operators.map((op: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{op.operatorId}</TableCell>
                          <TableCell className="text-right">{op.scanCount}</TableCell>
                          <TableCell className="text-right">
                            <span className="text-green-600 dark:text-green-400 font-medium">{op.passRate?.toFixed(1) || 0}%</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-red-600 dark:text-red-400 font-medium">{op.defectRate?.toFixed(1) || 0}%</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">No operator data</div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Efficiency Footer */}
      {efficiency && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Session Efficiency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="text-xl font-bold capitalize">{efficiency.sessionStatus}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="text-xl font-bold">{efficiency.totalDurationMinutes} min</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Throughput</p>
                <p className="text-xl font-bold">{efficiency.throughput?.toFixed(1) || 0} scans/min</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Efficiency</p>
                <p className={`text-xl font-bold ${efficiency.efficiency >= 100 ? "text-green-600 dark:text-green-400" : efficiency.efficiency >= 80 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}`}>
                  {efficiency.efficiency?.toFixed(1) || 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
    <Card className={`${bgColor} border-0`}>
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
