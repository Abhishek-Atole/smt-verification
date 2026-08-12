import { createHmac } from "crypto";

function encodeQrField(value: string | null | undefined) {
  return encodeURIComponent(value ?? "");
}

export function buildQrPayload(program: {
  id: string;
  programName: string;
  stage: string;
  version: string;
  machineId?: string | null;
}) {
  return [
    "SMT-PROG",
    encodeQrField(program.id),
    encodeQrField(program.programName),
    encodeQrField(program.stage),
    encodeQrField(program.version),
    encodeQrField(program.machineId),
  ].join("|");
}

export function signQrPayload(payload: string) {
  const secret = process.env.QR_SIGNING_KEY;
  if (!secret) {
    throw new Error("QR_SIGNING_KEY is not configured");
  }

  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function buildQrFields(program: {
  id: string;
  programName: string;
  stage: string;
  version: string;
  machineId?: string | null;
}) {
  const qrPayload = buildQrPayload(program);
  return {
    qrPayload,
    qrHash: signQrPayload(qrPayload),
  };
}

export default { buildQrPayload, signQrPayload, buildQrFields };
