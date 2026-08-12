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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Upload, Plus, MoreVertical, Eye, Edit2, Copy, Archive, Search, History, BadgeCheck, Loader } from "lucide-react";
import { BomCard } from "@/components/bom/BomCard";
import { BomImportWizard } from "@/components/bom/BomImportWizard";
import { ManualEntryForm } from "@/components/bom/ManualEntryForm";
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
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedBomForDelete, setSelectedBomForDelete] = useState<any>(null);
  const [isSoftDeleting, setIsSoftDeleting] = useState(false);
  const [softDeleteError, setSoftDeleteError] = useState<string | null>(null);
  const [hardDeleteConfirmOpen, setHardDeleteConfirmOpen] = useState(false);
  const [selectedBomForHardDelete, setSelectedBomForHardDelete] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
      const matchesStatus = filterStatus === "all" || 
        (bom.status?.toUpperCase() === filterStatus.toUpperCase());
      return matchesSearch && matchesStatus;
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
    setIsSoftDeleting(true);
    setSoftDeleteError(null);
    try {
      const response = await fetch(`/api/bom/${selectedBomForDelete.id}/delete`, {
        method: "PATCH",
      });
      if (!response.ok) {
        throw new Error("Failed to delete BOM");
      }
      toast({ title: "Success", description: `BOM "${selectedBomForDelete.name}" moved to Trash` });
      setDeleteConfirmOpen(false);
      setSelectedBomForDelete(null);
      refetch();
      fetchTrashedBoms();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to delete BOM";
      setSoftDeleteError(errorMsg);
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
    } finally {
      setIsSoftDeleting(false);
    }
  }, [selectedBomForDelete, refetch, fetchTrashedBoms, toast]);

  const handleRestoreBom = useCallback(async (bom: any) => {
    try {
      await fetch(`/api/bom/${bom.id}/restore`, {
        method: "PATCH",
      });
      toast({ title: "Success", description: `BOM "${bom.name}" restored` });
      refetch();
      fetchTrashedBoms();
    } catch (error) {
      toast({ title: "Error", description: "Failed to restore BOM", variant: "destructive" });
    }
  }, [refetch, fetchTrashedBoms, toast]);

  const handleHardDeleteBom = useCallback(async (bom: any) => {
    setSelectedBomForHardDelete(bom);
    setHardDeleteConfirmOpen(true);
  }, []);

  const confirmHardDelete = useCallback(async () => {
    if (!selectedBomForHardDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/bom/${selectedBomForHardDelete.id}/permanent`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to permanently delete BOM");
      }
      toast({ title: "Success", description: `BOM "${selectedBomForHardDelete.name}" permanently deleted` });
      setHardDeleteConfirmOpen(false);
      setSelectedBomForHardDelete(null);
      refetch();
      fetchTrashedBoms();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to permanently delete BOM";
      setDeleteError(errorMsg);
      toast({ title: "Error", description: errorMsg, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }, [selectedBomForHardDelete, refetch, fetchTrashedBoms, toast]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
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
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All BOMs</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredBoms.map(bom => (
                  <BomCard
                    key={bom.id}
                    bom={bom}
                    onDelete={handleDeleteBom}
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {trashed.map(bom => (
                  <div key={bom.id} className="bg-white rounded-2xl p-6 border border-gray-200 opacity-75 shadow-sm transition-shadow hover:shadow-md">
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
                    <h3 className="font-bold text-lg text-gray-800 mb-1">{bom.name}</h3>
                    <p className="text-sm text-red-600 font-semibold mb-3">
                      Deleted on: {new Date(bom.deletedAt).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-600 mb-4">
                      Expires in: ~28 days
                    </p>
                    <div className="flex gap-2">
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

      {/* Delete Confirmation Modal */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete BOM?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-semibold">{selectedBomForDelete?.name}</span>?
              {"\n"}This BOM will be moved to Trash and can be restored within 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {softDeleteError && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{softDeleteError}</p>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel disabled={isSoftDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isSoftDeleting}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSoftDeleting && <Loader className="w-4 h-4 animate-spin" />}
              {isSoftDeleting ? "Moving..." : "Move to Trash"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard Delete Confirmation Modal */}
      <AlertDialog open={hardDeleteConfirmOpen} onOpenChange={setHardDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-semibold">{selectedBomForHardDelete?.name}</span> and all its component data.
              {"\n"}This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{deleteError}</p>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmHardDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isDeleting && <Loader className="w-4 h-4 animate-spin" />}
              {isDeleting ? "Deleting..." : "Delete Forever"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
