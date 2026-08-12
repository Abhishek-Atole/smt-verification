// @ts-nocheck
import { Router } from "express";
import { SeedDataService } from "../services/seed-service";
import { db, bomsTable, bomItemsTable, sessionsTable, scanRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
const router = Router();
/**
 * POST /api/test/seed - Seed database with sample data
 * Query params: companiesCount, bomsPerCompany, feedersPerBom, etc.
 */
router.post("/test/seed-simple", async (req, res) => {
    try {
        const boms = await db
            .insert(bomsTable)
            .values([
            {
                name: "Industrial Controller - Rev A",
                description: "Advanced industrial control system with networking",
            },
            {
                name: "Power Supply Module - Rev B",
                description: "Switching power supply 24V 5A output",
            },
            {
                name: "Networking Unit - Rev C",
                description: "Ethernet interface module with PHY",
            },
            {
                name: "Signal Processor - Rev D",
                description: "Real-time signal processing with FPGA",
            },
        ])
            .returning();
        res.json({
            success: true,
            message: "Seed complete with 4 BOMs",
            boms: boms.map((b) => ({
                id: b.id,
                name: b.name,
                description: b.description,
            })),
        });
    }
    catch (error) {
        res.status(500).json({
            error: `Failed to seed database: ${error}`,
        });
    }
});
/**
 * POST /api/test/seed - Seed database with sample data
 * Query params: companiesCount, bomsPerCompany, feedersPerBom, etc.
 */
router.post("/test/seed", async (req, res) => {
    try {
        const options = {
            companiesCount: req.body?.companiesCount || 2,
            bomsPerCompany: req.body?.bomsPerCompany || 3,
            feedersPerBom: req.body?.feedersPerBom || 10,
            componentsPerBom: req.body?.componentsPerBom || 8,
            alternatesPerComponent: req.body?.alternatesPerComponent || 2,
            sessionsPerBom: req.body?.sessionsPerBom || 2,
            scansPerSession: req.body?.scansPerSession || 15,
        };
        const result = await SeedDataService.seedDatabase(options);
        res.json({ success: result.success, recordsCreated: result.recordsCreated });
    }
    catch (error) {
        res.status(500).json({
            error: `Failed to seed database: ${error}`,
        });
    }
});
/**
 * POST /api/test/clear - Clear all data from database
 * ⚠️ WARNING: This will delete all data!
 */
router.post("/test/clear", async (req, res) => {
    try {
        const confirmToken = req.headers["x-confirm-clear"];
        if (confirmToken !== "CLEAR_DATABASE_CONFIRMED") {
            return res.status(403).json({
                error: "Clear action not confirmed. Include header: x-confirm-clear: CLEAR_DATABASE_CONFIRMED",
            });
        }
        await SeedDataService.clearDatabase();
        res.json({ success: true, message: "Database cleared" });
    }
    catch (error) {
        res.status(500).json({
            error: `Failed to clear database: ${error}`,
        });
    }
});
/**
 * GET /api/test/stats - Get database statistics
 */
router.get("/test/stats", async (req, res) => {
    try {
        const stats = await SeedDataService.getDatabaseStats();
        res.json({
            timestamp: new Date().toISOString(),
            stats,
            total: Object.values(stats).reduce((a, b) => a + b, 0),
        });
    }
    catch (error) {
        res.status(500).json({
            error: `Failed to get database stats: ${error}`,
        });
    }
});
/**
 * GET /api/test/seed-quick - Quick seed with minimal data (for testing)
 */
router.get("/test/seed-quick", async (req, res) => {
    try {
        const result = await SeedDataService.seedDatabase({
            companiesCount: 1,
            bomsPerCompany: 1,
            feedersPerBom: 5,
            componentsPerBom: 5,
            alternatesPerComponent: 1,
            sessionsPerBom: 1,
            scansPerSession: 5,
        });
        res.json({
            success: result.success,
            recordsCreated: result.recordsCreated,
            message: "Quick seed completed with minimal data",
        });
    }
    catch (error) {
        res.status(500).json({
            error: `Failed to quick seed: ${error}`,
        });
    }
});
/**
 * POST /api/test/seed-boms-with-items - Comprehensive seed with BOM items, sessions, and scans
 * Populates 4 BOMs with realistic items, sessions, and scan records
 */
router.post("/test/seed-boms-with-items", async (req, res) => {
    try {
        // Get existing BOMs or create them
        const existingBoms = await db.query.bomsTable.findMany();
        let boms = existingBoms;
        if (boms.length === 0) {
            boms = await db
                .insert(bomsTable)
                .values([
                {
                    name: "Industrial Controller - Rev A",
                    description: "Advanced industrial control system with networking",
                },
                {
                    name: "Power Supply Module - Rev B",
                    description: "Switching power supply 24V 5A output",
                },
                {
                    name: "Networking Unit - Rev C",
                    description: "Ethernet interface module with PHY",
                },
                {
                    name: "Signal Processor - Rev D",
                    description: "Real-time signal processing with FPGA",
                },
            ])
                .returning();
        }
        // Component library with realistic feeder data
        const componentLibrary = [
            {
                partNumber: "TI-LM7805",
                description: "5V Linear Regulator",
                location: "A1",
                quantity: 5,
            },
            {
                partNumber: "ST-STM32F4",
                description: "ARM Cortex-M4 Microcontroller",
                location: "U1",
                quantity: 2,
            },
            {
                partNumber: "NXP-LPC1768",
                description: "ARM Cortex-M3 Processor",
                location: "U2",
                quantity: 1,
            },
            {
                partNumber: "ATM-28C256",
                description: "256K EEPROM Memory",
                location: "U3",
                quantity: 3,
            },
            {
                partNumber: "PHI-LM324N",
                description: "Op-Amp Quad",
                location: "U4",
                quantity: 8,
            },
            {
                partNumber: "MURATA-EMIFN-05D",
                description: "EMI Filter Network",
                location: "F1",
                quantity: 2,
            },
            {
                partNumber: "KEMET-R82EC1H225K",
                description: "Supercap 2.2F",
                location: "C1",
                quantity: 2,
            },
            {
                partNumber: "VISHAY-CRCW06031K00",
                description: "Thick Film Resistor 1k",
                location: "R1-R10",
                quantity: 12,
            },
            {
                partNumber: "SAMSUNG-K4M28163",
                description: "1Mb SRAM Memory",
                location: "U5",
                quantity: 4,
            },
            {
                partNumber: "MAXIM-MAX3232",
                description: "RS232 Transceiver",
                location: "U6",
                quantity: 2,
            },
            {
                partNumber: "INTEL-I7-8700K",
                description: "High Performance CPU",
                location: "CPU",
                quantity: 1,
            },
            {
                partNumber: "XILINX-XC7A35T",
                description: "FPGA Artix-7",
                location: "FPGA",
                quantity: 1,
            },
            {
                partNumber: "TI-ISO7x1DR",
                description: "Digital Isolator",
                location: "U7",
                quantity: 6,
            },
            {
                partNumber: "ON-NCP1014",
                description: "PWM Controller",
                location: "IC1",
                quantity: 1,
            },
        ];
        let totalItemsCreated = 0;
        let totalSessionsCreated = 0;
        let totalScansCreated = 0;
        // Process each BOM
        for (const bom of boms) {
            // Clear existing items for this BOM
            await db.delete(bomItemsTable).where(eq(bomItemsTable.bomId, bom.id));
            // Add 8-14 items per BOM
            const itemsToAdd = componentLibrary.slice(0, 8 + Math.floor(Math.random() * 6));
            const addedItems = await db
                .insert(bomItemsTable)
                .values(itemsToAdd.map((item, idx) => ({
                bomId: bom.id,
                feederNumber: `FDR-${String(idx + 1).padStart(3, "0")}`,
                partNumber: item.partNumber,
                description: item.description,
                location: item.location,
                quantity: item.quantity,
            })))
                .returning();
            totalItemsCreated += addedItems.length;
            // Create 1-2 sample sessions per BOM
            const sessionsCount = Math.random() > 0.5 ? 2 : 1;
            for (let s = 0; s < sessionsCount; s++) {
                const now = new Date();
                const startTime = new Date(now.getTime() - Math.random() * 86400000); // Random time in last 24h
                const endTime = new Date(startTime.getTime() + Math.random() * 3600000 + 600000); // 10min to 1h duration
                const shiftDate = new Date(startTime).toISOString().split("T")[0]; // YYYY-MM-DD
                const session = await db
                    .insert(sessionsTable)
                    .values({
                    bomId: bom.id,
                    companyName: "Test Company",
                    customerName: "Test Customer",
                    panelName: `Panel-${bom.id}-${s + 1}`,
                    supervisorName: `SV-${Math.floor(Math.random() * 99)
                        .toString()
                        .padStart(2, "0")}`,
                    operatorName: `OP-${Math.floor(Math.random() * 999)
                        .toString()
                        .padStart(3, "0")}`,
                    shiftName: ["A", "B", "C"][Math.floor(Math.random() * 3)],
                    shiftDate,
                    productionCount: addedItems.length,
                    status: "completed",
                    startTime,
                    endTime,
                })
                    .returning();
                totalSessionsCreated += 1;
                // Generate 10-40 scan records per session
                const scansCount = 10 + Math.floor(Math.random() * 30);
                const scanStatuses = ["pass", "fail", "rework"];
                const scanRecords = [];
                // @ts-ignore - Extra fields on scanRecord objects
                for (let i = 0; i < scansCount; i++) {
                    scanRecords.push({
                        sessionId: session[0].id,
                        feederNumber: addedItems[i % addedItems.length].feederNumber,
                        spoolBarcode: `BC-${Math.random().toString(36).substr(2, 10).toUpperCase()}`,
                        status: scanStatuses[Math.floor(Math.random() * scanStatuses.length)],
                        partNumber: addedItems[i % addedItems.length].partNumber,
                        description: addedItems[i % addedItems.length].description,
                        location: addedItems[i % addedItems.length].location,
                        validationResult: "pass",
                        scannedAt: new Date(startTime.getTime() + (i * (endTime.getTime() - startTime.getTime())) / scansCount),
                    });
                }
                // @ts-ignore - scanRecords may have extra fields at test time
                await db.insert(scanRecordsTable).values(scanRecords);
                totalScansCreated += scansCount;
            }
        }
        const result = {
            success: true,
            message: "Comprehensive seed completed successfully",
            statistics: {
                bomsProcessed: boms.length,
                itemsCreated: totalItemsCreated,
                sessionsCreated: totalSessionsCreated,
                scansCreated: totalScansCreated,
                totalRecords: totalItemsCreated + totalSessionsCreated + totalScansCreated,
            },
        };
        res.json(result);
    }
    catch (error) {
        res.status(500).json({
            error: `Failed to seed BOMs with items: ${error}`,
        });
    }
});
export default router;
