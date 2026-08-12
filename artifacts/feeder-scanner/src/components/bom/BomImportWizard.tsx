import { useState, useRef } from "react";
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
import Papa from "papaparse";
import { Upload, Download, Check, AlertCircle } from "lucide-react";

function readCell(row: Record<string, unknown>, aliases: string[]): string {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, ""));

  for (const key of Object.keys(row)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalizedAliases.includes(normalizedKey)) continue;

    const value = row[key];
    return value == null ? "" : String(value).trim();
  }

  return "";
}

function getMissingRequiredFields(row: Record<string, unknown>) {
  const missingFields: string[] = [];

  if (!readCell(row, ["Feeder Number", "Feeder", "Feeder #", "Feeder No", "Feeder No."])) {
    missingFields.push("Feeder Number");
  }

  if (!readCell(row, ["MPN 1", "Part No 1", "Spool Part No. / MPN 1"])) {
    missingFields.push("MPN 1");
  }

  return missingFields;
}

export function BomImportWizard({ onSuccess }: { onSuccess: (bomId?: number) => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [bomData, setBomData] = useState({
    name: "",
    version: "",
    product: "",
    customer: "",
    description: "",
  });
  const [csvData, setCsvData] = useState<any[]>([]);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const previewRows = csvData;
  const validationIssues = csvData
    .map((row, index) => ({
      rowNumber: index + 1,
      missingFields: getMissingRequiredFields(row),
    }))
    .filter((entry) => entry.missingFields.length > 0);

  const handleBomDataChange = (field: string, value: string) => {
    setBomData(prev => ({ ...prev, [field]: value }));
  };

  const canProceedStep1 = bomData.name.trim() && bomData.version.trim();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length === 0) {
          toast({ title: "Error", description: "CSV file is empty", variant: "destructive" });
          return;
        }
        setCsvData(results.data);
        toast({ title: "Success", description: `Loaded ${results.data.length} items from CSV` });
      },
      error: (error: any) => {
        toast({ title: "Error", description: `CSV parse error: ${error.message}`, variant: "destructive" });
      },
    });
  };

  const downloadTemplate = () => {
    const headers = [
      "SR NO",
      "Feeder Number",
      "UCAL Internal Part Number",
      "Required Qty",
      "Ref Location",
      "Description",
      "Values",
      "Package",
      "Make 1",
      "MPN 1",
      "Make 2",
      "MPN 2",
      "Make 3",
      "MPN 3",
      "Remarks",
    ];
    const sampleRows = [
      [
        "1",
        "1",
        "INT-001",
        "1",
        "R1",
        "10k Resistor",
        "10kΩ",
        "0402",
        "Kemet",
        "R0402100K",
        "Yageo",
        "RC0402FR-0710KL",
        "",
        "",
        "Standard value",
      ],
      [
        "2",
        "2",
        "INT-002",
        "2",
        "U1",
        "Microcontroller",
        "",
        "SO-8",
        "Atmel",
        "ATtiny85-20PU",
        "Microchip",
        "ATTINY85-20PU",
        "",
        "",
        "Primary source",
      ],
    ];

    const csv = [headers, ...sampleRows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "BOM_Import_Template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!bomData.name.trim() || !bomData.version.trim() || csvData.length === 0) {
      toast({ title: "Error", description: "Please complete all fields and upload a CSV file", variant: "destructive" });
      return;
    }

    setIsImporting(true);
    try {
      // Create BOM
      const bomResponse = await fetch("/api/bom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: bomData.name.trim(),
          version: bomData.version.trim(),
          product: bomData.product || null,
          customer: bomData.customer || null,
          description: bomData.description || null,
        }),
      });

      if (!bomResponse.ok) throw new Error("Failed to create BOM");
      const createdBom = await bomResponse.json();

      // Map CSV rows to API format for import
      const items = csvData.map((row: Record<string, unknown>) => ({
        feederNumber: readCell(row, ["Feeder Number", "Feeder", "Feeder #", "Feeder No", "Feeder No."]),
        srNo: readCell(row, ["SR NO", "Sr No", "S.No", "Serial No"]),
        internalPartNumber: readCell(row, ["UCAL Internal Part Number", "Internal Part Number", "Internal Part No", "Part Number"]),
        requiredQty: readCell(row, ["Required Qty", "Qty", "Quantity"]) || "1",
        referenceLocation: readCell(row, ["Ref Location", "Reference Location", "Ref", "Location"]),
        description: readCell(row, ["Description", "Desc"]),
        values: readCell(row, ["Value", "Values"]),
        packageDescription: readCell(row, ["Package", "Package Description", "Package/Description"]),
        make1: readCell(row, ["Make 1", "Supplier 1", "Make/Supplier 1"]),
        mpn1: readCell(row, ["MPN 1", "Part No 1", "Spool Part No. / MPN 1"]),
        make2: readCell(row, ["Make 2", "Supplier 2", "Make/Supplier 2"]),
        mpn2: readCell(row, ["MPN 2", "Part No 2", "Spool Part No. / MPN 2"]),
        make3: readCell(row, ["Make 3", "Supplier 3", "Make/Supplier 3"]),
        mpn3: readCell(row, ["MPN 3", "Part No 3", "Spool Part No. / MPN 3"]),
        remarks: readCell(row, ["Remarks", "Remark", "Comments"]),
      }));

      const itemsResponse = await fetch(`/api/bom/${createdBom.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });

      if (!itemsResponse.ok) {
        let message = "Failed to import items";
        try {
          const body = await itemsResponse.json();
          message = body?.error || message;
        } catch {
          // Ignore JSON parse errors and keep fallback message.
        }
        throw new Error(message);
      }
      const importResult = await itemsResponse.json();

      toast({ title: "Success", description: `BOM "${bomData.name}" imported with ${importResult.imported} items${importResult.errors.length > 0 ? ` (${importResult.errors.length} skipped)` : ""}` });
      onSuccess(createdBom.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({ title: "Error", description: `Import failed: ${message}`, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8">
      {/* Step Indicator */}
      <div className="flex gap-8 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                s === step
                  ? "bg-navy text-white"
                  : s < step
                  ? "bg-green-500 text-white"
                  : "bg-gray-200 text-gray-600"
              }`}
            >
              {s < step ? <Check className="w-5 h-5" /> : s}
            </div>
            <div>
              <div className="font-semibold text-navy">
                {s === 1 ? "BOM Details" : s === 2 ? "Upload CSV" : "Review & Import"}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* STEP 1: BOM DETAILS */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              BOM Name *
            </label>
            <Input
              placeholder="e.g., SMT Assembly Rev 1"
              value={bomData.name}
              onChange={(e) => handleBomDataChange("name", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Version *
            </label>
            <Input
              placeholder="e.g., v1.0"
              value={bomData.version}
              onChange={(e) => handleBomDataChange("version", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Product
            </label>
            <Input
              placeholder="Product name (optional)"
              value={bomData.product}
              onChange={(e) => handleBomDataChange("product", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Customer
            </label>
            <Input
              placeholder="Customer name (optional)"
              value={bomData.customer}
              onChange={(e) => handleBomDataChange("customer", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Description
            </label>
            <Input
              placeholder="Brief description (optional)"
              value={bomData.description}
              onChange={(e) => handleBomDataChange("description", e.target.value)}
            />
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <Button variant="outline" className="font-semibold px-5 py-2.5">Cancel</Button>
            <Button
              className="bg-white text-navy border-navy border-2 hover:bg-gray-50 font-semibold shadow-md hover:shadow-lg transition-all duration-200 px-5 py-2.5"
              onClick={() => setStep(2)}
              disabled={!canProceedStep1}
            >
              Next: Upload CSV
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: UPLOAD CSV */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-blue-900">CSV Format Guide</div>
                <div className="text-sm text-blue-800">
                  Required columns: Feeder Number, Description, Package, MPN 1
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              className="mt-2 bg-white text-navy border-navy border-2 hover:bg-gray-50"
            >
              <Download className="w-4 h-4 mr-2" /> Download Template
            </Button>
          </div>

          {/* File Upload */}
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-navy hover:bg-blue-50 transition"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <div className="font-semibold text-gray-700">Click to select or drag & drop</div>
            <div className="text-sm text-gray-600">CSV file format only</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {fileName && (
            <div className="bg-green-50 border border-green-200 p-3 rounded-lg">
              <div className="font-semibold text-green-900">✓ File uploaded: {fileName}</div>
              <div className="text-sm text-green-800">{csvData.length} items ready</div>
            </div>
          )}

          {/* CSV Preview */}
          {csvData.length > 0 && (
            <div>
              <div className="font-semibold text-gray-700 mb-3">Preview</div>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      {Object.keys(csvData[0]).map(key => (
                        <th key={key} className="px-3 py-2 text-left font-semibold text-gray-700">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvData.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        {Object.values(row).map((val, i) => (
                          <td key={i} className="px-3 py-2 text-gray-700">
                            {String(val).substring(0, 50)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4">
            <Button variant="outline" onClick={() => setStep(1)} className="font-semibold px-5 py-2.5">
              Back
            </Button>
            <Button
              className="bg-white text-navy border-navy border-2 hover:bg-gray-50 font-semibold shadow-md hover:shadow-lg transition-all duration-200 px-5 py-2.5"
              onClick={() => setStep(3)}
              disabled={csvData.length === 0}
            >
              Next: Review & Import
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: REVIEW & IMPORT */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-semibold text-gray-600">BOM Name</div>
              <div className="text-lg font-bold text-navy">{bomData.name}</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-600">Version</div>
              <div className="text-lg font-bold text-navy">{bomData.version}</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-600">Product</div>
              <div className="text-lg font-bold text-navy">{bomData.product || "—"}</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-600">Customer</div>
              <div className="text-lg font-bold text-navy">{bomData.customer || "—"}</div>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="font-semibold text-gray-700 mb-2">Components Summary</div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-2xl font-bold text-navy mb-1">{csvData.length}</div>
              <div className="text-sm text-gray-600">Components will be imported</div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {csvData.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-gray-700">Preview Window 1: Raw CSV</div>
                  <div className="text-xs text-gray-500">First 5 rows</div>
                </div>
                <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        {Object.keys(csvData[0]).map((key) => (
                          <th key={key} className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                          {Object.values(row).map((val, i) => (
                            <td key={i} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                              {String(val).substring(0, 50)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-gray-700">Preview Window 2: Validation Check</div>
                <div className="text-xs text-gray-500">
                  {validationIssues.length} issue{validationIssues.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg bg-white p-4">
                {validationIssues.length > 0 ? (
                  <div className="space-y-3">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <div className="flex gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="font-semibold text-amber-900">Validation Warnings</div>
                          <div className="text-sm text-amber-800">
                            Some rows have missing Feeder Number or MPN 1 — review before importing
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-amber-200">
                      <table className="w-full text-sm">
                        <thead className="bg-amber-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-amber-900">Row</th>
                            <th className="px-3 py-2 text-left font-semibold text-amber-900">Missing Fields</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validationIssues.map((issue, idx) => (
                            <tr key={`${issue.rowNumber}-${idx}`} className={idx % 2 === 0 ? "bg-white" : "bg-amber-50/60"}>
                              <td className="px-3 py-2 text-gray-700">Row {issue.rowNumber}</td>
                              <td className="px-3 py-2 text-amber-900">{issue.missingFields.join(", ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 items-start">
                    <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-green-900">Validation check passed</div>
                      <div className="text-sm text-green-800">All rows contain Feeder Number and MPN 1.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <Button variant="outline" onClick={() => setStep(2)} className="font-semibold px-5 py-2.5">
              Back
            </Button>
            <Button
              className="bg-white text-navy border-navy border-2 hover:bg-gray-50 font-semibold shadow-md hover:shadow-lg transition-all duration-200 px-5 py-2.5"
              onClick={handleImport}
              disabled={isImporting}
            >
              {isImporting ? "Importing..." : "✓ Import BOM"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
