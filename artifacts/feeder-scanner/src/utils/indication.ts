/**
 * Central scan-indication layer: distinct success/error buzzers, a looping
 * "same scan rejected 3x" alarm, an on-screen LED state, and a hardware-bridge
 * seam. This consolidates the scattered Web-Audio calls into one place so every
 * scan site gives identical feedback.
 *
 * Hardware bridge ("both now"): every LED/alarm change dispatches a
 * `smt-indicator` CustomEvent and, if `localStorage.indicator_url` is set,
 * fires a best-effort POST. A future USB-relay / Arduino / network tower-light
 * agent can subscribe to either without any change to call sites.
 */
import { create } from "zustand";
import { logger } from "../lib/logger";
import { unlockAudio } from "./buzzer-sounds";

export type LedState = "idle" | "ok" | "fail" | "alarm";

/** Consecutive rejects of the same scanned value before the alarm escalates. */
export const ALARM_STRIKES = 3;

interface IndicationState {
  led: LedState;
  alarmActive: boolean;
  alarmMessage: string | null;
  set: (partial: Partial<Pick<IndicationState, "led" | "alarmActive" | "alarmMessage">>) => void;
}

export const useIndicationStore = create<IndicationState>((set) => ({
  led: "idle",
  alarmActive: false,
  alarmMessage: null,
  set: (partial) => set(partial),
}));

// ---- hardware bridge seam --------------------------------------------------
function emitIndicator(led: LedState, alarmActive: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("smt-indicator", { detail: { led, alarmActive } }));
    const url = localStorage.getItem("indicator_url");
    if (url) {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ led, alarmActive }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch (error) {
    logger.debug("emitIndicator failed", error);
  }
}

function setLed(led: LedState, alarmActive?: boolean): void {
  const state = useIndicationStore.getState();
  const nextAlarm = alarmActive ?? state.alarmActive;
  useIndicationStore.setState({ led, alarmActive: nextAlarm });
  emitIndicator(led, nextAlarm);
}

// ---- audio -----------------------------------------------------------------
let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function tone(ctx: AudioContext, freq: number, start: number, durMs: number, gain: number, type: OscillatorType): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + durMs / 1000);
  osc.connect(env);
  env.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durMs / 1000 + 0.02);
}

/** Bright, cheerful ascending major arpeggio ("ta-da") + green LED. */
export function signalSuccess(): void {
  setLed("ok");
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // C5 → E5 → G5 → C6 major arpeggio: unmistakably "success" and nothing like
  // the harsh low error buzzer.
  tone(ctx, 523.25, now, 110, 0.28, "triangle");
  tone(ctx, 659.25, now + 0.1, 110, 0.28, "triangle");
  tone(ctx, 783.99, now + 0.2, 110, 0.28, "triangle");
  tone(ctx, 1046.5, now + 0.3, 220, 0.32, "triangle");
}

/** Strong, harsh, low buzzer — deliberately unlike success — + red LED. */
export function signalError(): void {
  setLed("fail");
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Two harsh low sawtooth pulses, louder than success.
  tone(ctx, 180, now, 220, 0.42, "sawtooth");
  tone(ctx, 150, now + 0.26, 260, 0.45, "sawtooth");
}

// ---- continuous alarm ------------------------------------------------------
let alarmOsc: OscillatorNode | null = null;
let alarmGain: GainNode | null = null;
let alarmTimer: ReturnType<typeof setInterval> | null = null;

/** Looping klaxon that rings until stopAlarm() is called. */
export function startAlarm(message: string): void {
  useIndicationStore.setState({ alarmMessage: message });
  setLed("alarm", true);

  if (alarmOsc) return; // already ringing

  const ctx = getContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(700, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();

  // Alternate pitch + gate the gain for a pulsing emergency tone.
  let high = false;
  alarmTimer = setInterval(() => {
    if (!alarmGain || !alarmOsc) return;
    const t = ctx.currentTime;
    high = !high;
    alarmOsc.frequency.setValueAtTime(high ? 900 : 600, t);
    alarmGain.gain.setValueAtTime(0.55, t);
    alarmGain.gain.setValueAtTime(0.0001, t + 0.22);
  }, 300);

  alarmOsc = osc;
  alarmGain = gain;
}

/** Silences the continuous alarm and clears the alarm LED/overlay. */
export function stopAlarm(): void {
  if (alarmTimer) {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }
  if (alarmGain && audioContext) {
    alarmGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  }
  if (alarmOsc) {
    try {
      alarmOsc.stop();
    } catch {
      /* already stopped */
    }
    alarmOsc.disconnect();
    alarmOsc = null;
  }
  alarmGain = null;
  useIndicationStore.setState({ alarmMessage: null });
  setLed("idle", false);
}

// ---- strike tracking -------------------------------------------------------
const strikes = new Map<string, number>();

const normalizeKey = (key: string) => key.trim().toUpperCase();

/** Clear the consecutive-fail counter (for a key, or all). */
export function resetStrikes(key?: string): void {
  if (key) strikes.delete(normalizeKey(key));
  else strikes.clear();
}

/**
 * Record a scan result and drive the buzzer/LED. A passing scan clears that
 * key's counter and beeps success; a failing scan buzzes and, on the
 * ALARM_STRIKES-th consecutive reject of the SAME value, starts the alarm.
 * Returns whether the alarm fired.
 */
export function registerScanResult(key: string, ok: boolean, alarmMessage?: string): { alarm: boolean } {
  unlockAudio();
  const k = normalizeKey(key || "");

  if (ok) {
    if (k) strikes.delete(k);
    signalSuccess();
    return { alarm: false };
  }

  const count = (k ? strikes.get(k) ?? 0 : 0) + 1;
  if (k) strikes.set(k, count);

  if (count >= ALARM_STRIKES) {
    startAlarm(alarmMessage ?? `Scan "${key}" rejected ${count} times. Verify the component or call a supervisor.`);
    return { alarm: true };
  }

  signalError();
  return { alarm: false };
}
