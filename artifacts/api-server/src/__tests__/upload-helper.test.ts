import { describe, expect, test } from "vitest";
import { sanitizeUploadFilename } from "../middleware/upload";

describe("sanitizeUploadFilename", () => {
  test("drops path segments and replaces unsafe characters", () => {
    expect(sanitizeUploadFilename("../bad folder/scan report (final).csv")).toBe("scan_report__final_.csv");
  });

  test("keeps safe characters intact", () => {
    expect(sanitizeUploadFilename("annexure_01.xlsx")).toBe("annexure_01.xlsx");
  });
});
