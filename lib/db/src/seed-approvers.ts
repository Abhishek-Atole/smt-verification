import { db } from "../src/index";
import { approversTable } from "../src/schema";

// Seed the approver rosters that were previously hardcoded in the New
// Changeover form. Idempotent: the (category, name) unique index means
// re-running skips existing rows.
async function seedApprovers() {
  try {
    await db
      .insert(approversTable)
      .values([
        { category: "supervisor", name: "Umesh Nagile" },
        { category: "supervisor", name: "Dhupchand Bhardwaj" },
        { category: "supervisor", name: "Maruti Birader" },
        { category: "qa", name: "Ravi Patel" },
        { category: "qa", name: "Priya Singh" },
        { category: "qa", name: "Amit Kumar" },
      ])
      .onConflictDoNothing();
  } catch (error) {
    process.exit(1);
  }
}

seedApprovers().then(() => process.exit(0));
