import { createContext, useContext, type ReactNode } from "react";
import { useAdminData } from "./use-admin-data";
import type { AdminDataState } from "./use-admin-data";

type AdminContextType = AdminDataState & {
  refreshAll: () => void;
  refreshStorage: () => void;
  addBroadcast: (message: string, severity: "info" | "warning" | "critical", expiresAt?: string, dismissible?: boolean) => void;
  removeBroadcast: (id: string) => void;
};

const AdminContext = createContext<AdminContextType | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const data = useAdminData();
  return <AdminContext.Provider value={data}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextType {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be inside AdminProvider");
  return ctx;
}
