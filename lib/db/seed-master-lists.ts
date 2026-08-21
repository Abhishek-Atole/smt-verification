import { db } from "./src/index";
import { masterListsTable } from "./src/schema";

// Seed common QA master values (defect types + machines) so the Ref.Sheet,
// Pareto defect axis and 7.5 Defect Details dropdowns are populated out of the
// box. Idempotent: the (category, value) unique index means re-running skips
// existing rows.
async function seedMasterLists() {
  try {
    await db
      .insert(masterListsTable)
      .values([
        { category: "defect_type", value: "Missing Component" },
        { category: "defect_type", value: "Wrong Component" },
        { category: "defect_type", value: "Wrong Polarity" },
        { category: "defect_type", value: "Solder Bridge" },
        { category: "defect_type", value: "Insufficient Solder" },
        { category: "defect_type", value: "Excess Solder" },
        { category: "defect_type", value: "Tombstoning" },
        { category: "defect_type", value: "Misalignment / Shift" },
        { category: "defect_type", value: "Lifted Lead" },
        { category: "defect_type", value: "Solder Ball" },
        { category: "defect_type", value: "Cold Joint" },
        { category: "defect_type", value: "Component Damage" },
        { category: "machine", value: "SPI" },
        { category: "machine", value: "AOI-Top" },
        { category: "machine", value: "AOI-Bottom" },
        { category: "machine", value: "Reflow Oven" },
        { category: "machine", value: "Pick & Place" },
      ])
      .onConflictDoNothing();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

seedMasterLists().then(() => process.exit(0));
