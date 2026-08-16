
import { useGetAnalyticsOverview, getGetAnalyticsOverviewQueryKey, useGetAnalyticsPareto, getGetAnalyticsParetoQueryKey, useGetAnalyticsTrends, getGetAnalyticsTrendsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart } from "recharts";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppLogo } from "@/components/AppLogo";
import { appConfig } from "@/lib/appConfig";

export default function Analytics() {
  const [sessionId, setSessionId] = useState<string>("all");

  const { data: overview, isLoading: loadingOverview } = useGetAnalyticsOverview({
    query: { queryKey: getGetAnalyticsOverviewQueryKey() }
  });

  const paretoParams = sessionId !== "all" ? { sessionId: Number(sessionId) } : undefined;
  const { data: pareto, isLoading: loadingPareto } = useGetAnalyticsPareto(paretoParams, {
    query: { queryKey: getGetAnalyticsParetoQueryKey(paretoParams) }
  });

  const { data: trends, isLoading: loadingTrends } = useGetAnalyticsTrends({
    query: { queryKey: getGetAnalyticsTrendsQueryKey() }
  });

  if (loadingOverview || loadingPareto || loadingTrends) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="p-6 w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <AppLogo className="h-14" />
          <div>
            <h1 className="text-3xl font-black tracking-tight">{appConfig.systemTitle}</h1>
            <p className="text-sm text-muted-foreground font-medium">Analytics Dashboard</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <MetricCard title="Total Sessions" value={overview?.totalSessions} />
        <MetricCard title="Active Sessions" value={overview?.activeSessions} />
        <MetricCard title="Total Scans" value={overview?.totalScans} />
        <MetricCard title="Overall OK Rate" value={`${overview?.overallOkRate?.toFixed(1) || 0}%`} />
        <MetricCard title="Avg Duration (min)" value={overview?.avgDurationMinutes?.toFixed(1) || "-"} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Pareto Rejection Analysis</CardTitle>
          <Select value={sessionId} onValueChange={setSessionId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Sessions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sessions</SelectItem>
              {/* Optional: Add dynamic session list here if available */}
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
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="rejectCount" name="Reject Count" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="cumulativePercent" name="Cumulative %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">No rejection data available</div>
            )}
          </div>

          {pareto?.items && pareto.items.length > 0 && (
            <div className="mt-8 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feeder #</TableHead>
                    <TableHead>Part #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Reject Count</TableHead>
                    <TableHead className="text-right">Cumulative %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pareto.items.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono font-medium">{item.feederNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{item.partNumber || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{item.description || "-"}</TableCell>
                      <TableCell className="text-right font-medium text-destructive">{item.rejectCount}</TableCell>
                      <TableCell className="text-right">{item.cumulativePercent.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
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
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                  />
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
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value !== undefined ? value : "-"}</div>
      </CardContent>
    </Card>
  );
}
