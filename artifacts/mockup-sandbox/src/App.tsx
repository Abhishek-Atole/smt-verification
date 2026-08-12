import { useEffect, useState, type ComponentType } from "react";

import { modules as discoveredModules } from "./.generated/mockup-components";
import { useAuth } from "./hooks/useAuth";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

function _resolveComponent(
  mod: Record<string, unknown>,
  name: string,
): ComponentType | undefined {
  const fns = Object.values(mod).filter(
    (v) => typeof v === "function",
  ) as ComponentType[];
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    fns[fns.length - 1]
  );
}

function PreviewRenderer({
  componentPath,
  modules,
  onLogin,
  onLogout,
  user,
}: {
  componentPath: string;
  modules: ModuleMap;
  onLogin?: (user: { id: string; email: string; name: string }) => void;
  onLogout?: () => void;
  user?: { id: string; email: string; name: string } | null;
}) {
  const [Component, setComponent] = useState<ComponentType<any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const key = `./components/mockups/${componentPath}.tsx`;
      const loader = modules[key];
      if (!loader) {
        setError(`No component found at ${componentPath}.tsx`);
        return;
      }

      try {
        const mod = await loader();
        if (cancelled) {
          return;
        }
        const name = componentPath.split("/").pop()!;
        const comp = _resolveComponent(mod, name);
        if (!comp) {
          setError(
            `No exported React component found in ${componentPath}.tsx\n\nMake sure the file has at least one exported function component.`,
          );
          return;
        }
        setComponent(() => comp);
      } catch (e) {
        if (cancelled) {
          return;
        }

        const message = e instanceof Error ? e.message : String(e);
        setError(`Failed to load preview.\n${message}`);
      }
    }

    void loadComponent();

    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return (
      <pre style={{ color: "red", padding: "2rem", fontFamily: "system-ui" }}>
        {error}
      </pre>
    );
  }

  if (!Component) return null;

  const PreviewComponent = Component;
  return <PreviewComponent onLogin={onLogin} onLogout={onLogout} user={user} />;
}

function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getPreviewExamplePath(): string {
  const basePath = getBasePath();
  return `${basePath}/preview/ComponentName`;
}

function Gallery() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">
          Component Preview Server
        </h1>
        <p className="text-gray-500 mb-4">
          This server renders individual components for the workspace canvas.
        </p>
        <p className="text-sm text-gray-400">
          Access component previews at{" "}
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
            {getPreviewExamplePath()}
          </code>
        </p>
      </div>
    </div>
  );
}

function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const { pathname } = window.location;
  const local =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  const match = local.match(/^\/preview\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const { isLoggedIn, user, loading, login, logout } = useAuth();
  const previewPath = getPreviewPath();

  // Show loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-indigo-100 rounded-lg mb-4">
            <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
          </div>
          <p className="text-gray-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in - show login
  if (!isLoggedIn) {
    const Login = discoveredModules["./components/mockups/Login.tsx"];
    if (!Login) {
      return <div>Login component not found</div>;
    }
    return <PreviewRenderer componentPath="Login" modules={discoveredModules} onLogin={login} />;
  }

  // Logged in - show dashboard or navigation
  if (previewPath) {
    // Handle special routes
    if (previewPath === "Reports") {
      return (
        <div>
          <NavBar user={user} onLogout={logout} />
          <PreviewRenderer
            componentPath={previewPath}
            modules={discoveredModules}
          />
        </div>
      );
    }

    if (previewPath === "UserProfile") {
      return (
        <div>
          <PreviewRenderer
            componentPath={previewPath}
            modules={discoveredModules}
            onLogout={logout}
            user={user}
          />
        </div>
      );
    }

    return (
      <div>
        <NavBar user={user} onLogout={logout} />
        <PreviewRenderer
          componentPath={previewPath}
          modules={discoveredModules}
        />
      </div>
    );
  }

  // Logged in - show dashboard gallery
  return (
    <div>
      <NavBar user={user} onLogout={logout} />
      <Dashboard user={user} />
    </div>
  );
}

interface NavBarProps {
  user: { id: string; email: string; name: string } | null;
  onLogout: () => void;
}

function NavBar({ user, onLogout }: NavBarProps) {
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold text-indigo-600">SMT Dashboard</h1>
          <div className="hidden md:flex items-center gap-6">
            <a href="/preview/Reports" className="text-gray-600 hover:text-gray-900 font-medium">
              Dashboard
            </a>
            <a href="/preview/UserProfile" className="text-gray-600 hover:text-gray-900 font-medium">
              Profile
            </a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-gray-900">{user?.name}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
          <button
            onClick={onLogout}
            className="px-4 py-2 bg-white hover:bg-gray-50 text-navy border-navy border-2 rounded-lg font-medium transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

interface DashboardProps {
  user: { id: string; email: string; name: string } | null;
}

function Dashboard({ user }: DashboardProps) {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Welcome, {user?.name}! 👋
          </h1>
          <p className="text-gray-600">
            Access your SMT analytics reports and manage your account
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Reports Card */}
          <a
            href="/preview/Reports"
            className="p-8 bg-white rounded-lg shadow hover:shadow-lg transition-shadow border-2 border-transparent hover:border-indigo-500 cursor-pointer"
          >
            <div className="text-3xl mb-3">📊</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Analytics Dashboard</h2>
            <p className="text-gray-600 mb-4">
              View 11 comprehensive reports including FPY, OEE, Operator, and more with real-time data
            </p>
            <span className="text-indigo-600 font-semibold">View Reports →</span>
          </a>

          {/* Profile Card */}
          <a
            href="/preview/UserProfile"
            className="p-8 bg-white rounded-lg shadow hover:shadow-lg transition-shadow border-2 border-transparent hover:border-purple-500 cursor-pointer"
          >
            <div className="text-3xl mb-3">👤</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">User Profile</h2>
            <p className="text-gray-600 mb-4">
              Manage your account settings, view session information, and user details
            </p>
            <span className="text-purple-600 font-semibold">View Profile →</span>
          </a>
        </div>

        {/* Quick Stats */}
        <div className="mt-8 grid md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-3xl font-bold text-indigo-600">11</div>
            <p className="text-gray-600 text-sm mt-1">Report Types</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-3xl font-bold text-green-600">3</div>
            <p className="text-gray-600 text-sm mt-1">Export Formats</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-3xl font-bold text-blue-600">100%</div>
            <p className="text-gray-600 text-sm mt-1">Data Access</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-3xl font-bold text-purple-600">♾️</div>
            <p className="text-gray-600 text-sm mt-1">With Unlimited</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
