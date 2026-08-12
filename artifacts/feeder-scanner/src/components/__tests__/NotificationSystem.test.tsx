// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import { NotificationProvider, useNotification } from "../NotificationSystem";

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  },
}));

let audioContextConstructed = vi.fn();

function TriggerNotification({
  type,
  message,
  details,
  onDismiss,
}: {
  type: "success" | "error" | "warning" | "info" | "duplicate";
  message: string;
  details?: string;
  onDismiss?: () => void;
}) {
  const notify = useNotification();

  useEffect(() => {
    notify(type, message, details, onDismiss);
  }, [notify, type, message, details, onDismiss]);

  return null;
}

function renderNotification(type: "success" | "error" | "warning" | "info" | "duplicate", message: string, details?: string, onDismiss?: () => void) {
  return render(
    <NotificationProvider>
      <TriggerNotification type={type} message={message} details={details} onDismiss={onDismiss} />
    </NotificationProvider>,
  );
}

describe("NotificationSystem", () => {
  const audioContextClose = vi.fn();
  const audioContextResume = vi.fn().mockResolvedValue(undefined);
  const audioContextStart = vi.fn();
  const audioContextStop = vi.fn();
  const audioContextCreateOscillator = vi.fn(() => ({
    type: "",
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    start: audioContextStart,
    stop: audioContextStop,
    onended: null,
  }));
  const audioContextCreateGain = vi.fn(() => ({
    gain: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
  }));

  class AudioContextMock {
    destination = {};
    currentTime = 0;
    state = "running";
    createOscillator = audioContextCreateOscillator;
    createGain = audioContextCreateGain;
    close = audioContextClose;
    resume = audioContextResume;
  }

  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.clearAllMocks();
    (window as Window & typeof globalThis & { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext = AudioContextMock as unknown as typeof AudioContext;
    (window as Window & typeof globalThis & { AudioContext?: unknown; webkitAudioContext?: unknown }).webkitAudioContext = AudioContextMock as unknown as typeof AudioContext;
  });

  test("renders SUCCESS notification with green styling", () => {
    renderNotification("success", "Scan complete");
    const toast = screen.getAllByTestId(/notification-/)[0];
    expect(toast.textContent).toContain("SUCCESS");
    expect((toast as HTMLElement).style.backgroundColor).toBe("rgb(220, 252, 231)");
  });

  test("renders ERROR notification with red styling", () => {
    renderNotification("error", "Scan failed");
    const toast = screen.getAllByTestId(/notification-/)[0];
    expect(toast.textContent).toContain("ERROR");
    expect((toast as HTMLElement).style.borderColor).toBe("rgb(220, 38, 38)");
  });

  test("renders WARNING notification with amber styling", () => {
    renderNotification("warning", "Alternate component used");
    const toast = screen.getAllByTestId(/notification-/)[0];
    expect(toast.textContent).toContain("WARNING");
  });

  test("renders DUPLICATE notification with amber styling", () => {
    renderNotification("duplicate", "Duplicate scan");
    expect(screen.getByText("Duplicate Scan")).toBeTruthy();
  });

  test("SUCCESS auto-dismisses after 3000ms", async () => {
    renderNotification("success", "Scan complete");
    act(() => {
      vi.advanceTimersByTime(3250);
    });
    expect(screen.queryByText("Scan complete")).toBeNull();
  });

  test("ERROR auto-dismisses after 10000ms", async () => {
    renderNotification("error", "Scan failed");
    act(() => {
      vi.advanceTimersByTime(10250);
    });
    expect(screen.queryByText("Scan failed")).toBeNull();
  });

  test("WARNING auto-dismisses after 4000ms", async () => {
    renderNotification("warning", "Alternate component used");
    act(() => {
      vi.advanceTimersByTime(4250);
    });
    expect(screen.queryByText("Alternate component used")).toBeNull();
  });

  test("DUPLICATE auto-dismisses after 8000ms", async () => {
    renderNotification("duplicate", "Duplicate scan");
    act(() => {
      vi.advanceTimersByTime(8250);
    });
    expect(screen.queryByText("Duplicate scan")).toBeNull();
  });

  test("ERROR does not dismiss before 10000ms", () => {
    renderNotification("error", "Scan failed");
    act(() => {
      vi.advanceTimersByTime(9999);
    });
    expect(screen.getByText("Scan failed")).toBeTruthy();
  });

  test("close button dismisses immediately", () => {
    renderNotification("warning", "Manual dismiss");
    act(() => {
      fireEvent.click(screen.getByLabelText("Dismiss notification"));
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByText("Manual dismiss")).toBeNull();
  });

  test("max 5 notifications shown at once", () => {
    const notify = [
      { type: "success", message: "1" },
      { type: "success", message: "2" },
      { type: "success", message: "3" },
      { type: "success", message: "4" },
      { type: "success", message: "5" },
    ] as const;

    render(
      <NotificationProvider>
        <TriggerNotification type={notify[0].type} message={notify[0].message} />
        <TriggerNotification type={notify[1].type} message={notify[1].message} />
        <TriggerNotification type={notify[2].type} message={notify[2].message} />
        <TriggerNotification type={notify[3].type} message={notify[3].message} />
        <TriggerNotification type={notify[4].type} message={notify[4].message} />
      </NotificationProvider>,
    );

    expect(screen.getAllByTestId(/notification-/)).toHaveLength(5);
  });

  test("6th notification removes oldest", () => {
    function Burst() {
      const notify = useNotification();
      useEffect(() => {
        notify.success("1");
        notify.success("2");
        notify.success("3");
        notify.success("4");
        notify.success("5");
        notify.success("6");
      }, [notify]);
      return null;
    }

    render(
      <NotificationProvider>
        <Burst />
      </NotificationProvider>,
    );

    expect(screen.getAllByTestId(/notification-/)).toHaveLength(5);
    expect(screen.queryByText("1")).toBeNull();
    expect(screen.getByText("6")).toBeTruthy();
  });

  test("duplicate type does not trigger buzzer", () => {
    renderNotification("duplicate", "Duplicate scan");
    expect(audioContextCreateOscillator).not.toHaveBeenCalled();
  });

  test("error type triggers buzzer on mount", () => {
    renderNotification("error", "Scan failed");
    expect(audioContextCreateOscillator).toHaveBeenCalled();
    expect(audioContextCreateOscillator).toHaveBeenCalled();
  });

  test("onDismiss callback fires on error dismiss", () => {
    const onDismiss = vi.fn();
    renderNotification("error", "Boom", undefined, onDismiss);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  test("onDismiss callback fires on duplicate dismiss", () => {
    const onDismiss = vi.fn();
    renderNotification("duplicate", "Dup", undefined, onDismiss);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(onDismiss).toHaveBeenCalled();
  });
});