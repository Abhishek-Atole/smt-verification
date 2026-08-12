import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Eye,
  Edit2,
  Copy,
  Archive,
  Trash2,
  MoreVertical,
  History,
  BadgeCheck,
  Layers3,
  Package,
  ChevronRight,
} from "lucide-react";

export function BomCard({ bom, onDelete }: { bom: any; onDelete: (bom: any) => void }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const status = typeof bom.status === "string" ? bom.status.toUpperCase() : "ACTIVE";
  const statusBadgeColor = {
    ACTIVE: "bg-green-100 text-green-800",
    DRAFT: "bg-amber-100 text-amber-800",
    ARCHIVED: "bg-gray-100 text-gray-800",
  }[status] || "bg-blue-100 text-blue-800";

  const statItems = [
    { label: "Items", value: bom.itemCount || 0, icon: Package },
    { label: "Makes", value: bom.makesCount || 0, icon: Layers3 },
    { label: "Suppliers", value: bom.suppliersCount || 0, icon: BadgeCheck },
  ];

  const metadata = [
    bom.product ? { label: "Product", value: bom.product } : null,
    bom.customer ? { label: "Customer", value: bom.customer } : null,
    bom.version ? { label: "Version", value: bom.version } : null,
    bom.createdAt
      ? {
          label: "Created",
          value: format(new Date(bom.createdAt), "MMM dd, yyyy"),
        }
      : null,
    { label: "Revision", value: bom.revisionLabel || "Original" },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const handleDelete = () => {
    onDelete(bom);
    setShowDeleteConfirm(false);
  };

  return (
    <>
      <div className="group relative overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-6 shadow-sm ring-1 ring-black/5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-amber-400 to-emerald-400" />
        <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-sky-500/10 blur-2xl transition-transform duration-500 group-hover:scale-125" />
        <div className="absolute -bottom-12 -left-12 h-32 w-32 rounded-full bg-amber-400/10 blur-2xl transition-transform duration-500 group-hover:scale-125" />

        <div className="relative">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusBadgeColor}`}>
                {status}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700">
                <History className="h-3.5 w-3.5" />
                Rev {bom.revisionLabel || "Original"}
              </span>
              {bom.isLatest && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Latest
                </span>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="rounded-full border border-border/60 bg-background/80 shadow-sm hover:bg-accent hover:text-accent-foreground">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => { setLocation(`/bom/${bom.id}`); toast({ title: "Opening", description: `Viewing BOM: ${bom.name}` }); }}>
                  <Eye className="w-4 h-4 mr-2" /> View Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setLocation(`/bom/${bom.id}?mode=edit`); toast({ title: "Opening", description: `Editing BOM: ${bom.name}` }); }}>
                  <Edit2 className="w-4 h-4 mr-2" /> Edit BOM
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => toast({ title: "Duplicate", description: "Duplicate feature coming soon" })}>
                  <Copy className="w-4 h-4 mr-2" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast({ title: "Archive", description: "Archive feature coming soon" })}>
                  <Archive className="w-4 h-4 mr-2" /> Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="text-red-600 focus:text-red-600">
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-bold tracking-tight text-navy transition-colors group-hover:text-sky-700">
              {bom.name}
            </h3>
            {bom.description ? (
              <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{bom.description}</p>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground/80">No description provided for this BOM.</p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {metadata.map((item) => (
              <div key={item.label} className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2.5 shadow-sm">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-sm font-medium text-foreground">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 rounded-2xl border border-border/70 bg-gradient-to-b from-muted/70 to-background p-3">
            {statItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-xl bg-background/90 p-3 text-center shadow-sm">
                  <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="text-2xl font-bold text-navy">{item.value}</div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="w-full min-w-0 cursor-pointer border-2 border-navy bg-white font-semibold text-navy shadow-sm transition-all hover:border-sky-600 hover:bg-sky-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLocation(`/bom/${bom.id}?mode=view`);
                toast({ title: "View Mode", description: `Viewing BOM: ${bom.name}` });
              }}
            >
              <Eye className="w-4 h-4 mr-2" />
              View Details
            </Button>
            <Button
              variant="default"
              className="w-full min-w-0 cursor-pointer bg-navy font-semibold text-black shadow-sm transition-all hover:bg-sky-800"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setLocation(`/bom/${bom.id}?mode=edit`);
                toast({ title: "Edit Mode", description: `Editing BOM: ${bom.name}` });
              }}
            >
              <Edit2 className="w-4 h-4 mr-2" />
              Edit BOM
              <ChevronRight className="ml-1 w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              className="w-full min-w-0 cursor-pointer border-2 border-red-200 bg-red-50 font-semibold text-red-700 shadow-sm transition-all hover:border-red-300 hover:bg-red-100 hover:text-red-800 sm:col-span-2"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete BOM?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <span className="font-semibold">{bom.name}</span>? It will be moved to trash and recoverable for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Move to Trash
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
