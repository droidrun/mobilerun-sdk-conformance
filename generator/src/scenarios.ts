// Every case of stream-reconnect.test.ts (React 0.2.1) expressed as data.
// Each scenario is written the way the original test reads: the hand-written
// `expect` values below are copied from the test's assertions and are verified
// against the reference controller while recording; fields the original test
// does not assert are filled in from the reference controller.
import {
  STREAM_CONNECT_TIMEOUT_MS as WATCHDOG,
  STREAM_RECONNECT_MAX_ATTEMPTS as MAX,
  STREAM_RECONNECT_STABILITY_MS as STABILITY,
  streamReconnectDelayMs,
} from '../vendor/stream-reconnect';
import { NO_JITTER, makeHarness, observe, type EventName, type Expect, type Scenario } from './reconnect';

// Backoff delay for the given attempt, without jitter (the function caps at 30 s).
const delay = (attempt: number) => streamReconnectDelayMs(attempt, () => NO_JITTER);

type Want = Partial<{
  status: string;
  attempt: number;
  heals: number;
  remounts: number;
  defer: boolean;
  pending: number;
}>;

class Rec {
  private h = makeHarness(NO_JITTER);
  private sc: Scenario;
  constructor(name: string) {
    this.sc = { name, random: NO_JITTER, steps: [], expect: [] };
  }
  get now() {
    return this.h.schedule.now;
  }
  get remounts() {
    return this.h.calls.remounts;
  }
  do(event: EventName) {
    this.sc.steps.push({ at_ms: this.now, event });
    this.h.apply(event);
  }
  advance(ms: number) {
    this.h.schedule.advanceTo(this.now + ms);
  }
  expect(want: Want) {
    const got = observe(this.h);
    const check = (k: string, a: unknown, b: unknown) => {
      if (a !== undefined && a !== b) throw new Error(`${this.sc.name}: ${k} want ${a} got ${b} @${this.now}`);
    };
    check('status', want.status, got.status);
    check('attempt', want.attempt, got.attempt);
    check('heals', want.heals, got.heal_calls);
    check('remounts', want.remounts, got.remount_calls);
    const e: Expect = { at_ms: this.now, after_steps: this.sc.steps.length, ...got };
    if (want.defer !== undefined) {
      const d = this.h.controller.shouldDeferTargetChange();
      check('defer', want.defer, d);
      e.defer_target_change = d;
    }
    if (want.pending !== undefined) {
      check('pending', want.pending, this.h.schedule.pendingCount);
      e.pending_timers = this.h.schedule.pendingCount;
    }
    this.sc.expect.push(e);
  }
  done() {
    return this.sc;
  }
}

function scenario(name: string, fn: (r: Rec) => void): Scenario {
  const r = new Rec(name);
  fn(r);
  return r.done();
}

// Drives the controller to 'unavailable' the way the original tests do.
function exhaust(r: Rec, from = 0) {
  for (let i = from; i <= MAX; i++) {
    r.do('failure');
    r.advance(delay(i + 1));
    if (i < MAX) r.do('attempt_mounted');
  }
}

export function buildScenarios(): Scenario[] {
  const S: Scenario[] = [];
  const add = (name: string, fn: (r: Rec) => void) => S.push(scenario(name, fn));

  add('connect watchdog › an attempt that never connects fails after the timeout and schedules a retry', (r) => {
    r.do('attempt_mounted');
    r.expect({ status: 'connecting', attempt: 0 });
    r.advance(WATCHDOG);
    r.expect({ status: 'reconnecting', attempt: 1, heals: 1, remounts: 0 });
    r.advance(delay(1));
    r.expect({ remounts: 1, status: 'reconnecting', attempt: 1 });
  });

  add('connect watchdog › terminal failure signal retries faster than the watchdog', (r) => {
    r.do('attempt_mounted');
    r.advance(100);
    r.do('failure');
    r.expect({ status: 'reconnecting', attempt: 1 });
    r.advance(delay(1));
    r.expect({ remounts: 1 });
  });

  add('backoff escalation and exhaustion › consecutive failures escalate delays and end unavailable', (r) => {
    r.do('attempt_mounted');
    for (let i = 0; i < MAX; i++) {
      r.do('failure');
      r.expect({ status: 'reconnecting', attempt: i + 1 });
      r.advance(delay(i + 1) - 1);
      r.expect({ remounts: i });
      r.advance(1);
      r.expect({ remounts: i + 1 });
      r.do('attempt_mounted');
    }
    r.do('failure');
    r.expect({ status: 'unavailable', attempt: MAX + 1 });
    r.advance(10 * 60_000);
    r.expect({ remounts: MAX, heals: 1 });
  });

  add('backoff escalation and exhaustion › failure signals collapse into one backoff step per attempt', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.do('failure');
    r.do('disconnected');
    r.expect({ attempt: 1 });
  });

  add('disconnect handling › non-connected states during negotiation are not failures', (r) => {
    r.do('attempt_mounted');
    r.do('disconnected');
    r.do('disconnected');
    r.expect({ status: 'connecting', attempt: 0 });
  });

  add('disconnect handling › a drop after connecting counts and reconnects', (r) => {
    r.do('attempt_mounted');
    r.do('connected');
    r.expect({ status: 'connected', attempt: 0 });
    r.do('disconnected');
    r.expect({ status: 'reconnecting', attempt: 1 });
    r.advance(delay(1));
    r.expect({ remounts: 1 });
  });

  add('disconnect handling › a stable connection refills the retry budget', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.advance(delay(1));
    r.do('attempt_mounted');
    r.do('failure');
    r.advance(delay(2));
    r.do('attempt_mounted');
    r.do('connected');
    r.expect({ status: 'connected', attempt: 2 });
    r.advance(STABILITY);
    r.expect({ status: 'connected', attempt: 0 });
    r.do('disconnected');
    r.expect({ status: 'reconnecting', attempt: 1 });
  });

  add('disconnect handling › a quick drop before stability keeps escalating', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.advance(delay(1));
    r.do('attempt_mounted');
    r.do('connected');
    r.advance(1000);
    r.do('disconnected');
    r.expect({ status: 'reconnecting', attempt: 2 });
  });

  add('disconnect handling › self-recovery during a backoff wait cancels the pending remount', (r) => {
    r.do('attempt_mounted');
    r.do('connected');
    r.do('disconnected');
    r.expect({ status: 'reconnecting' });
    r.do('connected');
    r.expect({ status: 'connected' });
    r.advance(60_000);
    r.expect({ remounts: 0 });
  });

  add('wake and manual retry › wake during a backoff wait retries immediately', (r) => {
    r.do('attempt_mounted');
    r.do('connected');
    r.do('disconnected');
    r.do('failure');
    r.expect({ remounts: 0 });
    r.do('wake');
    r.expect({ remounts: 1 });
    r.do('attempt_mounted');
    r.do('connected');
    r.advance(60_000);
    r.expect({ remounts: 1, status: 'connected', attempt: 0 });
  });

  add('wake and manual retry › wake while unavailable starts a fresh cycle', (r) => {
    r.do('attempt_mounted');
    exhaust(r);
    r.expect({ status: 'unavailable' });
    const before = r.remounts;
    r.do('wake');
    r.expect({ status: 'reconnecting', attempt: 0, remounts: before + 1 });
    r.do('attempt_mounted');
    r.do('connected');
    r.expect({ status: 'connected' });
  });

  add("wake and manual retry › retry() only acts when unavailable", (r) => {
    r.do('attempt_mounted');
    r.do('retry');
    r.expect({ remounts: 0, status: 'connecting' });
  });

  add('wake and manual retry › wake while connected is a no-op', (r) => {
    r.do('attempt_mounted');
    r.do('connected');
    r.do('wake');
    r.expect({ remounts: 0, status: 'connected' });
  });

  add('target changes › applies target changes immediately while connected or connecting', (r) => {
    r.do('attempt_mounted');
    r.expect({ defer: false });
    r.do('connected');
    r.expect({ defer: false });
  });

  add('target changes › defers target changes during a backoff wait and while unavailable', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.expect({ defer: true });
    r.advance(delay(1));
    r.do('attempt_mounted');
    exhaust(r, 1);
    r.expect({ status: 'unavailable', defer: true });
  });

  add('target changes › applies credentials that arrive after the backoff to the in-flight retry', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.expect({ defer: true });
    r.advance(delay(1));
    r.do('attempt_mounted');
    r.expect({ defer: false, status: 'reconnecting', attempt: 1 });
  });

  add('target changes › applies credentials that arrive after wake to the in-flight fresh cycle', (r) => {
    r.do('attempt_mounted');
    exhaust(r);
    r.expect({ status: 'unavailable' });
    r.do('wake');
    r.do('attempt_mounted');
    r.expect({ defer: false });
  });

  add('target changes › a rotation remount flips connected back to connecting', (r) => {
    r.do('attempt_mounted');
    r.do('connected');
    r.do('attempt_mounted');
    r.expect({ status: 'connecting', attempt: 0 });
  });

  add('disable and dispose › disabling stops timers and resets state', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.do('disable');
    r.expect({ status: 'connecting', attempt: 0 });
    r.advance(10 * 60_000);
    r.expect({ remounts: 0 });
    r.do('failure');
    r.expect({ status: 'connecting', attempt: 0 });
  });

  add('disable and dispose › dispose clears all pending timers', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.do('dispose');
    r.expect({ pending: 0 });
  });

  add('disable and dispose › a StrictMode-style mount during a wait does not disturb it', (r) => {
    r.do('attempt_mounted');
    r.do('connected');
    r.do('disconnected');
    r.do('attempt_mounted');
    r.advance(delay(1) - 1);
    r.expect({ remounts: 0 });
    r.advance(1);
    r.expect({ remounts: 1 });
  });

  add('heal cadence › one heal per recovery cycle, again after stability reset and on wake', (r) => {
    r.do('attempt_mounted');
    r.do('failure');
    r.expect({ heals: 1 });
    r.advance(delay(1));
    r.do('attempt_mounted');
    r.do('failure');
    r.expect({ heals: 1 });
    r.advance(delay(2));
    r.do('attempt_mounted');
    r.do('connected');
    r.advance(STABILITY);
    r.do('disconnected');
    r.expect({ heals: 2 });
    for (let i = 1; i < MAX + 1; i++) {
      r.advance(delay(i + 1));
      r.do('attempt_mounted');
      r.do('failure');
    }
    r.expect({ status: 'unavailable', heals: 2 });
    r.do('wake');
    r.expect({ heals: 3 });
    r.do('attempt_mounted');
    r.do('failure');
    r.expect({ status: 'reconnecting', attempt: 1, heals: 3 });
  });

  return S;
}
