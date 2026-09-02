// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ALARM_STRIKES,
  registerScanResult,
  resetStrikes,
  signalError,
  signalSuccess,
  stopAlarm,
  useIndicationStore,
} from "../indication";

const started: number[] = [];

class AudioContextMock {
  destination = {};
  currentTime = 0;
  state = "running";
  resume = vi.fn().mockResolvedValue(undefined);
  createOscillator() {
    return {
      type: "",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(() => started.push(1)),
      stop: vi.fn(),
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  started.length = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = AudioContextMock;
  stopAlarm();
  resetStrikes();
});

describe("indication layer", () => {
  test("signalSuccess sets the green LED and plays tones", () => {
    signalSuccess();
    expect(useIndicationStore.getState().led).toBe("ok");
    expect(started.length).toBeGreaterThan(0);
  });

  test("signalError sets the red LED and plays tones", () => {
    signalError();
    expect(useIndicationStore.getState().led).toBe("fail");
    expect(started.length).toBeGreaterThan(0);
  });

  test("a passing scan reports no alarm and clears its strike counter", () => {
    expect(registerScanResult("F1", false).alarm).toBe(false);
    expect(registerScanResult("F1", true).alarm).toBe(false);
    // counter was cleared, so it takes a full ALARM_STRIKES run to escalate again
    for (let i = 1; i < ALARM_STRIKES; i += 1) {
      expect(registerScanResult("F1", false).alarm).toBe(false);
    }
    expect(registerScanResult("F1", false).alarm).toBe(true);
  });

  test("ALARM_STRIKES consecutive rejects of the same key start the alarm", () => {
    for (let i = 1; i < ALARM_STRIKES; i += 1) {
      expect(registerScanResult("F2", false).alarm).toBe(false);
      expect(useIndicationStore.getState().alarmActive).toBe(false);
    }
    expect(registerScanResult("F2", false).alarm).toBe(true);
    const state = useIndicationStore.getState();
    expect(state.alarmActive).toBe(true);
    expect(state.led).toBe("alarm");
    expect(state.alarmMessage).toContain("F2");
  });

  test("strikes are per-key, so different keys do not accumulate together", () => {
    for (let i = 0; i < ALARM_STRIKES; i += 1) {
      expect(registerScanResult(`KEY-${i}`, false).alarm).toBe(false);
    }
    expect(useIndicationStore.getState().alarmActive).toBe(false);
  });

  test("keys are matched case-insensitively and trimmed", () => {
    registerScanResult("abc", false);
    registerScanResult(" ABC ", false);
    expect(registerScanResult("Abc", false).alarm).toBe(true);
  });

  test("stopAlarm silences the alarm and returns the LED to idle", () => {
    for (let i = 0; i < ALARM_STRIKES; i += 1) registerScanResult("F3", false);
    expect(useIndicationStore.getState().alarmActive).toBe(true);
    stopAlarm();
    const state = useIndicationStore.getState();
    expect(state.alarmActive).toBe(false);
    expect(state.led).toBe("idle");
    expect(state.alarmMessage).toBeNull();
  });

  test("resetStrikes(key) makes the next reject start from one", () => {
    for (let i = 1; i < ALARM_STRIKES; i += 1) registerScanResult("F4", false);
    resetStrikes("F4");
    expect(registerScanResult("F4", false).alarm).toBe(false);
  });

  test("every LED change emits a smt-indicator event for the hardware bridge", () => {
    const seen: Array<{ led: string; alarmActive: boolean }> = [];
    const handler = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("smt-indicator", handler);
    signalSuccess();
    signalError();
    window.removeEventListener("smt-indicator", handler);
    expect(seen.map((d) => d.led)).toEqual(["ok", "fail"]);
  });
});
