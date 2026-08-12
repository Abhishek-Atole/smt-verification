import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const isPrivileged = ["qa", "engineer", "admin"].includes(session?.user?.role ?? "operator");

  const changeovers = await prisma.changeover.findMany({
    where: isPrivileged ? {} : { operatorId: session?.user?.id },
    select: {
      id: true,
      status: true,
      lineNumber: true,
      shift: true,
      startedAt: true,
      operator: { select: { name: true, employeeId: true } },
      bomHeader: { select: { bomNumber: true, revision: true } },
      _count: {
        select: {
          verificationScans: true,
          spliceRecords: true,
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-neutral-900">Feeder Verification Dashboard</h1>
      <p className="text-sm text-neutral-600">
        Start a changeover, verify feeder slots by spool scan, then proceed to splicing.
      </p>
      <Link href="/changeover/new" className="inline-flex rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
        Start New Changeover
      </Link>

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            {isPrivileged ? "All Changeovers" : "My Changeovers"}
          </h2>
        </div>

        {changeovers.length === 0 ? (
          <div className="px-4 py-6 text-sm text-neutral-600">No changeovers found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-600">
                <tr>
                  <th className="px-4 py-3">BOM</th>
                  {isPrivileged ? <th className="px-4 py-3">Operator</th> : null}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Line</th>
                  <th className="px-4 py-3">Shift</th>
                  <th className="px-4 py-3">Verified</th>
                  <th className="px-4 py-3">Splices</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-neutral-800">
                {changeovers.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900">{item.bomHeader.bomNumber}</div>
                      <div className="text-xs text-neutral-600">Rev {item.bomHeader.revision}</div>
                    </td>
                    {isPrivileged ? (
                      <td className="px-4 py-3">
                        <div>{item.operator.name}</div>
                        <div className="text-xs text-neutral-600">{item.operator.employeeId}</div>
                      </td>
                    ) : null}
                    <td className="px-4 py-3 capitalize">{item.status.replace("_", " ")}</td>
                    <td className="px-4 py-3">{item.lineNumber ?? "-"}</td>
                    <td className="px-4 py-3">{item.shift ?? "-"}</td>
                    <td className="px-4 py-3">{item._count.verificationScans}</td>
                    <td className="px-4 py-3">{item._count.spliceRecords}</td>
                    <td className="px-4 py-3">{new Date(item.startedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <Link href={`/changeover/${item.id}`} className="text-neutral-900 underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
