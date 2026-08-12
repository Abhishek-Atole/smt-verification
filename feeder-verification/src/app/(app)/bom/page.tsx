"use client";

import { useEffect, useState } from "react";
import { BOMTable } from "@/components/bom/BOMTable";

interface BomApiRow {
  id: string;
  bomNumber: string;
  revision: string;
  customerName: string | null;
  _count: { lineItems: number };
}

export default function BomPage() {
  const [rows, setRows] = useState<BomApiRow[]>([]);

  useEffect(() => {
    fetch("/api/bom")
      .then((res) => res.json())
      .then((data) => setRows(data.boms ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-neutral-900">BOM Library</h1>
      <BOMTable
        rows={rows.map((row) => ({
          id: row.id,
          bomNumber: row.bomNumber,
          revision: row.revision,
          customerName: row.customerName,
          lineCount: row._count.lineItems,
        }))}
      />
    </div>
  );
}
