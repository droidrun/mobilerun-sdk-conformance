import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeControl, expectedWire } from '../src/decode';
import { BUILDERS, type ControlCase } from '../src/control-cases';
import { toHex } from '../src/hex';

const dir = join(import.meta.dir, '../../fixtures/control');
const kinds = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

describe('control fixtures', () => {
  test('one file per exported builder', () => {
    expect(kinds.sort()).toEqual(Object.keys(BUILDERS).sort());
  });

  for (const kind of kinds) {
    const { cases }: { cases: ControlCase[] } = JSON.parse(readFileSync(join(dir, `${kind}.json`), 'utf8'));
    describe(kind, () => {
      test('has cases with unique names and lowercase hex', () => {
        expect(cases.length).toBeGreaterThan(0);
        expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
        for (const c of cases) expect(c.hex).toMatch(/^([0-9a-f]{2})+$/);
      });

      for (const c of cases) {
        test(`round-trips: ${c.name}`, () => {
          // bytes -> wire fields equal the independently derived expectation
          expect(decodeControl(kind, c.hex)).toEqual(expectedWire(kind, c.args));
          // args -> bytes reproduces the committed hex from the pinned package
          expect(toHex(BUILDERS[kind]!(c.args))).toBe(c.hex);
        });
      }
    });
  }
});
