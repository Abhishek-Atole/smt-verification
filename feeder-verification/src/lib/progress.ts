import { prisma } from "@/lib/prisma";

export interface ProgressResult {
  verified: number;
  total: number;
  percentage: number;
  isComplete: boolean;
  remaining: string[];
}

export async function getChangeoverProgress(changeoverId: string): Promise<ProgressResult> {
  const changeover = await prisma.changeover.findUniqueOrThrow({
    where: { id: changeoverId },
    select: {
      bomHeader: {
        select: {
          lineItems: {
            select: {
              id: true,
              feederNumber: true,
            },
          },
        },
      },
      verificationScans: {
        select: {
          lineItemId: true,
        },
      },
    },
  });

  const allFeeders = changeover.bomHeader.lineItems;
  const verifiedIds = new Set(changeover.verificationScans.map((scan) => scan.lineItemId));

  const remaining = allFeeders
    .filter((lineItem) => !verifiedIds.has(lineItem.id))
    .map((lineItem) => lineItem.feederNumber);

  const total = allFeeders.length;
  const verified = verifiedIds.size;
  const percentage = total === 0 ? 0 : Math.round((verified / total) * 100);

  return {
    verified,
    total,
    percentage,
    isComplete: verified === total,
    remaining,
  };
}
