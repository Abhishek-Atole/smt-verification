import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { AppShell } from "@/components/AppShell";

import Dashboard from "@/pages/dashboard";
import BomManager from "@/pages/bom-manager";
import BomDetailV2 from "@/pages/bom-detail-v2";
import BomReport from "@/pages/bom-report";
import SessionNew from "@/feeder/pages/NewSession";
import SessionActive from "@/feeder/pages/ActiveSession";
import SessionReport from "@/pages/session-report";
import SessionHistory from "@/feeder/pages/SessionHistory";
import Login from "@/pages/login";
import Analytics from "@/pages/analytics";
import TrashBin from "@/pages/trash-bin";
import RealTimeDashboard from "@/pages/real-time-dashboard";
import Reports from "@/pages/reports";
import SplicingPage from "@/feeder/pages/Splicing";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { SessionProvider } from "@/context/session-context";
import { ThemeProvider } from "@/components/theme-provider";
import { NotificationProvider } from "@/components/NotificationSystem";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { appConfig } from "@/lib/appConfig";
import { AdminGate } from "@/admin/AdminGate";
import { ADMIN_ROUTE } from "@/admin/config";
import { LicenseProvider } from "@/licensing/license-context";
import { TrialBanner } from "@/licensing/TrialBanner";
import { ExpiredBanner } from "@/licensing/ExpiredBanner";
import { FeederSessionProvider } from "@/feeder/session-context";
import { LicenseGuard } from "@/licensing/LicenseGuard";
import FeederNewSession from "@/feeder/pages/NewSession";
import FeederActiveSession from "@/feeder/pages/ActiveSession";
import FeederActiveSessions from "@/feeder/pages/ActiveSessions";
import FeederSessionHistory from "@/feeder/pages/SessionHistory";
import FeederVerification from "@/feeder/pages/Verification";
import QAVerificationQueue from "@/feeder/pages/QAVerificationQueue";
import QAVerificationDetail from "@/feeder/pages/QAVerificationDetail";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function ProtectedRoute({ component: Component, allowedRoles }: { component: any, allowedRoles?: string[] }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setLocation("/login");
    } else if (allowedRoles && !allowedRoles.includes(user.role)) {
      setLocation("/");
    }
  }, [user, loading, setLocation, allowedRoles]);

  if (loading) return null;

  if (!user) return null;
  if (allowedRoles && !allowedRoles.includes(user.role)) return null;

  return <Component />;
}

function Router() {
  const { user, loading } = useAuth();
  const [location] = useLocation();

  useEffect(() => {
    const routeLabelMap: Record<string, string> = {
      "/": "Dashboard",
      "/login": "Login",
      "/bom": "BOM",
      "/session/new": "New Session",
      "/session": "Session",
      "/verification": "New Session",
    };

    const exact = routeLabelMap[location];
    if (exact) {
      document.title = `${appConfig.companyShort} | ${exact}`;
      return;
    }

    if (location.startsWith("/session/")) {
      document.title = `${appConfig.companyShort} | Session`;
      return;
    }

    if (location.startsWith("/issues/")) {
      document.title = `${appConfig.companyShort} | Issues`;
      return;
    }

    document.title = `${appConfig.companyShort} | ${appConfig.systemTitle}`;
  }, [location]);

  // Admin portal is a self-contained sub-app: match it by PREFIX before the
  // user <Switch>. An exact <Route path={ADMIN_ROUTE}> only matched the bare
  // base, so sub-routes (/…/users, /…/audit) fell through to the catch-all and
  // bounced to /login. Rendering AdminGate directly (not via a wildcard Route)
  // also stops it remounting — and re-checking auth — between admin tabs.
  if (location === ADMIN_ROUTE || location.startsWith(`${ADMIN_ROUTE}/`)) {
    return <AdminGate />;
  }

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route>
        {loading ? null : user ? (
          <AppShell>
            <Layout>
              <Switch>
                <Route path="/">
                  {() => <ProtectedRoute component={Dashboard} allowedRoles={["supervisor", "operator", "qa"]} />}
                </Route>
                <Route path="/bom">
                  {() => <ProtectedRoute component={BomManager} allowedRoles={["supervisor"]} />}
                </Route>
                <Route path="/bom/:id">
                  {() => <ProtectedRoute component={BomDetailV2} allowedRoles={["supervisor"]} />}
                </Route>
                <Route path="/bom/:id/report">
                  {() => <ProtectedRoute component={BomReport} allowedRoles={["supervisor"]} />}
                </Route>

                {/* --- Feeder verification routes (scoped session provider) --- */}
                <Route path="/feeder/sessions/new">
                  {() => (
                    <FeederSessionProvider>
                      <ProtectedRoute component={FeederNewSession} allowedRoles={["supervisor", "operator"]} />
                    </FeederSessionProvider>
                  )}
                </Route>
                <Route path="/feeder/sessions/active">
                  {() => (
                    <FeederSessionProvider>
                      <ProtectedRoute component={FeederActiveSessions} allowedRoles={["supervisor", "operator", "qa"]} />
                    </FeederSessionProvider>
                  )}
                </Route>
                <Route path="/feeder/sessions/history">
                  {() => (
                    <FeederSessionProvider>
                      <ProtectedRoute component={FeederSessionHistory} allowedRoles={["supervisor", "operator", "qa"]} />
                    </FeederSessionProvider>
                  )}
                </Route>
                <Route path="/feeder/verification">
                  {() => (
                    <FeederSessionProvider>
                      <ProtectedRoute component={FeederVerification} allowedRoles={["supervisor", "operator"]} />
                    </FeederSessionProvider>
                  )}
                </Route>
                <Route path="/feeder/splicing">
                  {() => (
                    <FeederSessionProvider>
                      <ProtectedRoute component={SplicingPage} allowedRoles={["supervisor", "operator", "qa"]} />
                    </FeederSessionProvider>
                  )}
                </Route>
                <Route path="/feeder/sessions/:id">
                  {() => (
                    <FeederSessionProvider>
                      <ProtectedRoute component={FeederActiveSession} allowedRoles={["supervisor", "operator", "qa"]} />
                    </FeederSessionProvider>
                  )}
                </Route>

                {/* --- QA reverification routes (200% verification) --- */}
                <Route path="/feeder/qa-queue">
                  {() => (
                    <ProtectedRoute component={QAVerificationQueue} allowedRoles={["qa", "supervisor"]} />
                  )}
                </Route>
                <Route path="/feeder/qa-queue/:sessionId">
                  {(params) => (
                    <ProtectedRoute component={QAVerificationDetail} allowedRoles={["qa", "supervisor"]} />
                  )}
                </Route>

                {/* --- Legacy routes (still point to feeder pages, no session provider needed) --- */}
                <Route path="/session/new">
                  {() => <ProtectedRoute component={SessionNew} allowedRoles={["supervisor", "operator"]} />}
                </Route>
                <Route path="/verification">
                  {() => <ProtectedRoute component={SessionNew} allowedRoles={["supervisor", "operator"]} />}
                </Route>
                <Route path="/splicing">
                  {() => <ProtectedRoute component={SplicingPage} allowedRoles={["supervisor", "operator", "qa"]} />}
                </Route>
                <Route path="/session/:id">
                  {() => <ProtectedRoute component={SessionActive} allowedRoles={["supervisor", "operator", "qa"]} />}
                </Route>
                <Route path="/session/:id/report">
                  {() => <ProtectedRoute component={SessionReport} allowedRoles={["supervisor", "qa"]} />}
                </Route>
                <Route path="/sessions" component={SessionHistory} />
                <Route path="/analytics">
                  {() => <ProtectedRoute component={Analytics} allowedRoles={["supervisor", "qa"]} />}
                </Route>
                <Route path="/trash">
                  {() => <ProtectedRoute component={TrashBin} allowedRoles={["supervisor"]} />}
                </Route>
                <Route path="/real-time-dashboard">
                  {() => <ProtectedRoute component={RealTimeDashboard} allowedRoles={["supervisor", "qa"]} />}
                </Route>
                <Route path="/reports">
                  {() => <ProtectedRoute component={Reports} allowedRoles={["supervisor", "qa"]} />}
                </Route>
                <Route component={NotFound} />
              </Switch>
            </Layout>
          </AppShell>
        ) : (
          <Login />
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <AuthProvider>
          <NotificationProvider>
            <ErrorBoundary>
              <TooltipProvider>
                <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
                  <SessionProvider>
                    <LicenseProvider>
                      <TrialBanner />
                      <ExpiredBanner />
                      <Router />
                    </LicenseProvider>
                  </SessionProvider>
                </WouterRouter>
                <Toaster />
              </TooltipProvider>
            </ErrorBoundary>
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
