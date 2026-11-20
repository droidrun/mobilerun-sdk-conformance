import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMOTION_EVENT, ANDROID_KEYS, CONTROL_MSG_TYPE, codeMap } from '@mobilerun/react';
import { buildControlFixtures } from './control-cases';
import { buildSignalling, buildSequence } from './signalling';
import { buildScenarios } from './scenarios';
import { EVENTS, buildPolicy } from './reconnect';
import { buildInputFixtures } from './input-cases';
import { tokenProviderFixtures } from './token-provider-cases';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const write = (rel: string, data: unknown) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};

// Regenerate from scratch so removed fixtures disappear too.
rmSync(root, { recursive: true, force: true });

for (const [kind, cases] of Object.entries(buildControlFixtures())) write(`control/${kind}.json`, { cases });
for (const [kind, cases] of Object.entries(buildInputFixtures())) write(`input/${kind}.json`, { cases });

write('constants.json', {
  control_msg_type: CONTROL_MSG_TYPE,
  amotion_event: AMOTION_EVENT,
  android_keys: ANDROID_KEYS,
  code_map: codeMap,
});

for (const [name, doc] of Object.entries(buildSignalling())) write(`signalling/${name}.json`, doc);
write('signalling/sequence.json', buildSequence());

write('reconnect/policy.json', buildPolicy());

write('reconnect/scenarios.json', {
  events: EVENTS,
  scenarios: buildScenarios(),
});

write('credentials/token-provider.json', tokenProviderFixtures);
