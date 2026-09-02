import { Router, type IRouter, type Response } from "express";
import { attachActor, type AuthRequest } from "../middleware/auth";
import { getReportOutputSettings } from "../lib/reportOutputStore";

const router: IRouter = Router();

// Module 15b — read-only view of the client-folder policy for the SPA.
//
// The admin PATCH lives on /api/admin/report-output-settings behind the admin
// cookie. Operators/QA/supervisors/store need the same policy to know whether to
// write PDFs into a chosen folder, but they never hold an admin cookie — hence
// this separate GET behind attachActor (any authenticated role).
//
// Deliberately does NOT expose archiveRoot: that is a server filesystem path and
// no shop-floor client has any use for it. Leaking it would hand every logged-in
// operator a piece of the host's directory layout.
router.get("/report-output-settings", attachActor, async (_req: AuthRequest, res: Response) => {
  const s = await getReportOutputSettings();
  res.json({
    settings: {
      clientFolderEnabled: s.clientFolderEnabled,
      folderLabel: s.folderLabel,
      organizeSubfolders: s.organizeSubfolders,
    },
  });
});

export default router;
