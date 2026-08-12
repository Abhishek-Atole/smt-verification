/**
 * Buzzer Sound Generator and Manager
 * Provides different buzzer sounds for various alert priority levels
 */
import { logger } from "../lib/logger";

export type AlertPriority = 'critical' | 'high' | 'medium' | 'low';
export type AlertType = 'error' | 'duplicate' | 'warning' | 'success';

interface BuzzerConfig {
  frequency: number;
  duration: number;
  pattern: number[]; // [on, off, on, off, ...]
  volume: number;
}

const BUZZER_CONFIGS: Record<AlertPriority, BuzzerConfig> = {
  critical: {
    frequency: 1000, // High frequency
    duration: 500,
    pattern: [200, 100, 200, 100, 200, 100], // Short rapid pulses
    volume: 1.0,
  },
  high: {
    frequency: 800,
    duration: 400,
    pattern: [300, 150, 300, 150], // Medium pulses
    volume: 0.9,
  },
  medium: {
    frequency: 600,
    duration: 300,
    pattern: [400, 200, 400], // Slower pulses
    volume: 0.7,
  },
  low: {
    frequency: 400,
    duration: 200,
    pattern: [500], // Single tone
    volume: 0.5,
  },
};

const PRIORITY_BY_TYPE: Record<AlertType, AlertPriority> = {
  error: 'high',
  duplicate: 'medium',
  warning: 'medium',
  success: 'low',
};

/**
 * Plays a buzzer sound for the given priority level
 */
export async function playBuzzer(priority: AlertPriority = 'medium'): Promise<void> {
  if (typeof window === 'undefined' || !window.AudioContext) {
    return;
  }

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const config = BUZZER_CONFIGS[priority];

    let currentTime = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = config.frequency;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Set initial volume
    gainNode.gain.setValueAtTime(0, currentTime);

    // Apply pattern (on/off pulses)
    let patternTime = currentTime;
    for (let i = 0; i < config.pattern.length; i++) {
      const isOn = i % 2 === 0;
      const duration = config.pattern[i] / 1000; // Convert ms to seconds

      if (isOn) {
        gainNode.gain.setValueAtTime(config.volume, patternTime);
      } else {
        gainNode.gain.setValueAtTime(0, patternTime);
      }

      patternTime += duration;
    }

    // Fade out
    gainNode.gain.setValueAtTime(0, patternTime);

    // Start and stop
    oscillator.start(currentTime);
    oscillator.stop(patternTime);

    // Resume audio context if needed
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
  } catch (error) {
    logger.debug("playBuzzer error", error);
  }
}

/**
 * Plays a buzzer sound based on alert type
 */
export function playBuzzerForType(type: AlertType): void {
  const priority = PRIORITY_BY_TYPE[type];
  playBuzzer(priority);
}

/**
 * Plays a buzzer sound with custom parameters
 */
export async function playCustomBuzzer(
  frequency: number = 600,
  duration: number = 300,
  volume: number = 0.5
): Promise<void> {
  if (typeof window === 'undefined' || !window.AudioContext) {
    return;
  }

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    const startTime = audioContext.currentTime;
    const endTime = startTime + duration / 1000;

    gainNode.gain.setValueAtTime(volume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, endTime);

    oscillator.start(startTime);
    oscillator.stop(endTime);

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
  } catch (error) {
    logger.debug("playCustomBuzzer error", error);
  }
}

/**
 * Plays a double-beep sound (for success scenarios)
 */
export async function playDoubleBuzzer(): Promise<void> {
  if (typeof window === 'undefined' || !window.AudioContext) {
    return;
  }

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const startTime = audioContext.currentTime;

    // First beep
    {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = 800;
      osc.connect(gain);
      gain.connect(audioContext.destination);
      gain.gain.setValueAtTime(0.7, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
      osc.start(startTime);
      osc.stop(startTime + 0.1);
    }

    // Second beep
    {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.frequency.value = 1000;
      osc.connect(gain);
      gain.connect(audioContext.destination);
      gain.gain.setValueAtTime(0.7, startTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.25);
      osc.start(startTime + 0.15);
      osc.stop(startTime + 0.25);
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
  } catch (error) {
    logger.debug("playDoubleBuzzer error", error);
  }
}

/**
 * Attempts to unlock audio context if it's suspended
 * Call this on user interaction
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch((error) => {
        logger.warn('[BuzzerSounds] Failed to resume audio context', error);
      });
    }
  } catch (error) {
    logger.warn('[BuzzerSounds] Web Audio API unavailable', error);
  }
}
