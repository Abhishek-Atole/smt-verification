import { useState } from "react";
import { useRoute } from "wouter";
import { useGetBom } from "@workspace/api-client-react";
import { getGetBomQueryKey } from "@workspace/api-client-react";
import {
  Loader2, Download, FileText, Tags, Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable"; import { logger } from "../lib/logger";
const NAVY: [number, number, number] = [0, 51, 102];
const WHITE: [number, number, number] = [255, 255, 255];
const LIGHT_ROW: [number, number, number] = [220, 230, 242];

export default function BomReport() {
  const [, params] = useRoute("/bom/:id/report");
  const bomId = Number(params?.id);

  const { data: bom, isLoading } = useGetBom(bomId, {
    query: { enabled: !!bomId, queryKey: getGetBomQueryKey(bomId) },
  });

  const [selectedFormat, setSelectedFormat] = useState<"pdf" | "xlsx" | null>(null);

  if (isLoading || !bom) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // Generate report data
  const reportData = {
    id: bom.id,
    name: bom.name,
    description: bom.description,
    createdAt: bom.createdAt,
    generatedAt: new Date(),
    totalItems: bom.items?.length || 0,
    summary: {
      totalComponents: bom.items?.length || 0,
      uniqueManufacturers: new Set(
        (bom.items || []).map((i: any) => i.manufacturer).filter(Boolean)
      ).size,
      uniqueSuppliers: new Set(
        (bom.items || []).map((i: any) => i.supplier1).filter(Boolean)
      ).size,
      totalQuantity: (bom.items || []).reduce((sum: number, i: any) => sum + (i.quantity || 1), 0),
    },
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    
    // Header
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, 210, 35, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(20);
    doc.text("BOM Report", 15, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${format(reportData.generatedAt, "PPP")}`, 15, 28);

    // BOM Info
    let yPos = 45;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`BOM: ${reportData.name}`, 15, yPos);
    yPos += 7;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Description: ${reportData.description || "N/A"}`, 15, yPos);
    yPos += 7;
    doc.text(
      `Created: ${format(new Date(reportData.createdAt), "PPP p")}`,
      15,
      yPos
    );
    yPos += 12;

    // Summary boxes
    doc.setFillColor(220, 230, 242);
    const summaryBoxes = [
      { label: "Total Components", value: reportData.summary.totalComponents },
      { label: "Unique Manufacturers", value: reportData.summary.uniqueManufacturers },
      { label: "Unique Suppliers", value: reportData.summary.uniqueSuppliers },
      { label: "Total Quantity", value: reportData.summary.totalQuantity },
    ];

    let xPos = 15;
    summaryBoxes.forEach((box) => {
      doc.rect(xPos, yPos, 40, 15, "F");
      doc.setFillColor(...NAVY);
      doc.rect(xPos, yPos, 40, 5, "F");
      doc.setTextColor(...WHITE);
      doc.setFontSize(8);
      doc.text(box.label, xPos + 2, yPos + 3);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(String(box.value), xPos + 20 - doc.getTextWidth(String(box.value)) / 2, yPos + 12);
      xPos += 45;
    });

    yPos += 25;

    // Items table
    const tableData = (bom.items || []).map((item: any) => [
      item.feederNumber || "—",
      item.mpn || item.partNumber || "—",
      item.manufacturer || "—",
      item.packageSize || "—",
      String(item.quantity || 1),
      item.description || "—",
    ]);

    (autoTable as any)(doc, {
      head: [["Feeder", "MPN/Part", "Manufacturer", "Package", "Qty", "Description"]],
      body: tableData,
      startY: yPos,
      headStyles: {
        fillColor: NAVY,
        textColor: WHITE,
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: LIGHT_ROW,
      },
      margin: { left: 15, right: 15 },
      didDrawPage: function (data: any) {
        // Footer
        const pageSize = doc.internal.pageSize;
        const pageHeight = pageSize.getHeight();
        const footerY = pageHeight - 10;
        doc.setFontSize(9);
        doc.setTextColor(128, 128, 128);
        doc.text(
          `Page ${data.pageNumber}`,
          pageSize.getWidth() / 2 - doc.getTextWidth(`Page ${data.pageNumber}`) / 2,
          footerY
        );
      },
    });

    doc.save(`BOM-${reportData.id}-Report.pdf`);
  };

  // Excel export is handled by backend API for security
  // Use /api/reports/export/bom endpoint instead of client-side generation
  const handleDownloadXLSX = async () => {
    try {
      const response = await fetch(`/api/reports/export/bom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "xlsx",
          bomId: bom.id,
          title: bom.name,
        }),
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BOM-${reportData.id}-Report.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      logger.error({ error }, "Excel export error:");
      alert("Failed to export Excel file");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{reportData.name}</h1>
        <p className="text-gray-600">{reportData.description}</p>
        <p className="text-sm text-gray-500">
          Report generated on {format(reportData.generatedAt, "PPpp")}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Package className="w-4 h-4" />
              Total Components
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{reportData.summary.totalComponents}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Tags className="w-4 h-4" />
              Unique Manufacturers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{reportData.summary.uniqueManufacturers}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Unique Suppliers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{reportData.summary.uniqueSuppliers}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Quantity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{reportData.summary.totalQuantity}</p>
          </CardContent>
        </Card>
      </div>

      {/* Download Actions */}
      <div className="flex gap-3">
        <Button onClick={handleDownloadPDF} className="gap-2">
          <Download className="w-4 h-4" />
          Download PDF
        </Button>
        <Button onClick={handleDownloadXLSX} variant="outline" className="gap-2">
          <Download className="w-4 h-4" />
          Download Excel
        </Button>
      </div>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>BOM Items</CardTitle>
          <CardDescription>{reportData.summary.totalComponents} items</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Feeder</TableCell>
                  <TableCell>MPN</TableCell>
                  <TableCell>Part Number</TableCell>
                  <TableCell>Manufacturer</TableCell>
                  <TableCell>Package</TableCell>
                  <TableCell>Qty</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Supplier</TableCell>
                  <TableCell>Location</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(bom.items || []).map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.feederNumber || "—"}</TableCell>
                    <TableCell>{item.mpn || "—"}</TableCell>
                    <TableCell>{item.partNumber || "—"}</TableCell>
                    <TableCell>{item.manufacturer || "—"}</TableCell>
                    <TableCell>{item.packageSize || "—"}</TableCell>
                    <TableCell>{item.quantity || 1}</TableCell>
                    <TableCell>{item.description || "—"}</TableCell>
                    <TableCell>{item.supplier1 || "—"}</TableCell>
                    <TableCell>{item.location || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
