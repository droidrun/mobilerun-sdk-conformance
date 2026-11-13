import {
  STREAM_CONNECT_TIMEOUT_MS,
  STREAM_RECONNECT_MAX_ATTEMPTS,
  STREAM_RECONNECT_STABILITY_MS,
  STREAM_RTC_CONFIG_TIMEOUT_MS,
  STREAM_WS_OPEN_TIMEOUT_MS,
  createStreamReconnectController,
  streamReconnectDelayMs,
  type StreamReconnectController,
} from '../vendor/stream-reconnect';

// Fake-clock scheduler: timers fire in due-time order via advance().
export class FakeSchedule {
  now = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + ms, fn });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clearTimeout = (id: ReturnType<typeof setTimeout>) => {
    this.tasks.delete(id as unknown as number);
  };
  advanceTo(target: number) {
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, task] of this.tasks) {
        if (task.at <= target && task.at < dueAt) {
          dueAt = task.at;
          dueId = id;
        }
      }
      if (dueId === null) break;
      const task = this.tasks.get(dueId)!;
      this.tasks.delete(dueId);
      this.now = task.at;
      task.fn();
    }
    this.now = target;
  }
  get pendingCount() {
    return this.tasks.size;
  }
}

// random() value that makes the jitter factor exactly 1.0.
export const NO_JITTER = 0.5;

export const EVENTS = [
  'attempt_mounted',
  'connected',
  'disconnected',
  'failure',
  'wake',
  'retry',
  'disable',
  'dispose',
] as const;
export type EventName = (typeof EVENTS)[number];

export interface Expect {
  at_ms: number;
  after_steps: number;
  status: string;
  attempt: number;
  heal_calls: number;
  remount_calls: number;
  defer_target_change?: boolean;
  pending_timers?: number;
}
export interface Scenario {
  name: string;
  random: number;
  steps: { at_ms: number; event: EventName }[];
  expect: Expect[];
}

export interface Harness {
  schedule: FakeSchedule;
  controller: StreamReconnectController;
  calls: { remounts: number; heals: number };
  apply(event: EventName): void;
}

export function makeHarness(random = NO_JITTER): Harness {
  const schedule = new FakeSchedule();
  const calls = { remounts: 0, heals: 0 };
  const controller = createStreamReconnectController({
    onRemount: () => void (calls.remounts += 1),
    onHeal: () => void (calls.heals += 1),
    onSnapshot: () => {},
    schedule,
    random: () => random,
  });
  const apply = (event: EventName) => {
    switch (event) {
      case 'attempt_mounted': return controller.attemptMounted();
      case 'connected': return controller.handleConnected();
      case 'disconnected': return controller.handleDisconnected();
      case 'failure': return controller.handleFailure();
      case 'wake': return controller.handleWake();
      case 'retry': return controller.retry();
      case 'disable': return controller.setDisabled();
      case 'dispose': return controller.dispose();
    }
  };
  return { schedule, controller, calls, apply };
}

export function observe(h: Harness) {
  const s = h.controller.getSnapshot();
  return {
    status: s.status,
    attempt: s.attempt,
    heal_calls: h.calls.heals,
    remount_calls: h.calls.remounts,
  };
}

export function buildPolicy() {
  const delay = (attempt: number, random: number) => streamReconnectDelayMs(attempt, () => random);
  const attempts = [1, 2, 3, 4, 5, 6, 7, 10];
  return {
    max_attempts: STREAM_RECONNECT_MAX_ATTEMPTS,
    ws_open_timeout_ms: STREAM_WS_OPEN_TIMEOUT_MS,
    rtc_config_timeout_ms: STREAM_RTC_CONFIG_TIMEOUT_MS,
    connect_timeout_ms: STREAM_CONNECT_TIMEOUT_MS,
    stability_ms: STREAM_RECONNECT_STABILITY_MS,
    backoff: {
      base_delay_ms: 1000,
      max_delay_ms: 30000,
      formula:
        'round(min(base_delay_ms * 2^(max(1, attempt) - 1), max_delay_ms) * (0.75 + random * 0.5)); random in [0, 1), random = 1 only as the upper-bound limit case',
      rounding: 'round half toward +infinity (Math.round)',
    },
    delay_cases: attempts.flatMap((attempt) =>
      [0, NO_JITTER, 1].map((random) => ({ attempt, random, delay_ms: delay(attempt, random) })),
    ),
    invariants: ['connect_timeout_ms > ws_open_timeout_ms + rtc_config_timeout_ms'],
  };
}
