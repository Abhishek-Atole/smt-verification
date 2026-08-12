// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "@workspace/db";
import { bomsTable, bomItemsTable, componentAlternatesTable, componentsTable, sessionsTable, scanRecordsTable, spliceRecordsTable, } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { TimestampService } from "./timestamp-service";
export class SeedDataService {
    // Predefined component library for realistic BOMs
    static COMPONENT_LIBRARY = {
        resistors: [
            { partId: "RES_1K_001", mpn: "CF14JT1K00", name: "Resistor 1K 1/4W", manufacturer: "Vishay" },
            { partId: "RES_10K_001", mpn: "CF14JT10K0", name: "Resistor 10K 1/4W", manufacturer: "Vishay" },
            { partId: "RES_100K_001", mpn: "CF14JT100K", name: "Resistor 100K 1/4W", manufacturer: "Vishay" },
            { partId: "RES_4K7_001", mpn: "CF14JT4K70", name: "Resistor 4.7K 1/4W", manufacturer: "Vishay" },
        ],
        capacitors: [
            { partId: "CAP_10U_001", mpn: "AE103C100", name: "Capacitor 10µF 25V", manufacturer: "Kemet" },
            { partId: "CAP_100U_001", mpn: "EEE1E101P", name: "Capacitor 100µF 16V", manufacturer: "Panasonic" },
            { partId: "CAP_01U_001", mpn: "C315C104M5U5TA", name: "Capacitor 0.1µF 50V", manufacturer: "Kemet" },
            { partId: "CAP_1U_001", mpn: "C315C105M5U5TA", name: "Capacitor 1µF 25V", manufacturer: "Kemet" },
        ],
        inductors: [
            { partId: "IND_22U_001", mpn: "CDRH127R-2R2", name: "Inductor 2.2mH", manufacturer: "Murata" },
            { partId: "IND_10U_001", mpn: "CDRH104R-100", name: "Inductor 10µH", manufacturer: "Murata" },
            { partId: "IND_47U_001", mpn: "CDRH3D28", name: "Inductor 47µH", manufacturer: "Murata" },
        ],
        semiconductors: [
            { partId: "TQ_NPN_001", mpn: "2N3904", name: "Transistor NPN 2N3904", manufacturer: "ON Semiconductor" },
            { partId: "TQ_PNP_001", mpn: "2N3906", name: "Transistor PNP 2N3906", manufacturer: "ON Semiconductor" },
            { partId: "DIO_1N4148_001", mpn: "1N4148", name: "Diode 1N4148", manufacturer: "ON Semiconductor" },
            { partId: "DIO_SCHOT_001", mpn: "1N5819", name: "Schottky Diode", manufacturer: "ON Semiconductor" },
        ],
        ics: [
            { partId: "IC_LM358_001", mpn: "LM358", name: "Op-Amp LM358", manufacturer: "Texas Instruments" },
            { partId: "IC_TL072_001", mpn: "TL072", name: "Op-Amp TL072", manufacturer: "Texas Instruments" },
            { partId: "IC_LM339_001", mpn: "LM339", name: "Comparator LM339", manufacturer: "Texas Instruments" },
            { partId: "IC_LM7805_001", mpn: "LM7805", name: "Voltage Regulator LM7805", manufacturer: "Texas Instruments" },
        ],
        microcontrollers: [
            { partId: "MCU_STM32F103_001", mpn: "STM32F103C8T6", name: "ARM Cortex STM32F103", manufacturer: "STMicroelectronics" },
            { partId: "MCU_STM32F407_001", mpn: "STM32F407VGT6", name: "ARM Cortex STM32F407", manufacturer: "STMicroelectronics" },
            { partId: "MCU_PIC18F_001", mpn: "PIC18F4520", name: "8-bit PIC18F4520", manufacturer: "Microchip" },
        ],
        fpgas: [
            { partId: "FPGA_XILINX_001", mpn: "XC7A35T-FGG484", name: "Xilinx Artix-7", manufacturer: "Xilinx" },
            { partId: "FPGA_ALTERA_001", mpn: "EP4CE6F17C8N", name: "Altera Cyclone IV", manufacturer: "Intel" },
        ],
    };
    // Predefined BOM templates for different products
    static BOM_TEMPLATES = {
        "Industrial Controller": {
            description: "Advanced industrial control system with networking",
            itemCount: 12,
            items: [
                { position: "U1", category: "microcontrollers", quantity: 1 },
                { position: "U2", category: "ics", quantity: 1 },
                { position: "U3", category: "ics", quantity: 2 },
                { position: "C1,C2,C3", category: "capacitors", quantity: 3 },
                { position: "C4,C5", category: "capacitors", quantity: 2 },
                { position: "R1,R2,R3", category: "resistors", quantity: 3 },
                { position: "R4", category: "resistors", quantity: 2 },
                { position: "Q1", category: "semiconductors", quantity: 1 },
                { position: "Q2", category: "semiconductors", quantity: 1 },
                { position: "D1", category: "semiconductors", quantity: 1 },
                { position: "L1", category: "inductors", quantity: 1 },
            ],
        },
        "Power Supply Module": {
            description: "Switching power supply 24V 5A output",
            itemCount: 8,
            items: [
                { position: "U1", category: "ics", quantity: 1 },
                { position: "C1,C2", category: "capacitors", quantity: 2 },
                { position: "C3,C4,C5", category: "capacitors", quantity: 3 },
                { position: "R1,R2", category: "resistors", quantity: 2 },
                { position: "L1", category: "inductors", quantity: 1 },
                { position: "D1", category: "semiconductors", quantity: 1 },
                { position: "Q1", category: "semiconductors", quantity: 1 },
            ],
        },
        "Networking Unit": {
            description: "Ethernet interface module with PHY",
            itemCount: 10,
            items: [
                { position: "U1", category: "microcontrollers", quantity: 1 },
                { position: "U2", category: "ics", quantity: 1 },
                { position: "C1-C5", category: "capacitors", quantity: 5 },
                { position: "R1-R4", category: "resistors", quantity: 4 },
                { position: "L1", category: "inductors", quantity: 1 },
                { position: "TX1,TX2", category: "semiconductors", quantity: 2 },
            ],
        },
        "Signal Processor": {
            description: "Real-time signal processing with FPGA",
            itemCount: 14,
            items: [
                { position: "U1", category: "fpgas", quantity: 1 },
                { position: "U2,U3", category: "ics", quantity: 2 },
                { position: "C1-C8", category: "capacitors", quantity: 8 },
                { position: "R1-R6", category: "resistors", quantity: 6 },
                { position: "L1,L2", category: "inductors", quantity: 2 },
                { position: "Q1,Q2,Q3", category: "semiconductors", quantity: 3 },
            ],
        },
    };
    /**
     * Generate sample data for testing
     */
    static async seedDatabase(options = {}) {
        const { bomsPerCompany = 3, sessionsPerBom = 2, scansPerSession = 15 } = options;
        const productNames = Object.keys(this.BOM_TEMPLATES);
        const operatorNames = ["John Smith", "Maria Garcia", "David Chen", "Sarah Johnson"];
        const supervisorNames = ["Mike Davis", "Jennifer Lee", "Robert Brown"];
        const shiftNames = ["Morning", "Afternoon", "Night"];
        let totalCreated = 0;
        for (let b = 0; b < bomsPerCompany; b++) {
            const productName = productNames[b % productNames.length];
            const template = this.BOM_TEMPLATES[productName];
            // Create BOM
            let bom = null;
            try {
                const bomResult = (await db
                    .insert(bomsTable)
                    .values({
                    name: `${productName} - Rev ${String.fromCharCode(65 + b)}`,
                    description: template.description,
                })
                    .returning());
                bom = bomResult[0];
                if (!bom)
                    throw new Error("BOM insertion returned no result");
                totalCreated++;
            }
            catch (bomError) {
                throw bomError;
            }
            // Create components for this BOM and build a map
            const componentMap = new Map();
            const bomItems = [];
            for (const itemTemplate of template.items) {
                const category = itemTemplate.category;
                const categoryComponents = this.COMPONENT_LIBRARY[category];
                const compData = categoryComponents[Math.floor(Math.random() * categoryComponents.length)];
                // Create or reuse component
                let component = componentMap.get(compData.mpn);
                if (!component) {
                    try {
                        const result = await db
                            .insert(componentsTable)
                            .values({
                            partId: compData.partId,
                            mpn: compData.mpn,
                            description: compData.name,
                            manufacturer: compData.manufacturer,
                            category: category,
                        })
                            .returning();
                        component = result[0];
                        componentMap.set(compData.mpn, component);
                        totalCreated++;
                    }
                    catch (e) {
                        // Component might already exist, try to fetch it
                        const existing = await db
                            .select()
                            .from(componentsTable)
                            .where(eq(componentsTable.mpn, compData.mpn));
                        if (existing.length > 0) {
                            component = existing[0];
                            componentMap.set(compData.mpn, component);
                        }
                        else {
                            continue;
                        }
                    }
                }
                // Create BOM item
                try {
                    const bomItemResult = (await db
                        .insert(bomItemsTable)
                        .values({
                        bomId: bom.id,
                        componentId: component.id,
                        partNumber: compData.partId,
                        feederNumber: `F${Math.floor(Math.random() * 99) + 1}`,
                        expectedMpn: component.mpn,
                        description: compData.name,
                        quantity: itemTemplate.quantity,
                    })
                        .returning());
                    if (bomItemResult[0]) {
                        bomItems.push(bomItemResult[0]);
                    }
                    totalCreated++;
                    // Create alternates for this component
                    for (let a = 0; a < 2; a++) {
                        const altMpn = `ALT-${component.mpn}-${a + 1}`;
                        try {
                            await db
                                .insert(componentAlternatesTable)
                                .values({
                                primaryComponentId: component.id,
                                alternateComponentId: component.id,
                                approvalStatus: a === 0 ? "approved" : "pending",
                                notes: `Alternate #${a + 1} - Equivalent specs for ${compData.name}`,
                            })
                                .returning();
                            totalCreated++;
                        }
                        catch (e) {
                            // Alternate might already exist, skip
                        }
                    }
                }
                catch (e) {
                    // Failed to create BOM item
                }
            }
            // Create sample sessions and scans
            for (let s = 0; s < sessionsPerBom; s++) {
                const now = TimestampService.getCurrentTimestamp();
                const sessionStart = new Date(now.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000);
                const session = await db
                    .insert(sessionsTable)
                    .values({
                    bomId: bom.id,
                    companyName: "UCAL Electronics",
                    customerName: "Test Customer",
                    panelName: `PANEL-${Math.floor(Math.random() * 10000)
                        .toString()
                        .padStart(5, "0")}`,
                    supervisorName: supervisorNames[Math.floor(Math.random() * supervisorNames.length)],
                    operatorName: operatorNames[Math.floor(Math.random() * operatorNames.length)],
                    shiftName: shiftNames[Math.floor(Math.random() * shiftNames.length)],
                    shiftDate: sessionStart.toISOString().split("T")[0],
                    status: Math.random() > 0.3 ? "completed" : "active",
                    startTime: sessionStart,
                    createdAt: TimestampService.createOperationTimestamp(),
                    endTime: Math.random() > 0.3
                        ? new Date(sessionStart.getTime() + Math.random() * 3 * 60 * 60 * 1000)
                        : null,
                })
                    .returning();
                totalCreated++;
                // Create scans for this session
                const statuses = ["ok", "reject", "ok"];
                for (let sc = 0; sc < scansPerSession && sc < bomItems.length; sc++) {
                    const scanTime = new Date(sessionStart.getTime() + Math.random() * 2 * 60 * 60 * 1000);
                    const status = statuses[Math.floor(Math.random() * statuses.length)];
                    const useAlternate = Math.random() > 0.75;
                    const alternateIdx = Math.floor(Math.random() * 2);
                    try {
                        const scan = await db
                            // @ts-ignore - Scan record fields may not match at seed time
                            .insert(scanRecordsTable)
                            .values({
                            sessionId: session[0].id,
                            feederNumber: bomItems[sc].feederNumber,
                            componentId: bomItems[sc].componentId,
                            reelId: `REEL-${Math.floor(Math.random() * 100000)
                                .toString()
                                .padStart(6, "0")}`,
                            scannedMpn: useAlternate
                                ? `ALT-${bomItems[sc].expectedMpn}-${alternateIdx + 1}`
                                : bomItems[sc].expectedMpn,
                            lotNumber: `LOT-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000)
                                .toString()
                                .padStart(5, "0")}`,
                            dateCode: `${Math.floor(Math.random() * 52)
                                .toString()
                                .padStart(2, "0")}${new Date().getFullYear().toString().slice(-2)}`,
                            status,
                            validationResult: status === "ok" ? (useAlternate ? "alternate_pass" : "pass") : "mismatch",
                            alternateUsed: useAlternate,
                            scannedAt: scanTime,
                        })
                            .returning();
                        totalCreated++;
                    }
                    catch (e) {
                        // Failed to create scan record
                    }
                }
                // Create a splice record
                if (Math.random() > 0.5 && bomItems.length > 2) {
                    try {
                        const splice = await db
                            .insert(spliceRecordsTable)
                            .values({
                            sessionId: session[0].id,
                            feederNumber: bomItems[Math.floor(Math.random() * bomItems.length)].feederNumber,
                            oldSpoolBarcode: `OLD-SPOOL-${Math.floor(Math.random() * 100000)}`,
                            newSpoolBarcode: `NEW-SPOOL-${Math.floor(Math.random() * 100000)}`,
                            durationSeconds: Math.floor(Math.random() * 120) + 30,
                            splicedAt: TimestampService.createOperationTimestamp(),
                        })
                            .returning();
                        totalCreated++;
                    }
                    catch (e) {
                        // Failed to create splice record
                    }
                }
            }
        }
        return { success: true, recordsCreated: totalCreated };
    }
    /**
     * Clear all data for fresh seeding
     */
    static async clearDatabase() {
        // Order matters due to foreign keys
        const tables = [
            "splice_records",
            "scan_records",
            "component_history",
            "sessions",
            "component_alternates",
            "bom_items",
            "feeders",
            "components",
            "boms",
            "audit_logs",
        ];
        for (const table of tables) {
            await db.execute(`TRUNCATE TABLE "${table}" CASCADE`);
        }
    }
    /**
     * Get database statistics
     */
    static async getDatabaseStats() {
        const getCount = async (tableName) => {
            // @ts-ignore - Raw execute result type
            const result = await db.execute(`SELECT COUNT(*) as count FROM "${tableName}"`);
            return result?.rows?.[0]?.count ?? 0;
        };
        const stats = {
            boms: await getCount("boms"),
            components: await getCount("components"),
            componentAlternates: await getCount("component_alternates"),
            feeders: await getCount("feeders"),
            bomItems: await getCount("bom_items"),
            sessions: await getCount("sessions"),
            scans: await getCount("scan_records"),
            splices: await getCount("splices"),
            auditLogs: await getCount("audit_logs"),
        };
        return stats;
    }
}
