import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users: Array<{ employeeId: string; name: string; role: UserRole }> = [
    { employeeId: "OP001", name: "Operator One", role: UserRole.operator },
    { employeeId: "QA001", name: "QA One", role: UserRole.qa },
    { employeeId: "ENG001", name: "Engineer One", role: UserRole.engineer },
    { employeeId: "ADM001", name: "Admin One", role: UserRole.admin },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { employeeId: user.employeeId },
      update: {
        name: user.name,
        role: user.role,
        isActive: true,
      },
      create: {
        employeeId: user.employeeId,
        name: user.name,
        role: user.role,
      },
    });
  }

  const demoBoms = [
    {
      bomNumber: "RD/BOM/INTBUZ/R1.1",
      revision: "R00",
      bomDate: new Date("2026-04-01T00:00:00.000Z"),
      customerName: "Intermittent Buzzer",
      partNameInternal: "INTBUZ-001",
      lines: [
        {
          srNo: 1,
          feederNumber: "YSM-001",
          ucalPartNumbers: ["RDSCAP0353", "RDSCAP0312"],
          requiredQty: 1,
          referenceLocation: "C1, C2",
          description: "4.7nF/50V 10%",
          packageDesc: "603",
          alternatives: [
            { rank: 1, make: "KEMET", mpn: "C0603C472K5RACAUTO", supplierCode: "SUP-001" },
            { rank: 2, make: "YAGEO", mpn: "CC0603KRX7R9BB472", supplierCode: "SUP-002" },
            { rank: 3, make: "TDK", mpn: "CGA3E2X7R1H472K080AA", supplierCode: "SUP-003" },
          ],
        },
        {
          srNo: 2,
          feederNumber: "YSM-002",
          ucalPartNumbers: ["RDSRES0101"],
          requiredQty: 2,
          referenceLocation: "R1, R2",
          description: "10K 1%",
          packageDesc: "0603",
          alternatives: [
            { rank: 1, make: "PANASONIC", mpn: "ERJ-3EKF1002V", supplierCode: "SUP-010" },
            { rank: 2, make: "YAGEO", mpn: "RC0603FR-0710KL", supplierCode: "SUP-011" },
          ],
        },
        {
          srNo: 3,
          feederNumber: "YSM-003",
          ucalPartNumbers: ["RDSLED0001"],
          requiredQty: 1,
          referenceLocation: "D1",
          description: "Green LED",
          packageDesc: "0805",
          alternatives: [
            { rank: 1, make: "LITEON", mpn: "LTST-C170GKT", supplierCode: "SUP-020" },
            { rank: 2, make: "KINGBRIGHT", mpn: "APT2012SGC", supplierCode: "SUP-021" },
          ],
        },
      ],
    },
    {
      bomNumber: "RD/BOM/FANCTRL/R2.0",
      revision: "R01",
      bomDate: new Date("2026-04-08T00:00:00.000Z"),
      customerName: "Fan Controller",
      partNameInternal: "FANCTRL-002",
      lines: [
        {
          srNo: 1,
          feederNumber: "YSM-101",
          ucalPartNumbers: ["RDSMCU1101"],
          requiredQty: 1,
          referenceLocation: "U1",
          description: "MCU",
          packageDesc: "QFN-32",
          alternatives: [
            { rank: 1, make: "ST", mpn: "STM32G031K8T6", supplierCode: "SUP-101" },
            { rank: 2, make: "NXP", mpn: "LPC1114FBD48/102", supplierCode: "SUP-102" },
          ],
        },
        {
          srNo: 2,
          feederNumber: "YSM-102",
          ucalPartNumbers: ["RDSREG2201", "RDSREG2202"],
          requiredQty: 1,
          referenceLocation: "U2",
          description: "5V Regulator",
          packageDesc: "SOT-223",
          alternatives: [
            { rank: 1, make: "TI", mpn: "LM1117MPX-5.0/NOPB", supplierCode: "SUP-110" },
            { rank: 2, make: "ONSEMI", mpn: "NCP1117ST50T3G", supplierCode: "SUP-111" },
            { rank: 3, make: "DIODES", mpn: "AP1117E50G-13", supplierCode: "SUP-112" },
          ],
        },
      ],
    },
  ];

  for (const bom of demoBoms) {
    const header = await prisma.bomHeader.upsert({
      where: { bomNumber: bom.bomNumber },
      update: {
        revision: bom.revision,
        bomDate: bom.bomDate,
        customerName: bom.customerName,
        partNameInternal: bom.partNameInternal,
        isActive: true,
      },
      create: {
        bomNumber: bom.bomNumber,
        revision: bom.revision,
        bomDate: bom.bomDate,
        customerName: bom.customerName,
        partNameInternal: bom.partNameInternal,
      },
      select: { id: true },
    });

    await prisma.bomLineItem.deleteMany({ where: { bomHeaderId: header.id } });

    for (const line of bom.lines) {
      const lineItem = await prisma.bomLineItem.create({
        data: {
          bomHeaderId: header.id,
          srNo: line.srNo,
          feederNumber: line.feederNumber,
          ucalPartNumbers: line.ucalPartNumbers,
          requiredQty: line.requiredQty,
          referenceLocation: line.referenceLocation,
          description: line.description,
          packageDesc: line.packageDesc,
        },
        select: { id: true },
      });

      await prisma.bomAlternative.createMany({
        data: line.alternatives.map((alternative) => ({
          lineItemId: lineItem.id,
          rank: alternative.rank,
          make: alternative.make,
          mpn: alternative.mpn,
          supplierCode: alternative.supplierCode,
        })),
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
