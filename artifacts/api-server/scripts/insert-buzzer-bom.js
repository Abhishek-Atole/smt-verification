import { db } from "@workspace/db";
import { bomsTable, bomItemsTable } from "@workspace/db/schema";
async function insertBuzzerBOM() {
    try {
        // Create BOM
        const [bomResult] = await db.insert(bomsTable).values({
            name: "Intermittent Buzzer (INTBUZ/R&D/R1.1)",
            description: "PART NO: INTBUZ/R&D/R1.1 /T-206506 | Mahindra Last Mile Mobility Limited | Rev: R00/06-01-2026",
        }).returning();
        const bomId = bomResult.id;
        // BOM Items
        const items = [
            {
                feeder_number: "C1",
                part_number: "RDSCAP0353",
                manufacturer: "KEMET",
                mpn: "C0603C472K5RACAUTO",
                expected_mpn: "C0603C472K5RACAUTO",
                package_size: "0603",
                quantity: 1,
                description: "4.7nF/50V 10%",
                is_alternate: false,
            },
            {
                feeder_number: "C2",
                part_number: "RDSCAP0312",
                manufacturer: "YAGEO",
                mpn: "CC0603KRX7R9BB472",
                expected_mpn: "C0603C472K5RACAUTO",
                package_size: "0603",
                quantity: 1,
                description: "4.7nF/50V 10% (Alternate)",
                is_alternate: true,
            },
            {
                feeder_number: "C3",
                part_number: "RDSCAP0037",
                manufacturer: "KEMET",
                mpn: "C0603C104K5RACAUTO",
                expected_mpn: "C0603C104K5RACAUTO",
                package_size: "0603",
                quantity: 1,
                description: "0.1uF/50V/10%",
                is_alternate: false,
            },
            {
                feeder_number: "C4",
                part_number: "RDSCAP0037",
                manufacturer: "YAGEO",
                mpn: "CC0603KRX7R9BB104",
                expected_mpn: "C0603C104K5RACAUTO",
                package_size: "0603",
                quantity: 1,
                description: "0.1uF/50V/10% (Alternate)",
                is_alternate: true,
            },
            {
                feeder_number: "R3",
                part_number: "RDSRES0987",
                manufacturer: "Royal Ohm",
                mpn: "CQ03WAF4701T5E",
                expected_mpn: "RC0603FR-074K7L",
                package_size: "0603",
                quantity: 1,
                description: "4.7K Resistor ±1%",
                is_alternate: false,
            },
            {
                feeder_number: "R4",
                part_number: "RDSRES0502",
                manufacturer: "Royal Ohm",
                mpn: "CQ05S8F2703T5E",
                expected_mpn: "RC0805FR-07270KL",
                package_size: "0805",
                quantity: 1,
                description: "270K Resistor 1%",
                is_alternate: false,
            },
            {
                feeder_number: "R5",
                part_number: "RDSRES0235",
                manufacturer: "Royal Ohm",
                mpn: "CQ0558J0103T5E",
                expected_mpn: "RC0805JR-0710KL",
                package_size: "0805",
                quantity: 1,
                description: "10K Resistor 5%",
                is_alternate: false,
            },
            {
                feeder_number: "R6",
                part_number: "RDSRES1109",
                manufacturer: "Royal Ohm",
                mpn: "CQ03SAF2701T5E",
                expected_mpn: "RC0603FR-072K7L",
                package_size: "0603",
                quantity: 1,
                description: "2.7K Resistor ±1%",
                is_alternate: false,
            },
            {
                feeder_number: "R7",
                part_number: "RDSRES0985",
                manufacturer: "Royal Ohm",
                mpn: "CQ03WAF1002T5E",
                expected_mpn: "RC0603FR-0710KL",
                package_size: "0603",
                quantity: 1,
                description: "10K Resistor ±1%",
                is_alternate: false,
            },
            {
                feeder_number: "U1",
                part_number: "RDSDIOD0266",
                manufacturer: "Diodes Inc",
                mpn: "SE555QS-13",
                expected_mpn: "SE555QS-13",
                package_size: "SO-8",
                quantity: 1,
                description: "555 Timer IC",
                is_alternate: false,
            },
            {
                feeder_number: "PCB",
                part_number: "BARE PCB INTBUZ/R&D/R1.1",
                manufacturer: "In-house",
                mpn: "INTBUZ/R&D/R1.1",
                expected_mpn: "INTBUZ/R&D/R1.1",
                package_size: "1.6mm FR-4",
                quantity: 1,
                description: "Bare PCB - Intermittent Buzzer",
                is_alternate: false,
            },
        ];
        // Insert items
        for (const item of items) {
            await db.insert(bomItemsTable).values({
                bomId: bomId,
                feederNumber: item.feeder_number,
                partNumber: item.part_number,
                manufacturer: item.manufacturer,
                mpn: item.mpn,
                expectedMpn: item.expected_mpn,
                packageSize: item.package_size,
                quantity: item.quantity,
                description: item.description,
                isAlternate: item.is_alternate,
            });
        }
        process.exit(0);
    }
    catch (error) {
        process.exit(1);
    }
}
insertBuzzerBOM();
