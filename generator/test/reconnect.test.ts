import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replay, EVENTS, type Scenario } from '../src/reconnect';

const dir = join(import.meta.dir, '../../fixtures/reconnect');
const policy = JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8'));
const { events, scenarios } = JSON.parse(readFileSync(join(dir, 'scenarios.json'), 'utf8')) as {
  events: string[];
  scenarios: Scenario[];
};

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
