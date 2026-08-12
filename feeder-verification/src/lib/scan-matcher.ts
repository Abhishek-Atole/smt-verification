import { prisma } from "@/lib/prisma";

export interface ScanMatchResult {
  lineItemId: string;
  alternativeId: string;
  make: string;
  matchedMpn: string;
  matchType: "mpn1" | "mpn2" | "mpn3" | "ucal_part_number";
  isAlternate: boolean;
  feederNumber: string;
  description: string | null;
}

export async function matchScan(
  bomHeaderId: string,
  rawScan: string,
): Promise<ScanMatchResult | null> {
  const val = rawScan.trim().toUpperCase();

  const alternatives = await prisma.bomAlternative.findMany({
    where: { lineItem: { bomHeaderId } },
    select: {
      id: true,
      rank: true,
      make: true,
      mpn: true,
      lineItem: {
        select: {
          id: true,
          feederNumber: true,
          description: true,
          ucalPartNumbers: true,
        },
      },
    },
    orderBy: { rank: "asc" },
  });

  for (const alt of alternatives) {
    const mpnVariants = alt.mpn.split("/").map((segment) => segment.trim().toUpperCase());
    if (mpnVariants.includes(val)) {
      const rankToMatchType: Record<number, ScanMatchResult["matchType"]> = {
        1: "mpn1",
        2: "mpn2",
        3: "mpn3",
      };

      return {
        lineItemId: alt.lineItem.id,
        alternativeId: alt.id,
        make: alt.make,
        matchedMpn: alt.mpn,
        matchType: rankToMatchType[alt.rank] ?? "mpn1",
        isAlternate: alt.rank > 1,
        feederNumber: alt.lineItem.feederNumber,
        description: alt.lineItem.description,
      };
    }
  }

  const lineItemMatch = await prisma.bomLineItem.findFirst({
    where: {
      bomHeaderId,
      ucalPartNumbers: { has: val },
    },
    select: {
      id: true,
      feederNumber: true,
      description: true,
      alternatives: {
        where: { rank: 1 },
        select: { id: true, make: true, mpn: true },
        take: 1,
      },
    },
  });

  if (lineItemMatch?.alternatives[0]) {
    const primary = lineItemMatch.alternatives[0];
    return {
      lineItemId: lineItemMatch.id,
      alternativeId: primary.id,
      make: primary.make,
      matchedMpn: val,
      matchType: "ucal_part_number",
      isAlternate: false,
      feederNumber: lineItemMatch.feederNumber,
      description: lineItemMatch.description,
    };
  }

  return null;
}
