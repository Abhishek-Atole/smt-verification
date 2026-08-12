import path from "path";
import multer from "multer";

export function sanitizeUploadFilename(filename: string): string {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = [
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];

    if (
      allowed.includes(file.mimetype) ||
      file.originalname.toLowerCase().endsWith(".csv") ||
      file.originalname.toLowerCase().endsWith(".xlsx")
    ) {
      cb(null, true);
      return;
    }

    cb(new Error("Only CSV and Excel (.xlsx) files are accepted"));
  },
}).single("file");

export function handleUpload(req: any, res: any): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadSingle(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      } else {
        if (req.file?.originalname) {
          req.file.originalname = sanitizeUploadFilename(req.file.originalname);
        }
        resolve();
      }
    });
  });
}
