import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS, makeHarness, observe, type Scenario } from '../src/reconnect';

const dir = join(import.meta.dir, '../../fixtures/reconnect');
const policy = JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8'));
const { events, scenarios } = JSON.parse(readFileSync(join(dir, 'scenarios.json'), 'utf8')) as {
  events: string[];
  scenarios: Scenario[];
};

/** Replays a scenario as documented in the README. Returns the first mismatch or null. */
function replay(sc: Scenario): string | null {
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
      if (!Bun.deepEquals(got, want)) {
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

describe('reconnect fixtures', () => {
  test('policy invariants hold', () => {
    expect(policy.connect_timeout_ms).toBeGreaterThan(policy.ws_open_timeout_ms + policy.rtc_config_timeout_ms);
  });

  test('backoff formula reproduces every delay case', () => {
    const b = policy.backoff;
    for (const c of policy.delay_cases) {
      const base = Math.min(b.base_delay_ms * 2 ** (Math.max(1, c.attempt) - 1), b.max_delay_ms);
      expect(Math.round(base * (0.75 + c.random * 0.5))).toBe(c.delay_ms);
    }
  });

  test('event vocabulary is closed', () => {
    expect(events).toEqual([...EVENTS]);
    for (const s of scenarios) for (const st of s.steps) expect(EVENTS).toContain(st.event);
  });

  test('scenario names are unique and times are monotonic', () => {
    expect(new Set(scenarios.map((s) => s.name)).size).toBe(scenarios.length);
    for (const s of scenarios) {
      for (let i = 1; i < s.steps.length; i++) expect(s.steps[i]!.at_ms).toBeGreaterThanOrEqual(s.steps[i - 1]!.at_ms);
    }
  });

  for (const s of scenarios) {
    test(`replays: ${s.name}`, () => {
      expect(replay(s)).toBeNull();
    });
  }
});
