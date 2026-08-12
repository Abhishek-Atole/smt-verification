import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getChangeoverProgress } from "@/lib/progress";
import { requireSession } from "@/lib/route-auth";

export default async function ChangeoverReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession();
  if (error || !session) notFound();

  const { id } = await params;

  const changeover = await prisma.changeover.findUnique({
    where: { id },
    select: {
      id: true,
      operatorId: true,
      status: true,
      lineNumber: true,
      shift: true,
      startedAt: true,
      completedAt: true,
      operator: { select: { name: true, employeeId: true, role: true } },
      bomHeader: { select: { bomNumber: true, revision: true, customerName: true } },
      verificationScans: {
        orderBy: { scannedAt: "asc" },
        select: {
          id: true,
          scannedMpn: true,
          scannedLotCode: true,
          matchType: true,
          isAlternate: true,
          scannedAt: true,
          lineItem: { select: { feederNumber: true, description: true } },
          alternative: { select: { make: true, mpn: true, rank: true } },
        },
      },
      spliceRecords: {
        orderBy: { splicedAt: "asc" },
        select: {
          id: true,
          oldSpoolMpn: true,
          oldSpoolLot: true,
          newSpoolMpn: true,
          newSpoolLot: true,
          splicedAt: true,
          lineItem: { select: { feederNumber: true } },
        },
      },
    },
  });

  if (!changeover) notFound();

  const canView =
    changeover.operatorId === session.user.id || ["qa", "engineer", "admin"].includes(session.user.role);

  if (!canView) notFound();

  const progress = await getChangeoverProgress(id);

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/changeover/${id}`} className="text-sm text-neutral-900 underline">
          Back to active session
        </Link>
        <p className="text-sm text-neutral-600">Use browser print to export this report.</p>
      </div>

      <header className="rounded-lg border border-neutral-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-neutral-900">Final Changeover Report</h1>
        <p className="mt-1 text-sm text-neutral-600">Changeover and splicing completion details</p>
        <div className="mt-4 grid grid-cols-1 gap-2 text-sm text-neutral-700 md:grid-cols-2">
          <p>
            <span className="font-medium">Changeover ID:</span> {changeover.id}
          </p>
          <p>
            <span className="font-medium">Status:</span> {changeover.status}
          </p>
          <p>
            <span className="font-medium">BOM:</span> {changeover.bomHeader.bomNumber} (Rev {changeover.bomHeader.revision})
          </p>
          <p>
            <span className="font-medium">Customer:</span> {changeover.bomHeader.customerName}
          </p>
          <p>
            <span className="font-medium">Operator:</span> {changeover.operator.name} ({changeover.operator.employeeId})
          </p>
          <p>
            <span className="font-medium">Line / Shift:</span> {changeover.lineNumber} / {changeover.shift}
          </p>
          <p>
            <span className="font-medium">Started:</span> {new Date(changeover.startedAt).toLocaleString()}
          </p>
          <p>
            <span className="font-medium">Completed:</span>{" "}
            {changeover.completedAt ? new Date(changeover.completedAt).toLocaleString() : "In progress"}
          </p>
          <p>
            <span className="font-medium">Verification Progress:</span> {progress.verified}/{progress.total} ({progress.percentage}%)
          </p>
          <p>
            <span className="font-medium">Splices Recorded:</span> {changeover.spliceRecords.length}
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">Changeover Verification Records</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-100 text-left text-neutral-700">
              <tr>
                <th className="px-3 py-2">Feeder</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Scanned MPN</th>
                <th className="px-3 py-2">Lot Code</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2">Alternate</th>
                <th className="px-3 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {changeover.verificationScans.map((scan) => (
                <tr key={scan.id} className="border-t border-neutral-200">
                  <td className="px-3 py-2">{scan.lineItem.feederNumber}</td>
                  <td className="px-3 py-2">{scan.lineItem.description}</td>
                  <td className="px-3 py-2">{scan.scannedMpn}</td>
                  <td className="px-3 py-2">{scan.scannedLotCode ?? "-"}</td>
                  <td className="px-3 py-2">{scan.matchType}</td>
                  <td className="px-3 py-2">{scan.isAlternate ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">{new Date(scan.scannedAt).toLocaleString()}</td>
                </tr>
              ))}
              {changeover.verificationScans.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-neutral-500">
                    No verification scans recorded.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">Splicing Records</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-100 text-left text-neutral-700">
              <tr>
                <th className="px-3 py-2">Feeder</th>
                <th className="px-3 py-2">Old Spool MPN</th>
                <th className="px-3 py-2">Old Lot</th>
                <th className="px-3 py-2">New Spool MPN</th>
                <th className="px-3 py-2">New Lot</th>
                <th className="px-3 py-2">Spliced At</th>
              </tr>
            </thead>
            <tbody>
              {changeover.spliceRecords.map((splice) => (
                <tr key={splice.id} className="border-t border-neutral-200">
                  <td className="px-3 py-2">{splice.lineItem.feederNumber}</td>
                  <td className="px-3 py-2">{splice.oldSpoolMpn}</td>
                  <td className="px-3 py-2">{splice.oldSpoolLot ?? "-"}</td>
                  <td className="px-3 py-2">{splice.newSpoolMpn}</td>
                  <td className="px-3 py-2">{splice.newSpoolLot ?? "-"}</td>
                  <td className="px-3 py-2">{new Date(splice.splicedAt).toLocaleString()}</td>
                </tr>
              ))}
              {changeover.spliceRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-neutral-500">
                    No splicing records found for this changeover.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
