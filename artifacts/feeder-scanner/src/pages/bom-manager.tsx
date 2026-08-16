import { useState, useCallback, useEffect } from "react";
import { useListBoms, useCreateBom, useDeleteBom } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Plus, Search, History, BadgeCheck } from "lucide-react";
import { BomCard } from "@/components/bom/BomCard";
import { BomImportWizard } from "@/components/bom/BomImportWizard";
import { ManualEntryForm } from "@/components/bom/ManualEntryForm";
import { PasswordConfirmModal } from "@/components/PasswordConfirmModal";
import { logger } from "../lib/logger";

export default function BomManager() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: allBoms, isLoading: bomsLoading, refetch } = useListBoms();
  const deleteBom = useDeleteBom();
  const createBom = useCreateBom();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedBomForDelete, setSelectedBomForDelete] = useState<any>(null);
  const [hardDeleteConfirmOpen, setHardDeleteConfirmOpen] = useState(false);
  const [selectedBomForHardDelete, setSelectedBomForHardDelete] = useState<any>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [selectedBomForRestore, setSelectedBomForRestore] = useState<any>(null);
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{ bom: any; status: "active" | "locked" | "hold" } | null>(null);
  const [trashedBoms, setTrashedBoms] = useState<any[]>([]);
  const [trashedLoading, setTrashedLoading] = useState(false);

  // Fetch deleted BOMs for trash section
  const fetchTrashedBoms = useCallback(async () => {
    setTrashedLoading(true);
    try {
      const response = await fetch("/api/bom?deleted=true");
      const data = await response.json();
      setTrashedBoms(data || []);
    } catch (error) {
      logger.error({ error }, "Failed to fetch trashed BOMs:");
      setTrashedBoms([]);
    } finally {
      setTrashedLoading(false);
    }
  }, []);

  // Fetch trashed BOMs on mount and when tab changes
  useEffect(() => {
    if (activeTab === "trash") {
      fetchTrashedBoms();
    }
  }, [activeTab, fetchTrashedBoms]);

  // Filter and sort BOMs
  const activeBoms = (allBoms || []);
  const trashed = trashedBoms;

  const filteredBoms = activeBoms
    .filter(bom => {
      const matchesSearch = searchTerm === "" ||
        bom.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (bom.description && bom.description.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchesSearch;
    })
    .sort((a, b) => {
      if (sortOrder === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortOrder === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortOrder === "name") return a.name.localeCompare(b.name);
      return 0;
    });

  const handleDeleteBom = useCallback(async (bom: any) => {
    setSelectedBomForDelete(bom);
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!selectedBomForDelete) return;
    try {
      const response = await fetch(`/api/bom/${selectedBomForDelete.id}/delete`, {
        method: "PATCH",
      });
      if (!response.ok) {
        throw new Error("Failed to delete BOM");
      }
      toast({ title: "Success", description: `BOM "${selectedBomForDelete.name}" moved to Trash` });
      setSelectedBomForDelete(null);
      refetch();
      fetchTrashedBoms();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to delete BOM";
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
    }
  }, [selectedBomForDelete, refetch, fetchTrashedBoms, toast]);

  const handleRestoreBom = useCallback(async (bom: any) => {
    setSelectedBomForRestore(bom);
    setRestoreConfirmOpen(true);
  }, []);

  const handleSetStatus = useCallback((bom: any, status: "active" | "locked" | "hold") => {
    setPendingStatus({ bom, status });
    setStatusConfirmOpen(true);
  }, []);

  const confirmSetStatus = useCallback(async () => {
    if (!pendingStatus) return;
    const { bom, status } = pendingStatus;
    try {
      const response = await fetch(`/api/bom/${bom.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update BOM status");
      const verb = status === "active" ? "released" : status === "locked" ? "locked" : "put on hold";
      toast({ title: "Success", description: `BOM "${bom.name}" ${verb}` });
      setPendingStatus(null);
      refetch();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to update BOM status";
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
    }
  }, [pendingStatus, refetch, toast]);

  const confirmRestore = useCallback(async () => {
    if (!selectedBomForRestore) return;
    try {
      await fetch(`/api/bom/${selectedBomForRestore.id}/restore`, {
        method: "PATCH",
      });
      toast({ title: "Success", description: `BOM "${selectedBomForRestore.name}" restored` });
      setSelectedBomForRestore(null);
      refetch();
      fetchTrashedBoms();
    } catch (error) {
      toast({ title: "Error", description: "Failed to restore BOM", variant: "destructive" });
    }
  }, [selectedBomForRestore, refetch, fetchTrashedBoms, toast]);

  const handleHardDeleteBom = useCallback(async (bom: any) => {
    setSelectedBomForHardDelete(bom);
    setHardDeleteConfirmOpen(true);
  }, []);

  const confirmHardDelete = useCallback(async () => {
    if (!selectedBomForHardDelete) return;
    try {
      const response = await fetch(`/api/bom/${selectedBomForHardDelete.id}/permanent`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to permanently delete BOM");
      }
      toast({ title: "Success", description: `BOM "${selectedBomForHardDelete.name}" permanently deleted` });
      setSelectedBomForHardDelete(null);
      refetch();
      fetchTrashedBoms();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to permanently delete BOM";
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
    }
  }, [selectedBomForHardDelete, refetch, fetchTrashedBoms, toast]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4 sm:p-6">
      <div className="w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-navy mb-2">Bill of Materials</h1>
          <p className="text-gray-600">Manage component BOMs for SMT changeover verification</p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 flex gap-2 bg-transparent border-b border-gray-200 rounded-none p-0 h-auto">
            {[
              { id: "list", label: "BOM List", icon: "📋" },
              { id: "import", label: "Import BOM", icon: "⬆️" },
              { id: "manual", label: "Manual Entry", icon: "✏️" },
              { id: "trash", label: "Trash", icon: "🗑️" },
            ].map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={`px-6 py-3 rounded-t-lg font-semibold text-sm transition-all ${
                  activeTab === tab.id
                    ? "bg-navy text-white border-b-2 border-navy"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tab.icon} {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* TAB 1: BOM LIST */}
          <TabsContent value="list" className="space-y-6">
            {/* Header Row */}
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-navy">Bill of Materials</h2>
                <p className="text-sm text-gray-600 mt-1">Manage component BOMs for SMT changeover verification</p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={() => setActiveTab("manual")}
                  className="bg-navy hover:bg-blue-900 text-black hover:text-black flex items-center gap-2 shadow-md hover:shadow-xl transition-all duration-200 font-semibold px-5 py-2.5 hover:scale-105 hover:-translate-y-0.5"
                >
                  <Plus className="w-5 h-5" /> Create Manual BOM
                </Button>
                <Button
                  onClick={() => setActiveTab("import")}
                  variant="outline"
                  className="border-2 border-navy text-black hover:bg-navy hover:text-black flex items-center gap-2 shadow-sm hover:shadow-xl transition-all duration-200 font-semibold px-5 py-2.5 hover:scale-105 hover:-translate-y-0.5"
                >
                  <Upload className="w-5 h-5" /> Import CSV
                </Button>
              </div>
            </div>

            {/* Search & Filter Bar */}
            <div className="bg-white rounded-lg p-4 border border-gray-200 flex gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by BOM name, version, product..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={sortOrder} onValueChange={setSortOrder}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="name">Name A-Z</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* BOM Cards Grid */}
            {bomsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-64 bg-gray-200 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : filteredBoms.length === 0 ? (
              <div className="bg-white rounded-lg p-12 text-center border border-dashed border-gray-300">
                <p className="text-gray-500">
                  {searchTerm ? "No BOMs match your search. Try clearing filters." : "No BOMs created yet. Create one to get started."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch">
                {filteredBoms.map(bom => (
                  <BomCard
                    key={bom.id}
                    bom={bom}
                    onDelete={handleDeleteBom}
                    onSetStatus={handleSetStatus}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 2: IMPORT BOM */}
          <TabsContent value="import" className="space-y-6">
            <BomImportWizard onSuccess={(bomId) => {
              refetch();
              if (bomId) {
                setLocation(`/bom/${bomId}?mode=view`);
                return;
              }
              setActiveTab("list");
            }} />
          </TabsContent>

          {/* TAB 3: MANUAL ENTRY */}
          <TabsContent value="manual" className="space-y-6">
            <ManualEntryForm onSuccess={() => {
              setActiveTab("list");
              refetch();
            }} />
          </TabsContent>

          {/* TAB 4: TRASH */}
          <TabsContent value="trash" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-navy mb-2">Trash</h2>
              <p className="text-sm text-gray-600">Deleted BOMs are kept for 30 days before permanent removal</p>
            </div>

            {bomsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-64 bg-gray-200 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : trashed.length === 0 ? (
              <div className="bg-white rounded-lg p-12 text-center border border-dashed border-gray-300">
                <p className="text-gray-500">Trash is empty — no deleted BOMs</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch">
                {trashed.map(bom => (
                  <div key={bom.id} className="flex h-full flex-col bg-white rounded-2xl p-6 border border-gray-200 opacity-75 shadow-sm transition-shadow hover:shadow-md">
                    <div className="flex justify-between items-start mb-4 gap-3">
                      <span className="text-xs font-semibold px-2 py-1 bg-gray-300 text-gray-700 rounded-full">
                        DELETED
                      </span>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-orange-700">
                          <History className="h-3.5 w-3.5" />
                          Rev {bom.revisionLabel || "Original"}
                        </span>
                        {bom.isLatest && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-green-700">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            Latest
                          </span>
                        )}
                      </div>
                    </div>
                    <h3 className="font-bold text-lg text-gray-800 mb-1 break-words">{bom.name}</h3>
                    <p className="text-sm text-red-600 font-semibold mb-3">
                      Deleted on: {new Date(bom.deletedAt).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-600 mb-4">
                      Expires in: ~28 days
                    </p>
                    <div className="mt-auto flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white text-navy border-navy border-2 hover:bg-gray-50 flex-1"
                        onClick={() => handleRestoreBom(bom)}
                      >
                        ↩ Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white text-navy border-navy border-2 hover:bg-gray-50 flex-1"
                        onClick={() => handleHardDeleteBom(bom)}
                      >
                        ✕ Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete: password step-up required */}
      <PasswordConfirmModal
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete BOM?"
        description={
          <>
            Move <span className="font-semibold">{selectedBomForDelete?.name}</span> to Trash?
            It can be restored within 30 days. Enter your password to confirm.
          </>
        }
        confirmLabel="Move to Trash"
        destructive
        onConfirmed={confirmDelete}
      />

      {/* Restore: password step-up required */}
      <PasswordConfirmModal
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title="Restore BOM?"
        description={
          <>
            Restore <span className="font-semibold">{selectedBomForRestore?.name}</span> from Trash?
            Enter your password to confirm.
          </>
        }
        confirmLabel="Restore"
        onConfirmed={confirmRestore}
      />

      {/* Lock / release / hold: password step-up required */}
      <PasswordConfirmModal
        open={statusConfirmOpen}
        onOpenChange={setStatusConfirmOpen}
        title={
          pendingStatus?.status === "active"
            ? "Release revision?"
            : pendingStatus?.status === "hold"
              ? "Put revision on hold?"
              : "Lock revision?"
        }
        description={
          <>
            {pendingStatus?.status === "active" ? (
              <>Release <span className="font-semibold">{pendingStatus?.bom?.name}</span> so it can be used and edited again.</>
            ) : pendingStatus?.status === "hold" ? (
              <>Put <span className="font-semibold">{pendingStatus?.bom?.name}</span> on hold — it can't be used for new sessions or edited until released.</>
            ) : (
              <>Lock <span className="font-semibold">{pendingStatus?.bom?.name}</span> — it can't be used for new sessions or edited until released.</>
            )}
            {" "}Enter your password to confirm.
          </>
        }
        confirmLabel={pendingStatus?.status === "active" ? "Release" : pendingStatus?.status === "hold" ? "Put on Hold" : "Lock"}
        onConfirmed={confirmSetStatus}
      />

      {/* Permanent delete: password step-up required */}
      <PasswordConfirmModal
        open={hardDeleteConfirmOpen}
        onOpenChange={setHardDeleteConfirmOpen}
        title="Delete Permanently?"
        description={
          <>
            Permanently delete <span className="font-semibold">{selectedBomForHardDelete?.name}</span> and all its
            component data. This cannot be undone. Enter your password to confirm.
          </>
        }
        confirmLabel="Delete Forever"
        destructive
        onConfirmed={confirmHardDelete}
      />
    </div>
  );
}
