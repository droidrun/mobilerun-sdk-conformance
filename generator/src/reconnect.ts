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

export function makeHarness(random = 0.5): Harness {
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

/** Replays a scenario as documented in the README. Returns the first mismatch or null. */
export function replay(sc: Scenario): string | null {
  const h = makeHarness(sc.random);
  let i = 0;
  const check = () => {
    const wants = sc.expect.filter((e) => e.after_steps === i).sort((a, b) => a.at_ms - b.at_ms);
    for (const e of wants) {
      h.schedule.advanceTo(e.at_ms);
      const got: Record<string, unknown> = observe(h);
      if (e.defer_target_change !== undefined) got.defer_target_change = h.controller.shouldDeferTargetChange();
      if (e.pending_timers !== undefined) got.pending_timers = h.schedule.pendingCount;
      const { at_ms: _a, after_steps: _s, ...want } = e;
      if (JSON.stringify(sortKeys(got)) !== JSON.stringify(sortKeys(want))) {
        return `expect at ${e.at_ms}ms after ${i} steps: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`;
      }
    }
    return null;
  };
  for (;;) {
    const bad = check();
    if (bad) return bad;
    if (i >= sc.steps.length) return null;
    const st = sc.steps[i]!;
    h.schedule.advanceTo(st.at_ms);
    h.apply(st.event);
    i += 1;
  }
}

const sortKeys = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export const POLICY_SOURCE = {
  STREAM_CONNECT_TIMEOUT_MS,
  STREAM_RECONNECT_MAX_ATTEMPTS,
  STREAM_RECONNECT_STABILITY_MS,
  STREAM_RTC_CONFIG_TIMEOUT_MS,
  STREAM_WS_OPEN_TIMEOUT_MS,
  streamReconnectDelayMs,
};
