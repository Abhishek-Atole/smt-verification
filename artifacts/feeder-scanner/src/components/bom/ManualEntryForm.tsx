import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { X, Plus } from "lucide-react";

export function ManualEntryForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [bomForm, setBomForm] = useState({
    name: "",
    description: "",
    revisionLabel: "",
    revisionNotes: "",
  });

  const [items, setItems] = useState<any[]>([]);
  const [newItem, setNewItem] = useState({
    feederNumber: "",
    srNo: "",
    referenceLocation: "",
    description: "",
    values: "",
    packageDescription: "",
    requiredQty: "1",
    internalPartNumber: "",
    make1: "",
    mpn1: "",
    make2: "",
    mpn2: "",
    make3: "",
    mpn3: "",
    remarks: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const packageOptions = ["0201", "0402", "0603", "0805", "1206", "SO-8", "SOT-23", "Other"];

  const handleBomFormChange = (field: string, value: string) => {
    setBomForm(prev => ({ ...prev, [field]: value }));
  };

  const handleNewItemChange = (field: string, value: string) => {
    setNewItem(prev => ({ ...prev, [field]: value }));
  };

  const addItem = () => {
    if (!newItem.feederNumber.trim() || !newItem.description.trim() || !newItem.packageDescription.trim()) {
      toast({ title: "Error", description: "Feeder Number, Description, and Package are required", variant: "destructive" });
      return;
    }
    setItems(prev => [...prev, { ...newItem, id: Date.now() }]);
    setNewItem({
      feederNumber: "",
      srNo: "",
      referenceLocation: "",
      description: "",
      values: "",
      packageDescription: "",
      requiredQty: "1",
      internalPartNumber: "",
      make1: "",
      mpn1: "",
      make2: "",
      mpn2: "",
      make3: "",
      mpn3: "",
      remarks: "",
    });
    toast({ title: "Success", description: "Component added" });
  };

  const removeItem = (id: number) => {
    setItems(prev => prev.filter(item => item.id !== id));
    toast({ title: "Success", description: "Component removed" });
  };

  const handleSave = async (asDraft: boolean) => {
    if (!bomForm.name.trim()) {
      toast({ title: "Error", description: "BOM Name is required", variant: "destructive" });
      return;
    }

    if (items.length === 0) {
      toast({ title: "Error", description: "Add at least one component before saving", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      // Create BOM
      const bomResponse = await fetch("/api/bom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bomForm.name,
          description: bomForm.description || null,
          revisionLabel: bomForm.revisionLabel || null,
          revisionNotes: bomForm.revisionNotes || null,
        }),
      });

      if (!bomResponse.ok) throw new Error("Failed to create BOM");
      const createdBom = await bomResponse.json();

      // Add items with correct field names
      const bomItems = items.map(item => ({
        feederNumber: item.feederNumber,
        srNo: item.srNo,
        referenceLocation: item.referenceLocation,
        description: item.description,
        values: item.values,
        packageDescription: item.packageDescription,
        internalPartNumber: item.internalPartNumber,
        requiredQty: parseInt(item.requiredQty) || 1,
        make1: item.make1,
        mpn1: item.mpn1,
        make2: item.make2,
        mpn2: item.mpn2,
        make3: item.make3,
        mpn3: item.mpn3,
        remarks: item.remarks,
      }));

      const itemsResponse = await fetch(`/api/bom/${createdBom.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bomItems),
      });

      if (!itemsResponse.ok) throw new Error("Failed to add items");

      toast({ title: "Success", description: `BOM "${bomForm.name}" saved successfully` });
      onSuccess();
    } catch (error: any) {
      toast({ title: "Error", description: `Failed to save: ${error.message}`, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* BOM Header Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-navy mb-4">BOM Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Name *</label>
            <Input
              placeholder="e.g., SMT Assembly"
              value={bomForm.name}
              onChange={(e) => handleBomFormChange("name", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Revision Label</label>
            <Input
              placeholder="e.g., Rev A"
              value={bomForm.revisionLabel}
              onChange={(e) => handleBomFormChange("revisionLabel", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
            <Input
              placeholder="Brief description"
              value={bomForm.description}
              onChange={(e) => handleBomFormChange("description", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Revision Notes</label>
            <Input
              placeholder="Notes for this BOM revision"
              value={bomForm.revisionNotes}
              onChange={(e) => handleBomFormChange("revisionNotes", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Add Component Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-navy mb-4">Add Components</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">SR No</label>
            <Input
              placeholder="Serial no"
              value={newItem.srNo}
              onChange={(e) => handleNewItemChange("srNo", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Feeder *</label>
            <Input
              placeholder="1"
              value={newItem.feederNumber}
              onChange={(e) => handleNewItemChange("feederNumber", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Ref Loc</label>
            <Input
              placeholder="R1"
              value={newItem.referenceLocation}
              onChange={(e) => handleNewItemChange("referenceLocation", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Desc *</label>
            <Input
              placeholder="10k Resistor"
              value={newItem.description}
              onChange={(e) => handleNewItemChange("description", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Values</label>
            <Input
              placeholder="10kΩ"
              value={newItem.values}
              onChange={(e) => handleNewItemChange("values", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Pkg *</label>
            <Select value={newItem.packageDescription} onValueChange={(val) => handleNewItemChange("packageDescription", val)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {packageOptions.map(pkg => (
                  <SelectItem key={pkg} value={pkg}>{pkg}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Qty</label>
            <Input
              type="number"
              placeholder="1"
              value={newItem.requiredQty}
              onChange={(e) => handleNewItemChange("requiredQty", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Internal PN</label>
            <Input
              placeholder="INT-001"
              value={newItem.internalPartNumber}
              onChange={(e) => handleNewItemChange("internalPartNumber", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Make 1</label>
            <Input
              placeholder="Kemet"
              value={newItem.make1}
              onChange={(e) => handleNewItemChange("make1", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">MPN 1</label>
            <Input
              placeholder="R0402100K"
              value={newItem.mpn1}
              onChange={(e) => handleNewItemChange("mpn1", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Make 2</label>
            <Input
              placeholder="Yageo"
              value={newItem.make2}
              onChange={(e) => handleNewItemChange("make2", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">MPN 2</label>
            <Input
              placeholder="RC0402FR"
              value={newItem.mpn2}
              onChange={(e) => handleNewItemChange("mpn2", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Make 3</label>
            <Input
              placeholder="Make"
              value={newItem.make3}
              onChange={(e) => handleNewItemChange("make3", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">MPN 3</label>
            <Input
              placeholder="MPN"
              value={newItem.mpn3}
              onChange={(e) => handleNewItemChange("mpn3", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Remarks</label>
            <Input
              placeholder="Notes"
              value={newItem.remarks}
              onChange={(e) => handleNewItemChange("remarks", e.target.value)}
            />
          </div>
        </div>
        <Button
          className="w-full mt-3 bg-white text-navy border-navy border-2 hover:bg-gray-50 font-semibold shadow-md hover:shadow-lg transition-all duration-200 py-2.5"
          onClick={addItem}
        >
          <Plus className="w-5 h-5 mr-2" /> Add Component
        </Button>
      </div>

      {/* Components Table */}
      {items.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4 border-b bg-gray-50">
            <h3 className="font-bold text-gray-800">{items.length} Components Added</h3>
          </div>
          <Table>
            <TableHeader className="bg-gray-100">
              <TableRow>
                <TableHead className="text-xs font-bold text-gray-700">Feeder</TableHead>
                <TableHead className="text-xs font-bold text-gray-700">Ref</TableHead>
                <TableHead className="text-xs font-bold text-gray-700">Description</TableHead>
                <TableHead className="text-xs font-bold text-gray-700">Pkg</TableHead>
                <TableHead className="text-xs font-bold text-gray-700">MPN 1</TableHead>
                <TableHead className="text-xs font-bold text-gray-700">MPN 2</TableHead>
                <TableHead className="text-xs font-bold text-gray-700">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => (
                <TableRow key={item.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <TableCell className="text-sm font-semibold text-gray-700">{item.feederNumber}</TableCell>
                  <TableCell className="text-sm text-gray-600">{item.refLocation || "—"}</TableCell>
                  <TableCell className="text-sm text-gray-600">{item.description}</TableCell>
                  <TableCell className="text-sm text-gray-600">{item.packageType}</TableCell>
                  <TableCell className="text-sm text-blue-600 font-semibold">{item.mpn1 || "—"}</TableCell>
                  <TableCell className="text-sm text-amber-600">{item.mpn2 ? `${item.mpn2} ▲` : "—"}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-white text-navy border-navy border-2 hover:bg-gray-50"
                      onClick={() => removeItem(item.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        <Button variant="outline" className="font-semibold px-5 py-2.5">Cancel</Button>
        <Button
          variant="outline"
          onClick={() => handleSave(true)}
          disabled={isSaving}
          className="font-semibold px-5 py-2.5 border-2 hover:bg-gray-50"
        >
          Save as Draft
        </Button>
        <Button
          className="bg-white text-navy border-navy border-2 hover:bg-gray-50 font-semibold shadow-md hover:shadow-lg transition-all duration-200 px-5 py-2.5"
          onClick={() => handleSave(false)}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "✓ Save & Activate"}
        </Button>
      </div>
    </div>
  );
}
