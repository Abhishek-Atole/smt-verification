import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient({ log: ["warn", "error"] });
const CHANGEOVER_STATUSES = ["complete", "complete", "verified", "in_progress", "splicing"] as const;

const USERS = [
  { employeeId: "OP001", name: "Operator One", role: UserRole.operator },
  { employeeId: "QA001", name: "QA One", role: UserRole.qa },
  { employeeId: "ENG001", name: "Engineer One", role: UserRole.engineer },
  { employeeId: "ADM001", name: "Admin One", role: UserRole.admin },
];

const BOMS = [
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

async function seedUsers(): Promise<void> {
  for (const user of USERS) {
    await prisma.user.upsert({
      where: { employeeId: user.employeeId },
      update: { name: user.name, role: user.role, isActive: true },
      create: user,
    });
  }
}

async function seedBoms(): Promise<string[]> {
  const bomIds: string[] = [];

  for (const bom of BOMS) {
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

    bomIds.push(header.id);
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

  return bomIds;
}

async function main(): Promise<void> {
  const extraUsers = Number(process.env.LOAD_USERS ?? 1000);
  const extraBoms = Number(process.env.LOAD_BOMS ?? 50);
  const extraChangeovers = Number(process.env.LOAD_CHANGEOVERS ?? 10000);
  const extraAuditLogs = Number(process.env.LOAD_AUDIT_LOGS ?? 500000);

  await seedUsers();
  const bomIds = await seedBoms();

  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  const operatorIds = users.filter((user) => user.role === UserRole.operator).map((user) => user.id);
  const userIds = users.map((user) => user.id);

  for (let index = 0; index < extraUsers; index += 1) {
    const employeeId = `EMP-${String(index + 1).padStart(5, "0")}`;
    const role = index % 4 === 0 ? UserRole.operator : index % 4 === 1 ? UserRole.qa : index % 4 === 2 ? UserRole.engineer : UserRole.admin;
    await prisma.user.upsert({
      where: { employeeId },
      update: { name: `Test User ${index + 1}`, role, isActive: true },
      create: { employeeId, name: `Test User ${index + 1}`, role },
    });
  }

  for (let index = 0; index < extraBoms; index += 1) {
    const bomNumber = `BOM-TEST-${String(index + 1).padStart(4, "0")}`;
    const header = await prisma.bomHeader.upsert({
      where: { bomNumber },
      update: { revision: "R00", bomDate: new Date(), isActive: true },
      create: {
        bomNumber,
        revision: "R00",
        bomDate: new Date(),
        customerName: "Load Test Customer",
        partNameInternal: `INT-TEST-${index + 1}`,
      },
      select: { id: true },
    });

    const lineItem = await prisma.bomLineItem.upsert({
      where: { bomHeaderId_feederNumber: { bomHeaderId: header.id, feederNumber: "YSM-001" } },
      update: { description: `Load Test Line ${index + 1}` },
      create: {
        bomHeaderId: header.id,
        srNo: 1,
        feederNumber: "YSM-001",
        ucalPartNumbers: ["RDSCAP0353"],
        requiredQty: 1,
        referenceLocation: "C1",
        description: `Load Test Line ${index + 1}`,
        packageDesc: "603",
      },
      select: { id: true },
    });

    await prisma.bomAlternative.upsert({
      where: { lineItemId_rank: { lineItemId: lineItem.id, rank: 1 } },
      update: { make: "KEMET", mpn: "C0603C472K5RACAUTO" },
      create: {
        lineItemId: lineItem.id,
        rank: 1,
        make: "KEMET",
        mpn: "C0603C472K5RACAUTO",
      },
    });
  }

  const changeovers = Array.from({ length: extraChangeovers }, (_, index) => ({
    bomHeaderId: bomIds[index % bomIds.length] ?? bomIds[0],
    operatorId: operatorIds[index % operatorIds.length] ?? users[0]?.id,
    lineNumber: `LINE-${(index % 5) + 1}`,
    shift: ["MORNING", "EVENING", "NIGHT"][index % 3],
    status: CHANGEOVER_STATUSES[index % CHANGEOVER_STATUSES.length],
    startedAt: new Date(Date.now() - (extraChangeovers - index) * 3600000),
    version: 0,
  }));

  for (let index = 0; index < changeovers.length; index += 500) {
    await prisma.changeover.createMany({ data: changeovers.slice(index, index + 500) });
  }

  const persistedChangeovers = await prisma.changeover.findMany({ select: { id: true } });
  const changeoverIds = persistedChangeovers.map((changeover) => changeover.id);

  const auditLogs = Array.from({ length: extraAuditLogs }, (_, index) => ({
    changeoverId: changeoverIds[index % changeoverIds.length] ?? null,
    userId: userIds[index % userIds.length] ?? users[0]?.id,
    eventType: ["scan_ok", "scan_fail", "splice", "changeover_created"][index % 4],
    payload: { feeder: `YSM-00${(index % 8) + 1}`, seq: index },
    occurredAt: new Date(Date.now() - (extraAuditLogs - index) * 1000),
  }));

  for (let index = 0; index < auditLogs.length; index += 1000) {
    await prisma.auditLog.createMany({ data: auditLogs.slice(index, index + 1000) });
  }

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.bomHeader.count(),
    prisma.bomLineItem.count(),
    prisma.bomAlternative.count(),
    prisma.changeover.count(),
    prisma.verificationScan.count(),
    prisma.spliceRecord.count(),
    prisma.auditLog.count(),
  ]);

  console.log("Seed complete");
  console.log({
    users: counts[0],
    bomHeaders: counts[1],
    bomLineItems: counts[2],
    bomAlternatives: counts[3],
    changeovers: counts[4],
    verificationScans: counts[5],
    spliceRecords: counts[6],
    auditLog: counts[7],
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });