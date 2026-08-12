type FeedbackType = "success" | "error" | "warning";

let audioContext: AudioContext | null = null;

const getAudioContext = async (): Promise<AudioContext | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
};

const createTone = (
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  durationMs: number,
  gain = 0.1,
  type: OscillatorType = "sine",
) => {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  envelope.gain.setValueAtTime(0.0001, startTime);
  envelope.gain.exponentialRampToValueAtTime(gain, startTime + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + durationMs / 1000);

  oscillator.connect(envelope);
  envelope.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + durationMs / 1000 + 0.02);
};

export const playSuccessBeep = () => {
  void (async () => {
    try {
      const ctx = await getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // Pleasant short success chime: two ascending tones
      createTone(ctx, 660, now, 120, 0.08, "sine");
      createTone(ctx, 880, now + 0.14, 100, 0.08, "sine");
    } catch (error) {
      // ignore
    }
  })();
};

export const playErrorBuzzer = () => {
  // Replace harsh buzzer with a short, subtle two-tone error chime
  void (async () => {
    try {
      const ctx = await getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // soft low tone then a slightly higher confirmation tone
      createTone(ctx, 220, now, 120, 0.06, "sine");
      createTone(ctx, 330, now + 0.14, 100, 0.06, "sine");
    } catch (error) {
      // swallow errors silently
    }
  })();
};

export const playWarningTone = () => {
  void (async () => {
    try {
      const ctx = await getAudioContext();
      if (!ctx) {
        return;
      }

      createTone(ctx, 550, ctx.currentTime, 300, 0.1, "square");
    } catch (error) {
    }
  })();
};

const playFeedback = (type: FeedbackType) => {
  if (type === "success") {
    playSuccessBeep();
    return;
  }

  if (type === "warning") {
    playWarningTone();
    return;
  }

  playErrorBuzzer();
};

export default playFeedback;
