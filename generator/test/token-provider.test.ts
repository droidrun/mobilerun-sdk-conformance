import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tokenProviderFixtures } from '../src/token-provider-cases';

type Row = Record<string, unknown>;
type Fields = Record<string, 'number' | 'string' | 'boolean' | 'object'>;
type Case = {
  name: string;
  mode: string;
  url: string;
  static_token?: string;
  steps: (Row & { at_ms: number; event: string })[];
  expect: (Row & { at_ms: number; after_steps: number })[];
};
const serialized = readFileSync(`${import.meta.dir}/../../fixtures/credentials/token-provider.json`, 'utf8');
const fixture = JSON.parse(serialized) as { cases: Case[] } & Row;
const cases = fixture.cases;
const requiredNames = [
  'first socket and two retries mint within one heal cycle',
  'provider rejection never falls back',
  'synchronous provider throw never falls back',
  'empty provider key never falls back',
  'blank provider key never falls back',
  'provider deadline and late resolution',
  'provider deadline and late rejection',
  'stop invalidates an uncooperative provider',
  'dispose invalidates a late provider rejection',
  'parent cancellation invalidates pending provider',
  'target replacement binds the new provider and rejects stale success',
  'replacement ignores stale provider rejection',
  'callback update preserves healthy media and next attempt uses latest',
  'callback update during mint captures old callback once',
  'slow mint leaves full watchdog budget through final retry',
  '1001 connected teardown and fresh provider retry',
  '1001 connected teardown and static token reuse',
  '1006 connected provider profile regression',
  '1006 connected static profile regression',
  'secure URL replaces every token and preserves raw key and query',
  'loopback localhost is allowed',
  'loopback IPv4 is allowed',
  'loopback IPv6 is allowed',
  'insecure remote URL is rejected before callback',
  'spoofed localhost prefix is rejected before callback',
  'spoofed localhost suffix is rejected before callback',
  'localhost userinfo is not a loopback host',
  'missing secure host is rejected before callback',
  'non WebSocket scheme is rejected before callback',
  'static insecure URL handling is unchanged',
  'static empty token preserves embedded query',
  'static absent token remains absent',
  'ICE refresh reuses existing socket without mint',
  'visibility keeps keepalive bound to eventual socket',
  'wake from backoff mints a fresh key',
];

function fields(row: Row, allowed: Fields) {
  for (const [key, value] of Object.entries(row)) {
    expect(Object.keys(allowed)).toContain(key);
    expect(typeof value).toBe(allowed[key]);
  }
}

function checkStep(step: Case['steps'][number]) {
  const common: Fields = { at_ms: 'number', event: 'string' };
  const payloads: Record<string, Fields> = {
    start: { provider_throws: 'boolean', visible: 'boolean' },
    provider_resolve: { request_id: 'string', value: 'string' },
    provider_reject: { request_id: 'string' },
    socket_open: {}, config: {}, peer_connected: {}, socket_close: { code: 'number' },
    target_replace: { target: 'object' }, stop: {}, dispose: {}, parent_cancel: {},
    ICE_refresh: {}, screenshot: {}, visibility: { visible: 'boolean' }, retry: {}, wake: {},
  };
  expect(Object.keys(payloads)).toContain(step.event);
  fields(step, { ...common, ...payloads[step.event] });
  if (step.event === 'provider_resolve' || step.event === 'provider_reject') {
    expect(step.request_id).toMatch(/^p[1-9]\d*$/);
  }
  if (step.event === 'provider_resolve') expect(typeof step.value).toBe('string');
  if (step.event === 'socket_close') expect([1001, 1006]).toContain(step.code as number);
  if (step.event === 'visibility') expect(typeof step.visible).toBe('boolean');
  if (step.event !== 'target_replace') return;
  fields(step.target as Row, { id: 'string', url: 'string', provider: 'string' });
  expect(Object.keys(step.target as Row).sort()).toEqual(['id', 'provider', 'url']);
}

function checkObservation(observation: Case['expect'][number]) {
  fields(observation, {
    at_ms: 'number', after_steps: 'number', profile: 'string', provider_calls: 'number',
    socket_allocations: 'number', failures: 'number', heal_calls: 'number', status: 'string',
    last_provider: 'string', last_socket: 'object', timers: 'object', media_active: 'boolean',
    peer_released: 'boolean', channels_released: 'boolean', media_released: 'boolean',
    pending_screenshots: 'number', keepalive_active: 'boolean', keepalive_sent: 'number',
    state_unchanged_since_step: 'number',
  });
  for (const value of Object.values(observation).filter((value) => typeof value === 'number')) {
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  if (observation.profile !== undefined) expect(['react', 'native']).toContain(observation.profile as string);
  if (observation.status !== undefined) {
    expect(['connecting', 'connected', 'reconnecting', 'unavailable'])
      .toContain(observation.status as string);
  }
  for (const [timer, deadline] of Object.entries((observation.timers ?? {}) as Row)) {
    expect(['provider', 'connect', 'ws_open', 'rtc_config', 'retry']).toContain(timer);
    expect(deadline === null || Number.isInteger(deadline)).toBe(true);
    if (deadline !== null) expect(deadline as number).toBeGreaterThanOrEqual(observation.at_ms);
  }
  if (observation.last_socket === undefined) return;
  const socket = observation.last_socket as Row;
  expect(Object.keys(socket).every((key) => ['target', 'token', 'token_count', 'other_query'].includes(key)))
    .toBe(true);
  expect(typeof socket.target).toBe('string');
  expect(socket.token === null || typeof socket.token === 'string').toBe(true);
  if (socket.token_count !== undefined) expect(Number.isInteger(socket.token_count)).toBe(true);
  if (socket.other_query === undefined) return;
  expect(Array.isArray(socket.other_query)).toBe(true);
  for (const pair of socket.other_query as unknown[][]) {
    expect(pair).toHaveLength(2);
    expect(pair.every((value) => typeof value === 'string')).toBe(true);
  }
}

test('token-provider provenance and independent deadline literals are pinned', () => {
  expect(Object.keys(fixture).sort()).toEqual([
    'cases', 'connect_timeout_ms', 'provider_timeout_ms', 'reference', 'schema_version',
  ]);
  expect(fixture.schema_version).toBe(1);
  expect(fixture.provider_timeout_ms).toBe(10000);
  expect(fixture.connect_timeout_ms).toBe(45000);
  expect(fixture.reference).toEqual({
    repo: 'droidrun/mobilerun-react',
    commit: '6f139eca842def898b61146428f90bb7ef22e830',
    decision: 'D14: close 1001 immediately releases media in provider and static modes',
  });
});

test('every required case is present exactly once', () => {
  expect(new Set(cases.map((item) => item.name)).size).toBe(cases.length);
  expect(cases.map((item) => item.name).sort()).toEqual([...requiredNames].sort());
});

test.each(cases)('closed schema and replay checkpoints: $name', (item) => {
  fields(item, { name: 'string', mode: 'string', url: 'string', static_token: 'string',
    steps: 'object', expect: 'object' });
  expect(['provider', 'static']).toContain(item.mode);
  expect(typeof item.url).toBe('string');
  expect(item.steps[0]).toMatchObject({ at_ms: 0, event: 'start' });
  expect(item.expect.length).toBeGreaterThan(0);
  item.steps.forEach((step, index) => {
    checkStep(step);
    expect(Number.isInteger(step.at_ms)).toBe(true);
    expect(step.at_ms).toBeGreaterThanOrEqual(item.steps[index - 1]?.at_ms ?? 0);
  });
  item.expect.forEach((observation) => {
    checkObservation(observation);
    expect(Number.isInteger(observation.after_steps)).toBe(true);
    expect(observation.after_steps).toBeGreaterThanOrEqual(1);
    expect(observation.after_steps).toBeLessThanOrEqual(item.steps.length);
    expect(Number.isInteger(observation.at_ms)).toBe(true);
    expect(observation.at_ms).toBeGreaterThanOrEqual(item.steps[observation.after_steps - 1]!.at_ms);
    expect(observation.at_ms).toBeLessThanOrEqual(item.steps[observation.after_steps]?.at_ms ?? Infinity);
    expect(Object.keys(observation).length).toBeGreaterThan(2);
    if (observation.state_unchanged_since_step === undefined) return;
    expect(observation.state_unchanged_since_step as number).toBeLessThan(observation.after_steps);
    expect(item.expect.some((checkpoint) =>
      checkpoint.after_steps === observation.state_unchanged_since_step &&
      checkpoint.at_ms <= observation.at_ms)).toBe(true);
  });
});

test.each([
  ['provider rejection never falls back', { event: 'provider_reject' }],
  ['synchronous provider throw never falls back', { event: 'start', provider_throws: true }],
  ['empty provider key never falls back', { event: 'provider_resolve', value: '' }],
  ['blank provider key never falls back', { event: 'provider_resolve', value: ' \t\r\n ' }],
] as const)('no-fallback coverage: %s', (name, step) => {
  const item = cases.find((item) => item.name === name)!;
  expect(item.mode).toBe('provider');
  expect(item.url).toBe('wss://example.invalid/a?token=embedded-key');
  expect(item.static_token).toBe('static-key');
  expect(item.steps.at(-1)).toMatchObject(step);
  expect(item.expect[0]).toMatchObject({ provider_calls: 1, socket_allocations: 0, failures: 1 });
  expect(item.expect.at(-1)).toMatchObject({ failures: 1, status: 'reconnecting' });
});

test.each(['provider deadline and late resolution', 'provider deadline and late rejection'])(
  'deadline spans 9999, 10000 and silent late completion: %s', (name) => {
    const item = cases.find((item) => item.name === name)!;
    expect(item.expect).toContainEqual(expect.objectContaining({ at_ms: 9999, failures: 0 }));
    expect(item.expect).toContainEqual(expect.objectContaining({ at_ms: 10000, failures: 1 }));
    expect(item.steps[1]).toMatchObject({ at_ms: 10001, request_id: 'p1' });
    expect(item.expect.at(-1)).toMatchObject({
      at_ms: 10001, socket_allocations: 0, failures: 1, state_unchanged_since_step: 1,
    });
  },
);

test.each([
  ['1001 connected teardown and fresh provider retry', 7],
  ['1001 connected teardown and static token reuse', 6],
] as const)('1001 releases every resource in both modes: %s', (name, after_steps) => {
  const item = cases.find((item) => item.name === name)!;
  expect(item.steps[after_steps - 1]).toMatchObject({ event: 'socket_close', code: 1001 });
  expect(item.expect).toContainEqual(expect.objectContaining({ after_steps, peer_released: true,
    channels_released: true, media_active: false }));
  expect(item.expect).toContainEqual(expect.objectContaining({ after_steps, media_released: true,
    pending_screenshots: 0, keepalive_active: false }));
});

test('slow mint has valid handshakes and a complete final-attempt watchdog', () => {
  const name = 'slow mint leaves full watchdog budget through final retry';
  const item = cases.find((item) => item.name === name)!;
  expect(item.steps.slice(1, 4)).toEqual([
    { at_ms: 9000, event: 'provider_resolve', request_id: 'p1', value: 'key-a' },
    { at_ms: 9001, event: 'socket_open' },
    { at_ms: 9002, event: 'config' },
  ]);
  expect(item.steps.slice(19, 22)).toEqual([
    { at_ms: 394000, event: 'provider_resolve', request_id: 'p7', value: 'key-g' },
    { at_ms: 394001, event: 'socket_open' },
    { at_ms: 394002, event: 'config' },
  ]);
  expect(item.expect).toContainEqual(expect.objectContaining({ at_ms: 53999, failures: 0 }));
  expect(item.expect).toContainEqual(expect.objectContaining({ at_ms: 54000, failures: 1 }));
  expect(item.expect).toContainEqual(expect.objectContaining({ at_ms: 438999, failures: 6 }));
  expect(item.expect).toContainEqual(expect.objectContaining({ at_ms: 439000, failures: 7 }));
  expect(item.expect).toContainEqual(expect.objectContaining({ at_ms: 439000, status: 'unavailable' }));
});

test('1006 profiles are explicit and limited to historical connected closes', () => {
  const profiled = cases.filter((item) => item.expect.some((row) => row.profile !== undefined));
  expect(profiled.map((item) => item.name)).toEqual([
    '1006 connected provider profile regression', '1006 connected static profile regression',
  ]);
  expect(profiled.map((item) => [...new Set(item.expect.map((row) => row.profile))].sort()))
    .toEqual([['native', 'react'], ['native', 'react']]);
});

test('generated output equals the literal definition and serializes deterministically', () => {
  expect(fixture).toEqual(tokenProviderFixtures);
  expect(serialized).toBe(JSON.stringify(tokenProviderFixtures, null, 2) + '\n');
});
