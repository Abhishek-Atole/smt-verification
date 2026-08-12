interface BomRow {
  id: string;
  bomNumber: string;
  revision: string;
  customerName: string | null;
  lineCount: number;
}

export function BOMTable({ rows }: { rows: BomRow[] }) {
  return (
    <div className="overflow-auto rounded-lg border border-neutral-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-3 py-2">BOM Number</th>
            <th className="px-3 py-2">Revision</th>
            <th className="px-3 py-2">Customer</th>
            <th className="px-3 py-2">Line Items</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-neutral-200">
              <td className="px-3 py-2">{row.bomNumber}</td>
              <td className="px-3 py-2">{row.revision}</td>
              <td className="px-3 py-2">{row.customerName ?? "-"}</td>
              <td className="px-3 py-2">{row.lineCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
