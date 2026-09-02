import { pgTable, boolean, text, timestamp } from "drizzle-orm/pg-core";

// Module 15b — where report PDFs land. Single-row config (id is always TRUE,
// same pattern as security_settings) edited from the admin dashboard.
//
// Two independent destinations, because they have different reach:
//
//   • CLIENT folder (client_folder_*) — the operator's own PC. A browser cannot
//     be handed a path; the File System Access API only yields an opaque
//     directory handle from a user gesture, and that handle is per-browser and
//     non-serializable. So this row carries POLICY only (on/off, subfolder
//     layout, and a human label naming the folder each site should pick). Each
//     PC's admin clicks "Choose folder" once; the handle is kept in that
//     browser's IndexedDB, never here.
//
//   • SERVER archive (archive_*) — the API host's own disk, written by
//     report-archive-service.ts. A real path, because the server can honour one.
//     Overrides REPORT_ARCHIVE_ROOT so the admin can change it without editing
//     .env and restarting.
export const reportOutputSettingsTable = pgTable("report_output_settings", {
  id: boolean("id").primaryKey().default(true), // always true — enforces single row

  // Client-side folder policy. folderLabel is advisory: it tells the local admin
  // which folder to pick, it is NOT a path and nothing resolves it.
  clientFolderEnabled: boolean("client_folder_enabled").notNull().default(false),
  folderLabel: text("folder_label"),
  organizeSubfolders: boolean("organize_subfolders").notNull().default(true),

  // Server-side archive. Absolute path on the API host; blank/null → disabled.
  archiveEnabled: boolean("archive_enabled").notNull().default(false),
  archiveRoot: text("archive_root"),

  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReportOutputSettings = typeof reportOutputSettingsTable.$inferSelect;
