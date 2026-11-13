import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMOTION_EVENT, ANDROID_KEYS, CONTROL_MSG_TYPE, codeMap } from '@mobilerun/react';
import { buildControlFixtures } from './control-cases';
import { buildSignalling, buildSequence } from './signalling';
import { buildScenarios } from './scenarios';
import { EVENTS, POLICY_SOURCE } from './reconnect';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const write = (rel: string, data: unknown) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};

// Regenerate from scratch so removed fixtures disappear too.
rmSync(root, { recursive: true, force: true });

for (const [kind, cases] of Object.entries(buildControlFixtures())) write(`control/${kind}.json`, cases);

write('constants.json', {
  control_msg_type: CONTROL_MSG_TYPE,
  amotion_event: AMOTION_EVENT,
  android_keys: ANDROID_KEYS,
  code_map: codeMap,
});

for (const [name, doc] of Object.entries(buildSignalling())) write(`signalling/${name}.json`, doc);
write('signalling/sequence.json', buildSequence());

const P = POLICY_SOURCE;
const delay = (attempt: number, random: number) => P.streamReconnectDelayMs(attempt, () => random);
const attempts = [1, 2, 3, 4, 5, 6, 7, 10];
write('reconnect/policy.json', {
  max_attempts: P.STREAM_RECONNECT_MAX_ATTEMPTS,
  ws_open_timeout_ms: P.STREAM_WS_OPEN_TIMEOUT_MS,
  rtc_config_timeout_ms: P.STREAM_RTC_CONFIG_TIMEOUT_MS,
  connect_timeout_ms: P.STREAM_CONNECT_TIMEOUT_MS,
  stability_ms: P.STREAM_RECONNECT_STABILITY_MS,
  backoff: {
    base_delay_ms: 1000,
    max_delay_ms: 30000,
    formula: 'round(min(base_delay_ms * 2^(max(1, attempt) - 1), max_delay_ms) * (0.75 + random * 0.5)); random in [0, 1)',
    rounding: 'round half toward +infinity (Math.round)',
  },
  delay_cases: attempts.flatMap((attempt) =>
    [0, 0.5, 1].map((random) => ({ attempt, random, delay_ms: delay(attempt, random) })),
  ),
  invariants: ['connect_timeout_ms > ws_open_timeout_ms + rtc_config_timeout_ms'],
});

write('reconnect/scenarios.json', {
  events: EVENTS,
  scenarios: buildScenarios(),
});
