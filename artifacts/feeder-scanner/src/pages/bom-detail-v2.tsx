import { useState, useRef, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Loader2, Trash2, Upload, ChevronLeft, Plus, Eye, Edit2,
  RotateCcw, Check, X, AlertTriangle, Copy, History, BadgeCheck, GitBranch, Search
} from "lucide-react";
import Papa from "papaparse";
import { format } from "date-fns";
import { logger } from "../lib/logger";
import { PasswordConfirmModal } from "@/components/PasswordConfirmModal";

export default function BomDetailV2() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // --- Missing runtime state & constants (declared before use)
  type BomItemRow = { id?: number; [key: string]: any };
  type RevisionType = { isLatest?: boolean; [key: string]: any };

  const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

  const [match, params] = useRoute("/bom/:bomId");
  const [, setLocation] = useLocation();
  const bomId = Number((params && (params as any).bomId) || 0);

  const { toast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<BomItemRow[]>([]);
  const [trashItems, setTrashItems] = useState<BomItemRow[]>([]);
  const [revisions, setRevisions] = useState<RevisionType[]>([]);
  const [bomData, setBomData] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Mode (view/edit) handling
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const isEditMode = mode === 'edit';
  const isViewMode = mode === 'view';
  // Revision lifecycle: a locked/held revision is read-only until released.
  const isLocked = !!bomData && (bomData.status ?? 'active') !== 'active';

  // BOM-level detail edit (name/description/version/product/customer)
  const [detailForm, setDetailForm] = useState({ name: "", description: "", version: "", product: "", customer: "" });
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailConfirmOpen, setDetailConfirmOpen] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam === 'edit') {
      setMode('edit');
      setDetailDialogOpen(true);
    } else setMode('view');
  }, [/* location changes handled by setLocation usage elsewhere */]);

  const switchToEditMode = () => {
    if (isLocked) {
      toast({ title: "Revision locked", description: "Release this revision before editing.", variant: "destructive" });
      return;
    }
    setMode('edit');
    setLocation(`/bom/${bomId}?mode=edit`);
    setDetailDialogOpen(true);
  };

  const switchToViewMode = () => {
    setMode('view');
    setLocation(`/bom/${bomId}?mode=view`);
  };

  // If a revision is locked/held after loading, force it back to read-only.
  useEffect(() => {
    if (isLocked && mode === 'edit') {
      setMode('view');
      setDetailDialogOpen(false);
    }
  }, [isLocked, mode]);

  // Persist BOM-level detail edits (password-gated via PasswordConfirmModal).
  const saveDetails = async () => {
    if (!detailForm.name.trim()) {
      toast({ title: "Error", description: "BOM Name is required", variant: "destructive" });
      return;
    }
    setIsSavingDetails(true);
    try {
      const res = await fetch(`${API_BASE}/api/bom/${bomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: detailForm.name.trim(),
          description: detailForm.description || null,
          version: detailForm.version || null,
          product: detailForm.product || null,
          customer: detailForm.customer || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update BOM");
      toast({ title: "Success", description: "BOM details updated" });
      setDetailDialogOpen(false);
      fetchBomData();
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to update BOM", variant: "destructive" });
    } finally {
      setIsSavingDetails(false);
    }
  };

  // ========== FILTER & BULK SELECTION ==========
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Trash filter & bulk selection
  const [trashSearch, setTrashSearch] = useState("");
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<number>>(new Set());
  const [bulkPermanentConfirmOpen, setBulkPermanentConfirmOpen] = useState(false);
  const [isBulkTrashProcessing, setIsBulkTrashProcessing] = useState(false);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = [
        item.srNo, item.feederNumber, item.ucalIntPn, item.internalPartNumber,
        item.reference, item.referenceLocation, item.description,
        item.package, item.packageDescription,
        item.make1, item.mpn1, item.make2, item.mpn2, item.make3, item.mpn3,
        item.make4, item.mpn4, item.make5, item.mpn5, item.make6, item.mpn6,
        item.make7, item.mpn7, item.make8, item.mpn8,
        item.remarks, item.action,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, itemSearch]);

  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredItems.slice(startIndex, startIndex + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredItems.length / pageSize);

  // Reset to first page when the filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [itemSearch]);

  // Bulk selection helpers (operate over the currently visible page)
  const pageIds = useMemo(
    () => paginatedItems.map((it) => Number(it.id)),
    [paginatedItems]
  );
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedItemIds.has(id));

  const toggleSelectItem = (id: number) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedItemIds(new Set());

  const bulkDeleteSelected = async () => {
    const ids = Array.from(selectedItemIds);
    if (ids.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`${API_BASE}/api/bom-items/${id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
          }).then((res) => {
            if (!res.ok) throw new Error(`Failed to delete item ${id}`);
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = ids.length - failed;
      if (succeeded > 0) {
        toast({ title: "Success", description: `${succeeded} item${succeeded === 1 ? "" : "s"} moved to trash` });
      }
      if (failed > 0) {
        toast({ title: "Partial failure", description: `${failed} item${failed === 1 ? "" : "s"} could not be deleted`, variant: "destructive" });
      }
      clearSelection();
      setBulkDeleteConfirmOpen(false);
      fetchBomData();
    } catch (error) {
      logger.error({ error }, "Error bulk-deleting items:");
      toast({ title: "Error", description: "Failed to delete selected items", variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // ---- Trash filter & bulk selection ----
  const filteredTrashItems = useMemo(() => {
    const q = trashSearch.trim().toLowerCase();
    if (!q) return trashItems;
    return trashItems.filter((item) => {
      const haystack = [
        item.srNo, item.feederNumber, item.ucalIntPn, item.internalPartNumber,
        item.reference, item.referenceLocation, item.description,
        item.package, item.packageDescription,
        item.make1, item.mpn1, item.make2, item.mpn2, item.make3, item.mpn3,
        item.make4, item.mpn4, item.make5, item.mpn5, item.make6, item.mpn6,
        item.make7, item.mpn7, item.make8, item.mpn8,
        item.remarks, item.action,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [trashItems, trashSearch]);

  const trashPageIds = useMemo(
    () => filteredTrashItems.map((it) => Number(it.id)),
    [filteredTrashItems]
  );
  const allTrashSelected = trashPageIds.length > 0 && trashPageIds.every((id) => selectedTrashIds.has(id));

  const toggleSelectTrashItem = (id: number) => {
    setSelectedTrashIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllTrash = () => {
    setSelectedTrashIds((prev) => {
      const next = new Set(prev);
      if (allTrashSelected) trashPageIds.forEach((id) => next.delete(id));
      else trashPageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearTrashSelection = () => setSelectedTrashIds(new Set());

  const bulkTrashAction = async (kind: "restore" | "permanent") => {
    const ids = Array.from(selectedTrashIds);
    if (ids.length === 0) return;
    setIsBulkTrashProcessing(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(
            `${API_BASE}/api/bom-items/${id}${kind === "restore" ? "/restore" : "/permanent"}`,
            {
              method: kind === "restore" ? "PATCH" : "DELETE",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
            }
          ).then((res) => {
            if (!res.ok) throw new Error(`Failed to ${kind} item ${id}`);
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = ids.length - failed;
      const verb = kind === "restore" ? "restored" : "permanently deleted";
      if (succeeded > 0) {
        toast({ title: "Success", description: `${succeeded} item${succeeded === 1 ? "" : "s"} ${verb}` });
      }
      if (failed > 0) {
        toast({ title: "Partial failure", description: `${failed} item${failed === 1 ? "" : "s"} could not be ${verb}`, variant: "destructive" });
      }
      clearTrashSelection();
      setBulkPermanentConfirmOpen(false);
      fetchBomData();
    } catch (error) {
      logger.error({ error }, `Error during bulk ${kind}:`);
      toast({ title: "Error", description: `Failed to ${kind} selected items`, variant: "destructive" });
    } finally {
      setIsBulkTrashProcessing(false);
    }
  };

  const latestRevision = useMemo(() => {
    return revisions.find((rev) => rev.isLatest) || null;
  }, [revisions]);

  useEffect(() => {
    if (!bomId) return;
    fetchBomData();
    setCurrentPage(1); // Reset to first page when data changes
  }, [bomId]);

  const fetchBomData = async () => {
    try {
      setIsLoading(true);
      
      // Fetch BOM
      const bomRes = await fetch(`${API_BASE}/api/boms/${bomId}`, { credentials: "include" });
      if (!bomRes.ok) throw new Error("Failed to fetch BOM");
      const bom = await bomRes.json();
      setBomData(bom);
      setDetailForm({
        name: bom.name ?? "",
        description: bom.description ?? "",
        version: bom.version ?? "",
        product: bom.product ?? "",
        customer: bom.customer ?? "",
      });

      // Fetch active items
      const itemsRes = await fetch(`${API_BASE}/api/bom-items?bom_id=${bomId}`, { credentials: "include" });
      if (!itemsRes.ok) throw new Error("Failed to fetch items");
      const itemsData = await itemsRes.json();
      setItems(itemsData || []);

      // Fetch trash items
      const trashRes = await fetch(`${API_BASE}/api/bom-items/trash?bom_id=${bomId}`, { credentials: "include" });
      if (!trashRes.ok) throw new Error("Failed to fetch trash");
      const trashData = await trashRes.json();
      setTrashItems(trashData || []);

      // Fetch revisions
      try {
        const revisionsRes = await fetch(`${API_BASE}/api/boms/${bomId}/revisions`, { credentials: "include" });
        if (revisionsRes.ok) {
          const revisionsData = await revisionsRes.json();
          setRevisions(revisionsData || []);
        }
      } catch (e) {
        logger.warn({ e }, "Failed to fetch revisions:");
      }
    } catch (error) {
      logger.error({ error }, "Error fetching BOM data:");
      toast({
        title: "Error",
        description: "Failed to load BOM data",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Lightweight background refresh — no loading skeleton, no error toast.
  // Used by the polled realtime refresh so another user's edits show up.
  const refreshItemsSilently = async () => {
    try {
      const itemsRes = await fetch(`${API_BASE}/api/bom-items?bom_id=${bomId}`, { credentials: "include" });
      if (itemsRes.ok) setItems((await itemsRes.json()) || []);
      const trashRes = await fetch(`${API_BASE}/api/bom-items/trash?bom_id=${bomId}`, { credentials: "include" });
      if (trashRes.ok) setTrashItems((await trashRes.json()) || []);
    } catch (e) {
      logger.warn({ e }, "Background BOM refresh failed");
    }
  };

  // ========== FORM STATE FOR NEW ITEM ==========
  const [newItem, setNewItem] = useState({
    srNo: "",
    feederNumber: "",
    ucalIntPn: "",
    quantity: "1",
    reference: "",
    description: "",
    package: "",
    make1: "", mpn1: "",
    make2: "", mpn2: "",
    make3: "", mpn3: "",
    make4: "", mpn4: "",
    make5: "", mpn5: "",
    make6: "", mpn6: "",
    make7: "", mpn7: "",
    make8: "", mpn8: "",
    remarks: "",
    action: "",
  });

  // ========== INLINE EDIT STATE ==========
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<Partial<BomItemRow> | null>(null);
  const [isItemEditDialogOpen, setIsItemEditDialogOpen] = useState(false);
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);

  // ========== TRASH & MODALS ==========
  const [showTrash, setShowTrash] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [showPermanentDeleteConfirm, setShowPermanentDeleteConfirm] = useState<number | null>(null);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionForm, setRevisionForm] = useState({ label: "", notes: "", sourceBomId: "" });
  const [isCreatingRevision, setIsCreatingRevision] = useState(false);

  // ========== POLLED REALTIME REFRESH ==========
  // Refetch items every 12s so edits made elsewhere show up. Paused while the
  // user is editing or any dialog is open, to avoid clobbering in-progress input.
  const pausePolling =
    mode === "edit" ||
    addItemDialogOpen ||
    isItemEditDialogOpen ||
    detailDialogOpen ||
    detailConfirmOpen ||
    showRevisionModal ||
    bulkDeleteConfirmOpen ||
    bulkPermanentConfirmOpen ||
    showDeleteConfirm !== null ||
    showPermanentDeleteConfirm !== null;

  useEffect(() => {
    if (pausePolling) return;
    const id = setInterval(() => {
      refreshItemsSilently();
    }, 12000);
    return () => clearInterval(id);
  }, [pausePolling, bomId]);

  const normalizeHeader = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");

  const cleanCell = (value: string) => value.replace(/\s+/g, " ").trim();

  const findColumnIndex = (row: string[], aliases: string[]) => {
    const normalizedAliases = aliases.map((a) => normalizeHeader(a));
    return row.findIndex((cell) => {
      const normalizedCell = normalizeHeader(cell);
      return normalizedAliases.some(
        (alias) => normalizedCell === alias || normalizedCell.includes(alias),
      );
    });
  };

  // ========== BUTTON STYLE CLASSES ==========
  const btnPrimary = "bg-orange-500 hover:bg-orange-600 text-white border-0";
  const btnSecondary = "bg-orange-500 hover:bg-orange-600 text-white border-0";
  const btnDanger = "bg-orange-500 hover:bg-orange-600 text-white border-0";
  const btnRestore = "bg-orange-500 hover:bg-orange-600 text-white border-0";
  const btnIcon = "p-1 bg-orange-500 hover:bg-orange-600 text-white rounded-md border-0";

  // ========== FORM HANDLERS ==========

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent duplicate items: block if feeder OR SR No already exists in this BOM
    const normalizedNewFeeder = String(newItem.feederNumber || "").trim();
    const normalizedNewSrNo = String(newItem.srNo || "").trim();

    const duplicateFeeder = normalizedNewFeeder
      ? items.some((it) => String(it.feederNumber || "").trim() === normalizedNewFeeder)
      : false;
    const duplicateSrNo = normalizedNewSrNo
      ? items.some((it) => String(it.srNo || "").trim() === normalizedNewSrNo)
      : false;
    const isDuplicate = duplicateFeeder || duplicateSrNo;

    if (isDuplicate) {
      const duplicateFields = [
        duplicateFeeder ? "Feeder Number" : null,
        duplicateSrNo ? "SR No" : null,
      ].filter(Boolean).join(" and ");

      toast({
        title: "Duplicate",
        description: `${duplicateFields} already exists in this BOM. Please use unique values.`,
        variant: "destructive",
      });
      return;
    }

    const payload = {
      bomId,
      srNo: newItem.srNo || undefined,
      feederNumber: newItem.feederNumber,
      ucalIntPn: newItem.ucalIntPn || undefined,
      quantity: newItem.quantity,
      reference: newItem.reference || undefined,
      description: newItem.description || undefined,
      package: newItem.package || undefined,
      make1: newItem.make1 || undefined,
      mpn1: newItem.mpn1 || undefined,
      make2: newItem.make2 || undefined,
      mpn2: newItem.mpn2 || undefined,
      make3: newItem.make3 || undefined,
      mpn3: newItem.mpn3 || undefined,
      make4: newItem.make4 || undefined,
      mpn4: newItem.mpn4 || undefined,
      make5: newItem.make5 || undefined,
      mpn5: newItem.mpn5 || undefined,
      make6: newItem.make6 || undefined,
      mpn6: newItem.mpn6 || undefined,
      make7: newItem.make7 || undefined,
      mpn7: newItem.mpn7 || undefined,
      make8: newItem.make8 || undefined,
      mpn8: newItem.mpn8 || undefined,
      remarks: newItem.remarks || undefined,
      action: newItem.action || undefined,
    };

    try {
      const res = await fetch(`${API_BASE}/api/bom-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to add item");

      toast({ title: "Success", description: "Item added to BOM" });
      setNewItem({
        srNo: "", feederNumber: "", ucalIntPn: "", quantity: "1",
        reference: "", description: "", package: "",
        make1: "", mpn1: "", make2: "", mpn2: "", make3: "", mpn3: "",
        make4: "", mpn4: "", make5: "", mpn5: "", make6: "", mpn6: "",
        make7: "", mpn7: "", make8: "", mpn8: "",
        remarks: "", action: "",
      });
      setAddItemDialogOpen(false);
      fetchBomData();
    } catch (error) {
      logger.error({ error }, "Error adding item:");
      toast({ title: "Error", description: "Failed to add item", variant: "destructive" });
    }
  };

  const startEditItem = (item: BomItemRow) => {
    setEditingItemId(Number(item.id));
    setEditingItem({ ...item });
    setIsItemEditDialogOpen(true);
  };

  const updateEditingItemField = <K extends keyof BomItemRow>(field: K, value: BomItemRow[K]) => {
    setEditingItem((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveEditedItem = async () => {
    if (!editingItemId || !editingItem) return;

    try {
      const res = await fetch(`${API_BASE}/api/bom-items/${editingItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(editingItem),
      });

      if (!res.ok) throw new Error("Failed to update item");

      toast({ title: "Success", description: "Item updated" });
      setEditingItemId(null);
      setEditingItem(null);
      setIsItemEditDialogOpen(false);
      fetchBomData();
    } catch (error) {
      logger.error({ error }, "Error updating item:");
      toast({ title: "Error", description: "Failed to update item", variant: "destructive" });
    }
  };

  const cancelEdit = () => {
    setEditingItemId(null);
    setEditingItem(null);
    setIsItemEditDialogOpen(false);
  };

  const deleteItem = async (itemId: number) => {
    try {
const res = await fetch(`${API_BASE}/api/bom-items/${itemId}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to delete item");

      toast({ title: "Success", description: "Item moved to trash" });
      setShowDeleteConfirm(null);
      fetchBomData();
    } catch (error) {
      logger.error({ error }, "Error deleting item:");
      toast({ title: "Error", description: "Failed to delete item", variant: "destructive" });
    }
  };

  const restoreItem = async (itemId: number) => {
    try {
const res = await fetch(`${API_BASE}/api/bom-items/${itemId}/restore`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to restore item");

      toast({ title: "Success", description: "Item restored" });
      fetchBomData();
    } catch (error) {
      logger.error({ error }, "Error restoring item:");
      toast({ title: "Error", description: "Failed to restore item", variant: "destructive" });
    }
  };

  const permanentlyDeleteItem = async (itemId: number) => {
    try {
const res = await fetch(`${API_BASE}/api/bom-items/${itemId}/permanent`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to permanently delete");

      toast({ title: "Success", description: "Item permanently deleted" });
      setShowPermanentDeleteConfirm(null);
      fetchBomData();
    } catch (error) {
      logger.error({ error }, "Error permanently deleting:");
      toast({ title: "Error", description: "Failed to permanently delete", variant: "destructive" });
    }
  };

  const createRevision = async () => {
    if (!revisionForm.label) {
      toast({ title: "Error", description: "Revision label is required", variant: "destructive" });
      return;
    }

    setIsCreatingRevision(true);
    try {
      const res = await fetch(`${API_BASE}/api/boms/${bomId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          revisionLabel: revisionForm.label,
          revisionNotes: revisionForm.notes || undefined,
          sourceBomId: revisionForm.sourceBomId ? Number(revisionForm.sourceBomId) : undefined,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create revision");
      }

      const newBom = await res.json();
      toast({ title: "Success", description: "New revision created" });
      setShowRevisionModal(false);
      setRevisionForm({ label: "", notes: "", sourceBomId: "" });
      setLocation(`/bom/${newBom.id}?mode=view`);
    } catch (error) {
      logger.error({ error }, "Error creating revision:");
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to create revision", variant: "destructive" });
    } finally {
      setIsCreatingRevision(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    Papa.parse(file, {
      header: false,
      skipEmptyLines: false,
      complete: async (results) => {
        try {
          const rawRows = (results.data as string[][]).map((row) =>
            row.map((cell) => (cell ?? "").toString().trim()),
          );

          const feederAliases = [
            "feedernumber",
            "feeder",
            "feeder no",
            "feeder no.",
            "feeder number",
          ];
          const ucalIntPnAliases = [
            "ucalinternalpartnumber",
            "internalpartnumber",
            "internal no",
            "partnumber",
            "part number",
            "part no",
          ];
          const descriptionAliases = ["description", "desc", "componentvalues", "component value"];
          const packageAliases = ["packagedescription", "package description", "package"];
          const referenceAliases = ["reference", "ref", "referencelocation"];
          const quantityAliases = ["quantity", "qty", "requiredqty"];
          const make1Aliases = ["make1", "make/supplier1", "supplier1"];
          const mpn1Aliases = ["mpn1", "mpn"];
          const make2Aliases = ["make2", "make/supplier2", "supplier2"];
          const mpn2Aliases = ["mpn2"];
          const make3Aliases = ["make3", "make/supplier3", "supplier3"];
          const mpn3Aliases = ["mpn3"];
          const remarksAliases = ["remarks", "remark", "comments"];
          const actionAliases = ["action", "dnp"];

          let headerIndex = -1;
          let feederIndex = -1;
          let ucalIntPnIndex = -1;
          let descriptionIndex = -1;
          let packageIndex = -1;
          let referenceIndex = -1;
          let quantityIndex = -1;
          let make1Index = -1;
          let mpn1Index = -1;
          let make2Index = -1;
          let mpn2Index = -1;
          let make3Index = -1;
          let mpn3Index = -1;
          let remarksIndex = -1;
          let actionIndex = -1;

          // Find header row
          for (let i = 0; i < rawRows.length; i++) {
            const row = rawRows[i];
            const maybeFeederIndex = findColumnIndex(row, feederAliases);
            if (maybeFeederIndex !== -1) {
              headerIndex = i;
              feederIndex = maybeFeederIndex;
              ucalIntPnIndex = findColumnIndex(row, ucalIntPnAliases);
              descriptionIndex = findColumnIndex(row, descriptionAliases);
              packageIndex = findColumnIndex(row, packageAliases);
              referenceIndex = findColumnIndex(row, referenceAliases);
              quantityIndex = findColumnIndex(row, quantityAliases);
              make1Index = findColumnIndex(row, make1Aliases);
              mpn1Index = findColumnIndex(row, mpn1Aliases);
              make2Index = findColumnIndex(row, make2Aliases);
              mpn2Index = findColumnIndex(row, mpn2Aliases);
              make3Index = findColumnIndex(row, make3Aliases);
              mpn3Index = findColumnIndex(row, mpn3Aliases);
              remarksIndex = findColumnIndex(row, remarksAliases);
              actionIndex = findColumnIndex(row, actionAliases);
              break;
            }
          }

          if (headerIndex === -1) {
            toast({
              title: "Error",
              description: "Could not find header row with 'Feeder Number' column",
              variant: "destructive",
            });
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            return;
          }

          let importedCount = 0;
          let skippedCount = 0;

          for (let i = headerIndex + 1; i < rawRows.length; i++) {
            const row = rawRows[i];
            const feederNumber = cleanCell(row[feederIndex] ?? "");

            if (!feederNumber) {
              skippedCount++;
              continue;
            }

            const payload = {
              bomId,
              srNo: undefined as string | undefined,
              feederNumber,
              ucalIntPn: ucalIntPnIndex >= 0 ? cleanCell(row[ucalIntPnIndex] ?? "") || undefined : undefined,
              quantity: quantityIndex >= 0 && row[quantityIndex] ? Number(row[quantityIndex]) || 1 : 1,
              reference: referenceIndex >= 0 ? cleanCell(row[referenceIndex] ?? "") || undefined : undefined,
              description: descriptionIndex >= 0 ? cleanCell(row[descriptionIndex] ?? "") || undefined : undefined,
              package: packageIndex >= 0 ? cleanCell(row[packageIndex] ?? "") || undefined : undefined,
              make1: make1Index >= 0 ? cleanCell(row[make1Index] ?? "") || undefined : undefined,
              mpn1: mpn1Index >= 0 ? cleanCell(row[mpn1Index] ?? "") || undefined : undefined,
              make2: make2Index >= 0 ? cleanCell(row[make2Index] ?? "") || undefined : undefined,
              mpn2: mpn2Index >= 0 ? cleanCell(row[mpn2Index] ?? "") || undefined : undefined,
              make3: make3Index >= 0 ? cleanCell(row[make3Index] ?? "") || undefined : undefined,
              mpn3: mpn3Index >= 0 ? cleanCell(row[mpn3Index] ?? "") || undefined : undefined,
              remarks: remarksIndex >= 0 ? cleanCell(row[remarksIndex] ?? "") || undefined : undefined,
              action: actionIndex >= 0 ? cleanCell(row[actionIndex] ?? "") || undefined : undefined,
            };

            try {
              const res = await fetch(`${API_BASE}/api/bom-items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(payload),
              });

              if (!res.ok) throw new Error("Failed to add item");
              importedCount++;
              } catch (error) {
              logger.error({ error }, "Error adding item from CSV:");
              skippedCount++;
            }
          }

          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = "";

          if (importedCount > 0) {
            toast({
              title: "CSV Import Complete",
              description: `${importedCount} items added${skippedCount > 0 ? `, ${skippedCount} skipped` : ""}`,
            });
            fetchBomData();
          } else {
            toast({
              title: "Import Failed",
              description: `${skippedCount} rows skipped. Check CSV format and try again.`,
              variant: "destructive",
            });
          }
        } catch (error) {
          logger.error({ error }, "Error processing CSV:");
          toast({ title: "Error", description: "Failed to import CSV", variant: "destructive" });
          setIsUploading(false);
        }
      },
    });
  };

  // ========== RENDER HELPERS ==========

  const renderBomHeader = () => (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <Button
              onClick={() => setLocation("/bom")}
              className={`${btnSecondary} px-2.5 py-2`}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <h1 className="text-3xl font-bold text-navy">{bomData?.name}</h1>
            {bomData?.revisionLabel && (
              <span className="bg-blue-100 text-navy px-3 py-1 rounded-full font-semibold text-sm">
                {bomData.revisionLabel}
              </span>
            )}
            {isEditMode && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-700">
                <Edit2 className="h-3.5 w-3.5" />
                Editing
              </span>
            )}
            {isLocked && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
                {(bomData.status ?? '').toLowerCase() === 'hold' ? 'On Hold' : 'Locked'} · read-only
              </span>
            )}
          </div>
          {bomData?.description && (
            <p className="text-gray-600 text-sm ml-11">{bomData.description}</p>
          )}
          {isViewMode && (bomData?.version || bomData?.product || bomData?.customer) && (
            <div className="ml-11 mt-2 flex flex-wrap gap-2">
              {bomData?.version && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  Version: {bomData.version}
                </span>
              )}
              {bomData?.product && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  Product: {bomData.product}
                </span>
              )}
              {bomData?.customer && (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  Customer: {bomData.customer}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-navy">{bomData?.itemCount || 0}</div>
          <div className="text-xs text-gray-500">Items</div>
        </div>
      </div>

      {/* Edit BOM details — opens the edit window (dialog) */}
      {isEditMode && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setDetailDialogOpen(true)} className={`${btnPrimary} px-4 py-2 rounded-lg`}>
            <Edit2 className="w-4 h-4 mr-2" />
            Edit Details
          </Button>
        </div>
      )}

      {/* Revision Breadcrumb */}
      {revisions.length > 0 && (
        <div className="mb-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-orange-50 shadow-sm overflow-hidden">
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-700">
                  <History className="h-4 w-4" />
                  Revision Trail
                </div>
                <h3 className="mt-2 text-lg font-bold text-navy">Latest revision card</h3>
                <p className="mt-1 text-sm text-gray-600">
                  The newest revision is highlighted here for quick access.
                </p>
              </div>
              {latestRevision && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm shadow-sm">
                  <div className="flex items-center gap-2 text-green-700 font-bold uppercase tracking-wide text-xs">
                    <BadgeCheck className="h-4 w-4" />
                    Latest Revision
                  </div>
                  <div className="mt-1 text-base font-bold text-green-900">
                    {latestRevision.revisionLabel || "Original"}
                  </div>
                  <div className="text-xs text-green-700">
                    BOM #{latestRevision.id}
                    {latestRevision.createdAt ? ` • ${format(new Date(latestRevision.createdAt), "dd-MMM-yyyy HH:mm")}` : ""}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              <GitBranch className="h-4 w-4" />
              All revisions
            </div>

            <div className="flex flex-wrap gap-3">
              {revisions.map((rev) => {
                const isLatestCard = latestRevision?.id === rev.id;
                return (
                  <button
                    key={rev.id}
                    onClick={() => setLocation(`/bom/${rev.id}?mode=view`)}
                    className={`group min-w-[140px] rounded-xl border px-4 py-3 text-left transition-all duration-200 ${
                      isLatestCard
                        ? "border-green-300 bg-green-50 shadow-sm ring-1 ring-green-200 hover:bg-green-100"
                        : "border-blue-200 bg-white hover:border-orange-300 hover:bg-orange-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-navy group-hover:text-orange-700">
                        {rev.revisionLabel || "Original"}
                      </span>
                      {isLatestCard ? (
                        <span className="rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                          Latest
                        </span>
                      ) : (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
                          Revision
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      BOM #{rev.id}
                    </div>
                    {rev.createdAt && (
                      <div className="mt-1 text-xs text-gray-500">
                        {format(new Date(rev.createdAt), "dd-MMM-yyyy HH:mm")}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mode Toggle & Actions */}
      <div className="flex items-center justify-between">
        <div className="inline-flex gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1">
          <Button
            onClick={switchToViewMode}
            className={`px-4 py-2 rounded-md border-0 ${isViewMode ? "bg-white text-navy shadow-sm" : "bg-transparent text-gray-600 hover:bg-white/60"}`}
          >
            <Eye className="w-4 h-4 mr-2" />
            View
          </Button>
          <Button
            onClick={switchToEditMode}
            disabled={isLocked}
            title={isLocked ? "Release this revision to edit" : undefined}
            className={`px-4 py-2 rounded-md border-0 ${isEditMode ? "bg-orange-500 text-white shadow-sm" : "bg-transparent text-gray-600 hover:bg-white/60"} ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Edit
          </Button>
        </div>
        <div className="flex gap-2">
          {showTrash && (
            <Button className={`${btnSecondary} px-4 py-2 rounded-lg`} onClick={() => setShowTrash(false)}>
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back to Items
            </Button>
          )}
          {!showTrash && (
            <Button
              onClick={() => setShowTrash(true)}
              className={`${btnSecondary} px-4 py-2 rounded-lg`}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Trash ({trashItems.length})
            </Button>
          )}
          {!showTrash && isEditMode && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className={`${btnPrimary} px-4 py-2 rounded-lg`}
              >
                {isUploading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                {isUploading ? "Importing CSV..." : "Import CSV"}
              </Button>
              <Button
                onClick={() => setAddItemDialogOpen(true)}
                className={`${btnPrimary} px-4 py-2 rounded-lg`}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Component
              </Button>
            </>
          )}
          <Button
            onClick={() => {
              setRevisionForm((prev) => ({
                ...prev,
                sourceBomId: String(latestRevision?.id || bomId),
              }));
              setShowRevisionModal(true);
            }}
            className={`${btnPrimary} px-4 py-2 rounded-lg`}
          >
            <Copy className="w-4 h-4 mr-2" />
            New Revision
          </Button>
        </div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="p-6 w-full animate-pulse">
        {/* Header skeleton */}
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded bg-gray-200" />
            <div className="h-7 w-48 rounded bg-gray-200" />
            <div className="h-6 w-20 rounded-full bg-gray-100" />
          </div>
          <div className="mt-3 ml-11 h-4 w-64 rounded bg-gray-100" />
        </div>
        {/* Toolbar skeleton */}
        <div className="mb-4 flex justify-between">
          <div className="h-10 w-40 rounded-lg bg-gray-200" />
          <div className="h-10 w-32 rounded-lg bg-gray-100" />
        </div>
        {/* Table skeleton */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 h-6 w-full rounded bg-gray-100" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="mb-3 h-5 w-full rounded bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!bomData) {
    return (
      <div className="p-6 w-full">
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white py-24 shadow-sm">
          <AlertTriangle className="w-8 h-8 text-orange-500" />
          <p className="text-sm font-medium text-gray-600">This BOM could not be loaded.</p>
          <Button onClick={() => setLocation("/bom")} className={`${btnSecondary} px-4 py-2 rounded-lg`}>
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back to BOMs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 w-full">
      {renderBomHeader()}

      {/* Main Content - Tabs or View */}
      {!showTrash ? (
        // VIEW/EDIT ITEMS TABLE
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          {/* Filter toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Filter items by feeder, part number, description, MPN..."
                className="pl-9"
              />
            </div>
            <span className="text-sm text-gray-500">
              {filteredItems.length} of {items.length} item{items.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Bulk action bar */}
          {isEditMode && selectedItemIds.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
              <span className="text-sm font-semibold text-orange-800">
                {selectedItemIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <Button onClick={() => setBulkDeleteConfirmOpen(true)} className={`${btnDanger} px-4 py-2 rounded-lg`}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Selected
                </Button>
                <Button variant="outline" onClick={clearSelection} className="px-4 py-2 rounded-lg">
                  Clear
                </Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {isEditMode && (
                    <th className="px-4 py-3 text-center font-semibold text-gray-700">
                      <Checkbox
                        checked={allOnPageSelected}
                        onCheckedChange={toggleSelectAllOnPage}
                        aria-label="Select all on page"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10">SR No</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 sticky left-12 bg-gray-50 z-10">Feeder #</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">UCAL Int PN</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">QTY</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">REF</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">DESC</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">PKG</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Make 1 / MPN</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Alternates (MPN 2-8)</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Remarks</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Action</th>
                  {isEditMode && <th className="px-4 py-3 text-center font-semibold text-gray-700">Operations</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={isEditMode ? 13 : 11} className="px-4 py-8 text-center text-gray-500">
                      {itemSearch ? "No items match your filter" : "No items in this BOM"}
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item) => {
                    const rowId = Number(item.id);
                    const isSelected = selectedItemIds.has(rowId);
                    return (
                    <tr key={item.id} className={`border-b border-gray-100 hover:bg-blue-50 ${isSelected ? "bg-orange-50" : ""}`}>
                      {isEditMode && (
                        <td className="px-4 py-3 text-center">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelectItem(rowId)}
                            aria-label={`Select item ${item.feederNumber ?? rowId}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-gray-700 sticky left-0 bg-white group-hover:bg-blue-50">{item.srNo}</td>
                      <td className="px-4 py-3 font-mono text-gray-700 sticky left-12 bg-white group-hover:bg-blue-50">{item.feederNumber}</td>
                      <td className="px-4 py-3 text-gray-700">{item.ucalIntPn || item.internalPartNumber || item.partNumber || item.rdeplyPartNo || item.internalId}</td>
                      <td className="px-4 py-3 text-gray-700">{item.quantity}</td>
                      <td className="px-4 py-3 text-gray-700">{item.reference || item.referenceLocation || item.referenceDesignator || item.reference_designator || item.ref || item.refdes || item.location || "-"}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{item.description}</td>
                      <td className="px-4 py-3 text-gray-700">{item.package || item.packageDescription || item.package_description || item.pack || item.packageDesc || item.packageName || "-"}</td>
                      <td className="px-4 py-3 text-gray-700">{item.make1} / {item.mpn1}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {(() => {
                          const alts = [2, 3, 4, 5, 6, 7, 8]
                            .map((n) => ({ make: item[`make${n}`], mpn: item[`mpn${n}`], n }))
                            .filter((a) => a.make || a.mpn);
                          if (alts.length === 0) return "-";
                          return (
                            <div className="flex flex-col gap-0.5">
                              {alts.map((a) => (
                                <span key={a.n} className="text-xs whitespace-nowrap">
                                  <span className="text-gray-400">#{a.n}</span> {a.make || "—"} / {a.mpn || "—"}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{item.remarks}</td>
                      <td className="px-4 py-3">
                        {item.action ? <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs font-semibold">{item.action}</span> : "-"}
                      </td>
                      {isEditMode && (
                        <td className="px-4 py-3 text-center space-x-2">
                          <Button onClick={() => startEditItem(item)} className={`${btnIcon}`} title="Edit">
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button onClick={() => setShowDeleteConfirm(Number(item.id))} className={`${btnIcon}`} title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <Dialog
            open={isItemEditDialogOpen && editingItemId !== null}
            onOpenChange={(open) => {
              if (!open) {
                cancelEdit();
              } else {
                setIsItemEditDialogOpen(true);
              }
            }}
          >
            <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-white">
              <DialogHeader>
                <DialogTitle>Edit BOM Component</DialogTitle>
                <DialogDescription>
                  Update the selected BOM item in a popup window, then save the component details.
                </DialogDescription>
              </DialogHeader>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEditedItem();
                }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-srno">SR No</Label>
                    <Input
                      id="edit-srno"
                      value={editingItem?.srNo ?? ""}
                      onChange={(e) => updateEditingItemField("srNo", e.target.value)}
                      placeholder="Serial number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-feeder">Feeder Number *</Label>
                    <Input
                      id="edit-feeder"
                      value={editingItem?.feederNumber ?? ""}
                      onChange={(e) => updateEditingItemField("feederNumber", e.target.value)}
                      required
                      placeholder="Feeder number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-ucal">UCAL Int PN</Label>
                    <Input
                      id="edit-ucal"
                      value={editingItem?.ucalIntPn ?? ""}
                      onChange={(e) => updateEditingItemField("ucalIntPn", e.target.value)}
                      placeholder="Internal part number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-qty">Quantity</Label>
                    <Input
                      id="edit-qty"
                      type="number"
                      min="0"
                      value={editingItem?.quantity ?? ""}
                      onChange={(e) => updateEditingItemField("quantity", e.target.value)}
                      placeholder="Quantity"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="edit-ref">Reference</Label>
                    <Input
                      id="edit-ref"
                      value={editingItem?.reference ?? ""}
                      onChange={(e) => updateEditingItemField("reference", e.target.value)}
                      placeholder="Reference designator"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="edit-desc">Description</Label>
                    <Input
                      id="edit-desc"
                      value={editingItem?.description ?? ""}
                      onChange={(e) => updateEditingItemField("description", e.target.value)}
                      placeholder="Component description"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="edit-package">Package</Label>
                    <Input
                      id="edit-package"
                      value={editingItem?.package ?? ""}
                      onChange={(e) => updateEditingItemField("package", e.target.value)}
                      placeholder="Package"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 1 / MPN 1</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input
                        value={editingItem?.make1 ?? ""}
                        onChange={(e) => updateEditingItemField("make1", e.target.value)}
                        placeholder="Make 1"
                      />
                      <Input
                        value={editingItem?.mpn1 ?? ""}
                        onChange={(e) => updateEditingItemField("mpn1", e.target.value)}
                        placeholder="MPN 1"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 2 / MPN 2</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input
                        value={editingItem?.make2 ?? ""}
                        onChange={(e) => updateEditingItemField("make2", e.target.value)}
                        placeholder="Make 2"
                      />
                      <Input
                        value={editingItem?.mpn2 ?? ""}
                        onChange={(e) => updateEditingItemField("mpn2", e.target.value)}
                        placeholder="MPN 2"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 3 / MPN 3</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input
                        value={editingItem?.make3 ?? ""}
                        onChange={(e) => updateEditingItemField("make3", e.target.value)}
                        placeholder="Make 3"
                      />
                      <Input
                        value={editingItem?.mpn3 ?? ""}
                        onChange={(e) => updateEditingItemField("mpn3", e.target.value)}
                        placeholder="MPN 3"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 4 / MPN 4</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input value={editingItem?.make4 ?? ""} onChange={(e) => updateEditingItemField("make4", e.target.value)} placeholder="Make 4" />
                      <Input value={editingItem?.mpn4 ?? ""} onChange={(e) => updateEditingItemField("mpn4", e.target.value)} placeholder="MPN 4" />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 5 / MPN 5</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input value={editingItem?.make5 ?? ""} onChange={(e) => updateEditingItemField("make5", e.target.value)} placeholder="Make 5" />
                      <Input value={editingItem?.mpn5 ?? ""} onChange={(e) => updateEditingItemField("mpn5", e.target.value)} placeholder="MPN 5" />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 6 / MPN 6</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input value={editingItem?.make6 ?? ""} onChange={(e) => updateEditingItemField("make6", e.target.value)} placeholder="Make 6" />
                      <Input value={editingItem?.mpn6 ?? ""} onChange={(e) => updateEditingItemField("mpn6", e.target.value)} placeholder="MPN 6" />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 7 / MPN 7</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input value={editingItem?.make7 ?? ""} onChange={(e) => updateEditingItemField("make7", e.target.value)} placeholder="Make 7" />
                      <Input value={editingItem?.mpn7 ?? ""} onChange={(e) => updateEditingItemField("mpn7", e.target.value)} placeholder="MPN 7" />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <Label className="text-xs font-semibold uppercase text-gray-500">Make 8 / MPN 8</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input value={editingItem?.make8 ?? ""} onChange={(e) => updateEditingItemField("make8", e.target.value)} placeholder="Make 8" />
                      <Input value={editingItem?.mpn8 ?? ""} onChange={(e) => updateEditingItemField("mpn8", e.target.value)} placeholder="MPN 8" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-remarks">Remarks</Label>
                    <Input
                      id="edit-remarks"
                      value={editingItem?.remarks ?? ""}
                      onChange={(e) => updateEditingItemField("remarks", e.target.value)}
                      placeholder="Remarks"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-action">Action</Label>
                    <Input
                      id="edit-action"
                      value={editingItem?.action ?? ""}
                      onChange={(e) => updateEditingItemField("action", e.target.value)}
                      placeholder="Action"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                  <Button type="submit" className={`${btnPrimary}`} disabled={!editingItemId}>
                    Save Changes
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* Pagination Controls */}
          {items.length > pageSize && (
            <div className="flex items-center justify-between mt-4 px-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Rows per page:</Label>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className={`${btnSecondary} px-3 py-1 text-sm`}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-700">
                  Page {currentPage} of {totalPages} ({items.length} total items)
                </span>
                <Button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className={`${btnSecondary} px-3 py-1 text-sm`}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // TRASH VIEW
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-navy mb-4">Trash Bin ({trashItems.length})</h2>

          {trashItems.length > 0 && (
            <>
              {/* Filter toolbar */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <Input
                    value={trashSearch}
                    onChange={(e) => setTrashSearch(e.target.value)}
                    placeholder="Filter trash by feeder, part number, description, MPN..."
                    className="pl-9"
                  />
                </div>
                <span className="text-sm text-gray-500">
                  {filteredTrashItems.length} of {trashItems.length} item{trashItems.length === 1 ? "" : "s"}
                </span>
              </div>

              {/* Bulk action bar */}
              {selectedTrashIds.size > 0 ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                  <span className="text-sm font-semibold text-orange-800">
                    {selectedTrashIds.size} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => bulkTrashAction("restore")} disabled={isBulkTrashProcessing} className={`${btnRestore} px-4 py-2 rounded-lg`}>
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Restore Selected
                    </Button>
                    <Button onClick={() => setBulkPermanentConfirmOpen(true)} disabled={isBulkTrashProcessing} className={`${btnDanger} px-4 py-2 rounded-lg`}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Permanently
                    </Button>
                    <Button variant="outline" onClick={clearTrashSelection} disabled={isBulkTrashProcessing} className="px-4 py-2 rounded-lg">
                      Clear
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mb-4 flex items-center gap-2">
                  <Checkbox
                    checked={allTrashSelected}
                    onCheckedChange={toggleSelectAllTrash}
                    aria-label="Select all in trash"
                  />
                  <span className="text-sm text-gray-600">Select all</span>
                </div>
              )}
            </>
          )}

          {trashItems.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Trash is empty</p>
          ) : filteredTrashItems.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No items match your filter</p>
          ) : (
            <div className="space-y-2">
              {filteredTrashItems.map((item) => {
                const rowId = Number(item.id);
                const isSelected = selectedTrashIds.has(rowId);
                return (
                <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg border ${isSelected ? "bg-orange-50 border-orange-200" : "bg-gray-50 border-gray-200"}`}>
                  <div className="flex items-center gap-3 flex-1">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelectTrashItem(rowId)}
                      aria-label={`Select trashed item ${item.feederNumber ?? rowId}`}
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-gray-700">{item.feederNumber} - {(item.ucalIntPn || item.internalPartNumber || item.partNumber || item.rdeplyPartNo || item.internalId) || item.description}</p>
                      <p className="text-xs text-gray-500">Deleted: {item.deletedAt}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => restoreItem(Number(item.id))}
                      className={`${btnRestore} px-3 py-2 rounded-lg`}
                    >
                      <RotateCcw className="w-4 h-4 mr-1" />
                      Restore
                    </Button>
                    <Button
                      onClick={() => setShowPermanentDeleteConfirm(Number(item.id))}
                      className={`${btnDanger} px-3 py-2 rounded-lg`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* EDIT MODE: ADD NEW ITEM DIALOG */}
      <Dialog
        open={addItemDialogOpen && isEditMode && !showTrash}
        onOpenChange={setAddItemDialogOpen}
      >
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>Add New Item</DialogTitle>
            <DialogDescription>
              Add a new component to this BOM in a popup window, then save the item.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddItem} className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* 12 Fields - Grouped in rows */}
              <div>
                <Label>SR No</Label>
                <Input value={newItem.srNo} onChange={(e) => setNewItem({ ...newItem, srNo: e.target.value })} placeholder="Auto" />
              </div>
              <div>
                <Label>Feeder # *</Label>
                <Input value={newItem.feederNumber} onChange={(e) => setNewItem({ ...newItem, feederNumber: e.target.value })} required />
              </div>
              <div>
                <Label>UCAL Int PN</Label>
                <Input value={newItem.ucalIntPn} onChange={(e) => setNewItem({ ...newItem, ucalIntPn: e.target.value })} />
              </div>
              <div>
                <Label>QTY *</Label>
                <Input type="number" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })} required />
              </div>
              <div>
                <Label>REF</Label>
                <Input value={newItem.reference} onChange={(e) => setNewItem({ ...newItem, reference: e.target.value })} />
              </div>
              <div>
                <Label>DESC</Label>
                <Input value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
              </div>
              <div>
                <Label>PKG</Label>
                <Input value={newItem.package} onChange={(e) => setNewItem({ ...newItem, package: e.target.value })} />
              </div>
              {/* Manufacturers */}
              <div>
                <Label>Make 1</Label>
                <Input value={newItem.make1} onChange={(e) => setNewItem({ ...newItem, make1: e.target.value })} />
              </div>
              <div>
                <Label>MPN 1</Label>
                <Input value={newItem.mpn1} onChange={(e) => setNewItem({ ...newItem, mpn1: e.target.value })} />
              </div>
              <div>
                <Label>Make 2</Label>
                <Input value={newItem.make2} onChange={(e) => setNewItem({ ...newItem, make2: e.target.value })} />
              </div>
              <div>
                <Label>MPN 2</Label>
                <Input value={newItem.mpn2} onChange={(e) => setNewItem({ ...newItem, mpn2: e.target.value })} />
              </div>
              <div>
                <Label>Make 3</Label>
                <Input value={newItem.make3} onChange={(e) => setNewItem({ ...newItem, make3: e.target.value })} />
              </div>
              <div>
                <Label>MPN 3</Label>
                <Input value={newItem.mpn3} onChange={(e) => setNewItem({ ...newItem, mpn3: e.target.value })} />
              </div>
              <div>
                <Label>Make 4</Label>
                <Input value={newItem.make4} onChange={(e) => setNewItem({ ...newItem, make4: e.target.value })} />
              </div>
              <div>
                <Label>MPN 4</Label>
                <Input value={newItem.mpn4} onChange={(e) => setNewItem({ ...newItem, mpn4: e.target.value })} />
              </div>
              <div>
                <Label>Make 5</Label>
                <Input value={newItem.make5} onChange={(e) => setNewItem({ ...newItem, make5: e.target.value })} />
              </div>
              <div>
                <Label>MPN 5</Label>
                <Input value={newItem.mpn5} onChange={(e) => setNewItem({ ...newItem, mpn5: e.target.value })} />
              </div>
              <div>
                <Label>Make 6</Label>
                <Input value={newItem.make6} onChange={(e) => setNewItem({ ...newItem, make6: e.target.value })} />
              </div>
              <div>
                <Label>MPN 6</Label>
                <Input value={newItem.mpn6} onChange={(e) => setNewItem({ ...newItem, mpn6: e.target.value })} />
              </div>
              <div>
                <Label>Make 7</Label>
                <Input value={newItem.make7} onChange={(e) => setNewItem({ ...newItem, make7: e.target.value })} />
              </div>
              <div>
                <Label>MPN 7</Label>
                <Input value={newItem.mpn7} onChange={(e) => setNewItem({ ...newItem, mpn7: e.target.value })} />
              </div>
              <div>
                <Label>Make 8</Label>
                <Input value={newItem.make8} onChange={(e) => setNewItem({ ...newItem, make8: e.target.value })} />
              </div>
              <div>
                <Label>MPN 8</Label>
                <Input value={newItem.mpn8} onChange={(e) => setNewItem({ ...newItem, mpn8: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Remarks</Label>
                <Input value={newItem.remarks} onChange={(e) => setNewItem({ ...newItem, remarks: e.target.value })} />
              </div>
              <div>
                <Label>Action</Label>
                <Input value={newItem.action} onChange={(e) => setNewItem({ ...newItem, action: e.target.value })} placeholder="e.g., DNP, Active" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setAddItemDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className={`${btnPrimary}`}>
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION DIALOGS */}
      {bulkDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="font-bold text-lg">Move {selectedItemIds.size} item{selectedItemIds.size === 1 ? "" : "s"} to Trash?</h3>
            </div>
            <p className="text-gray-600 mb-6">The selected items can be restored later from the Trash bin.</p>
            <div className="flex gap-3">
              <Button onClick={() => setBulkDeleteConfirmOpen(false)} disabled={isBulkDeleting} className={`${btnSecondary} px-4 py-2 rounded-lg flex-1`}>
                Cancel
              </Button>
              <Button onClick={bulkDeleteSelected} disabled={isBulkDeleting} className={`${btnDanger} px-4 py-2 rounded-lg flex-1`}>
                {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Move to Trash"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {bulkPermanentConfirmOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="font-bold text-lg text-red-600">Permanently delete {selectedTrashIds.size} item{selectedTrashIds.size === 1 ? "" : "s"}?</h3>
            </div>
            <p className="text-gray-600 mb-6">This action cannot be undone. The selected items will be permanently deleted.</p>
            <div className="flex gap-3">
              <Button onClick={() => setBulkPermanentConfirmOpen(false)} disabled={isBulkTrashProcessing} className={`${btnSecondary} px-4 py-2 rounded-lg flex-1`}>
                Cancel
              </Button>
              <Button onClick={() => bulkTrashAction("permanent")} disabled={isBulkTrashProcessing} className={`${btnDanger} px-4 py-2 rounded-lg flex-1`}>
                {isBulkTrashProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Permanently Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="font-bold text-lg">Move to Trash?</h3>
            </div>
            <p className="text-gray-600 mb-6">This item can be restored later from the Trash bin.</p>
            <div className="flex gap-3">
              <Button onClick={() => setShowDeleteConfirm(null)} className={`${btnSecondary} px-4 py-2 rounded-lg flex-1`}>
                Cancel
              </Button>
              <Button onClick={() => deleteItem(showDeleteConfirm)} className={`${btnDanger} px-4 py-2 rounded-lg flex-1`}>
                Move to Trash
              </Button>
            </div>
          </div>
        </div>
      )}

      {showPermanentDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h3 className="font-bold text-lg text-red-600">Permanently Delete?</h3>
            </div>
            <p className="text-gray-600 mb-6">This action cannot be undone. The item will be permanently deleted.</p>
            <div className="flex gap-3">
              <Button onClick={() => setShowPermanentDeleteConfirm(null)} className={`${btnSecondary} px-4 py-2 rounded-lg flex-1`}>
                Cancel
              </Button>
              <Button onClick={() => permanentlyDeleteItem(showPermanentDeleteConfirm)} className={`${btnDanger} px-4 py-2 rounded-lg flex-1`}>
                Permanently Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* REVISION MODAL */}
      {showRevisionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md shadow-xl">
            <h3 className="font-bold text-lg mb-4">Create New Revision</h3>
            <div className="space-y-4">
              <div>
                <Label>Revision Label *</Label>
                <Input
                  value={revisionForm.label}
                  onChange={(e) => setRevisionForm({ ...revisionForm, label: e.target.value })}
                  placeholder="e.g., Rev B, 1.1"
                  required
                />
              </div>
              <div>
                <Label>Revision Notes</Label>
                <textarea
                  value={revisionForm.notes}
                  onChange={(e) => setRevisionForm({ ...revisionForm, notes: e.target.value })}
                  placeholder="Optional notes about this revision"
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                  rows={3}
                />
              </div>
              <div>
                <Label>Copy Items From</Label>
                <select
                  value={revisionForm.sourceBomId || String(latestRevision?.id || bomId)}
                  onChange={(e) => setRevisionForm({ ...revisionForm, sourceBomId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm bg-white"
                >
                  {revisions.map((rev) => (
                    <option key={rev.id} value={String(rev.id)}>
                      {(rev.revisionLabel || `BOM #${rev.id}`) + (rev.isLatest ? " (Latest)" : "")}
                    </option>
                  ))}
                  {!revisions.some((rev) => Number(rev.id) === Number(bomId)) && (
                    <option value={String(bomId)}>
                      {`Current BOM #${bomId}`}
                    </option>
                  )}
                </select>
              </div>
              <p className="text-xs text-gray-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
                By default, items are copied from the latest revision. You can change the source revision before creating.
              </p>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={() => setShowRevisionModal(false)} className={`${btnSecondary} px-4 py-2 rounded-lg flex-1`}>
                Cancel
              </Button>
              <Button
                onClick={createRevision}
                disabled={isCreatingRevision}
                className={`${btnPrimary} px-4 py-2 rounded-lg flex-1`}
              >
                {isCreatingRevision ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                Create Revision
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit BOM Details</DialogTitle>
            <DialogDescription>Update the BOM header. Changes require your password to save.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={detailForm.name} onChange={(e) => setDetailForm({ ...detailForm, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Version</Label>
              <Input value={detailForm.version} onChange={(e) => setDetailForm({ ...detailForm, version: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Product</Label>
              <Input value={detailForm.product} onChange={(e) => setDetailForm({ ...detailForm, product: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Customer</Label>
              <Input value={detailForm.customer} onChange={(e) => setDetailForm({ ...detailForm, customer: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Description</Label>
              <Input value={detailForm.description} onChange={(e) => setDetailForm({ ...detailForm, description: e.target.value })} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setDetailDialogOpen(false)} className={`${btnSecondary} px-4 py-2 rounded-lg`}>
              Cancel
            </Button>
            <Button
              onClick={() => setDetailConfirmOpen(true)}
              disabled={isSavingDetails}
              className={`${btnPrimary} px-4 py-2 rounded-lg`}
            >
              {isSavingDetails ? "Saving..." : "Save Details"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PasswordConfirmModal
        open={detailConfirmOpen}
        onOpenChange={setDetailConfirmOpen}
        title="Save BOM Details?"
        description={
          <>
            Update details for <span className="font-semibold">{detailForm.name || "this BOM"}</span>. Enter your password to confirm.
          </>
        }
        confirmLabel="Save Details"
        onConfirmed={saveDetails}
      />
    </div>
  );
}
