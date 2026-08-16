
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { Trash2, RotateCcw, AlertTriangle } from "lucide-react";

interface TrashItem {
  id: number;
  name: string;
  type: "bom" | "bom_item" | "session";
  deletedAt: string | null;
  deletedBy?: string;
  createdAt?: string;
}

interface TrashStats {
  bomCount: number;
  itemCount: number;
  sessionCount: number;
  totalCount: number;
}

export default function TrashBin() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [itemType, setItemType] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedItem, setSelectedItem] = useState<TrashItem | null>(null);
  const [actionType, setActionType] = useState<"recover" | "delete" | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Fetch trash items
  const {
    data: trashData,
    isLoading: isLoadingItems,
    error: itemsError,
  } = useQuery({
    queryKey: ["trash-items", searchTerm, itemType, sortOrder],
    queryFn: async () => {
      const response = await api.get("/api/trash/items", {
        params: {
          type: itemType !== "all" ? itemType : undefined,
          search: searchTerm || undefined,
          order: sortOrder,
          limit: 100,
        },
      });
      return response.data;
    },
  });

  // Fetch trash stats
  const { data: stats } = useQuery<TrashStats>({
    queryKey: ["trash-stats"],
    queryFn: async () => {
      const response = await api.get("/api/trash/stats");
      return response.data as TrashStats;
    },
  });

  // Handle stats fetch errors
  if (stats === undefined) {}

  // Recover item mutation
  const recoverMutation = useMutation({
    mutationFn: async (item: TrashItem) => {
      await api.post(`/api/trash/${item.type}/${item.id}/recover`);
    },
    onSuccess: (_, item) => {
      toast.success(`${item.type} recovered successfully`);
      queryClient.invalidateQueries({ queryKey: ["trash-items"] });
      queryClient.invalidateQueries({ queryKey: ["trash-stats"] });
      setShowConfirmDialog(false);
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "Failed to recover item";
      toast.error(errorMsg);
    },
  });

  // Permanent delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (item: TrashItem) => {
      await api.delete(`/api/trash/${item.type}/${item.id}`);
    },
    onSuccess: (_, item) => {
      toast.success(`${item.type} permanently deleted`);
      queryClient.invalidateQueries({ queryKey: ["trash-items"] });
      queryClient.invalidateQueries({ queryKey: ["trash-stats"] });
      setShowConfirmDialog(false);
    },
    onError: (error: any) => {
      const errorMsg = error?.message || "Failed to delete item";
      toast.error(errorMsg);
    },
  });

  const handleRecover = (item: TrashItem) => {
    setSelectedItem(item);
    setActionType("recover");
    setShowConfirmDialog(true);
  };

  const handlePermanentDelete = (item: TrashItem) => {
    setSelectedItem(item);
    setActionType("delete");
    setShowConfirmDialog(true);
  };

  const handleConfirmAction = () => {
    if (!selectedItem) return;

    if (actionType === "recover") {
      recoverMutation.mutate(selectedItem);
    } else if (actionType === "delete") {
      deleteMutation.mutate(selectedItem);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const items = (trashData as any)?.items || [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Trash Bin</h1>
        <p className="text-gray-600 mt-1">
          Manage deleted BOMs, items, and sessions. Items are permanently deleted
          after 30 days.
        </p>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <div className="text-sm font-medium text-blue-800">Total Items</div>
            <div className="text-2xl font-bold text-blue-900">
              {(stats as any).totalCount || 0}
            </div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
            <div className="text-sm font-medium text-purple-800">BOMs</div>
            <div className="text-2xl font-bold text-purple-900">
              {(stats as any).bomCount || 0}
            </div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
            <div className="text-sm font-medium text-orange-800">BOM Items</div>
            <div className="text-2xl font-bold text-orange-900">
              {(stats as any).itemCount || 0}
            </div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="text-sm font-medium text-green-800">Sessions</div>
            <div className="text-2xl font-bold text-green-900">
              {(stats as any).sessionCount || 0}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="text-sm font-medium text-gray-700">Search</label>
          <Input
            placeholder="Search by name, part number, panel..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mt-1"
          />
        </div>
        <div className="w-40">
          <label className="text-sm font-medium text-gray-700">Type</label>
          <Select value={itemType} onValueChange={setItemType}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="bom">BOMs</SelectItem>
              <SelectItem value="bom_item">BOM Items</SelectItem>
              <SelectItem value="session">Sessions</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <label className="text-sm font-medium text-gray-700">Sort</label>
          <Select
            value={sortOrder}
            onValueChange={(val) => setSortOrder(val as "asc" | "desc")}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Newest First</SelectItem>
              <SelectItem value="asc">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Items Table */}
      <div className="border rounded-lg overflow-hidden">
        {isLoadingItems ? (
          <div className="p-8 text-center text-gray-500">Loading trash items...</div>
        ) : itemsError ? (
          <div className="p-8">
            <div className="text-center text-red-500 mb-4">
              Error loading trash items. Please try again.
            </div>
            <details className="bg-red-50 p-3 rounded border border-red-200 text-xs text-red-700">
              <summary className="cursor-pointer font-semibold">
                Error Details (for debugging)
              </summary>
              <pre className="mt-2 overflow-auto max-h-32">
                {JSON.stringify(
                  {
                    error: itemsError?.message || itemsError,
                    status: (itemsError as any)?.status,
                    response: (itemsError as any)?.response,
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            Your trash bin is empty
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="font-semibold">Type</TableHead>
                <TableHead className="font-semibold">Deleted Date</TableHead>
                <TableHead className="font-semibold">Deleted By</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: TrashItem) => (
                <TableRow key={`${item.type}-${item.id}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {item.type.replace("_", " ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {formatDate(item.deletedAt)}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {item.deletedBy || "System"}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRecover(item)}
                      disabled={
                        recoverMutation.isPending || deleteMutation.isPending
                      }
                    >
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Recover
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handlePermanentDelete(item)}
                      disabled={
                        recoverMutation.isPending || deleteMutation.isPending
                      }
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Confirm Action
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === "recover"
                ? `Are you sure you want to recover this ${selectedItem?.type}? It will be restored to your active items.`
                : `Are you sure you want to permanently delete this ${selectedItem?.type}? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mt-4 p-3 bg-gray-100 rounded text-sm">
            <strong>Item:</strong> {selectedItem?.name}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmAction}
              disabled={
                recoverMutation.isPending || deleteMutation.isPending
              }
              className={
                actionType === "delete"
                  ? "bg-red-600 hover:bg-red-700"
                  : undefined
              }
            >
              {actionType === "recover" ? "Recover" : "Permanently Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
