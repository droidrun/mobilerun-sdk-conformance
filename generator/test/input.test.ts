import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { useScrcpyInput } from '@mobilerun/react';
import type { Args } from '../src/control-cases';
import { decodeControl } from '../src/decode';
import { toHex } from '../src/hex';
import { buildInputFixtures } from '../src/input-cases';
import { mapPoint, routeIme, type Message } from '../src/input';

// The locked React peer runtimes let this server-rendered probe run without DOM/type packages.
const createElement: (component: () => null) => unknown = require('react').createElement;
const renderToString: (element: unknown) => string = require('react-dom/server').renderToString;
const fixtures = buildInputFixtures();
const kindByType: Record<number, string> = {
  0: 'keycode', 1: 'text', 2: 'touch', 3: 'scroll', 9: 'set-clipboard', 21: 'hover',
};
function decode(m: Message): { kind: string } & Args {
  const kind = kindByType[parseInt(m.hex.slice(0, 2), 16)]!;
  return { kind, ...decodeControl(kind, m.hex) };
}
const keyWire = (action: number, keycode: number, metaState = 0) =>
  ({ kind: 'keycode', action, keycode, repeat: 0, metaState });
const keyOutput = (name: string) => fixtures.keys.find((c) => c.name === name)!.expect.map(decode);
const pointerOutput = (name: string) => fixtures.pointers.find((c) => c.name === name)!.expect.map(decode);

describe('input fixtures', () => {
  for (const [kind, cases] of Object.entries(fixtures)) {
    test(`${kind} regenerates with unique names`, () => {
      const path = `${import.meta.dir}/../../fixtures/input/${kind}.json`;
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ cases });
      expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
    });
  }
  for (const kind of ['keys', 'ime', 'pointers', 'scroll'] as const) {
    test(`${kind} messages have valid hex, layouts and channels`, () => {
      for (const c of fixtures[kind]) {
        for (const m of c.expect) {
          expect(m.hex).toMatch(/^([0-9a-f]{2})+$/);
          const decoded = decode(m); // Independent decoder validates frame headers, sizes and UTF-8.
          expect(m.channel).toBe(decoded.kind === 'hover' ? 'hover' : 'control');
        }
      }
      if (kind === 'scroll') {
        for (const name of ['outside left', 'outside right', 'outside top',
          'outside bottom', 'video not ready']) {
          expect(fixtures.scroll.find((c) => c.name === name)!.expect).toEqual([]);
        }
        expect(fixtures.scroll.find((c) => c.name === 'origin inclusive')!.expect.length).toBe(1);
        expect(fixtures.scroll.find((c) => c.name === 'buttons and bounds')!.expect.length).toBe(1);
      }
    });
  }

  test('derived React divergences equal the labelled SDK-decision sequences', async () => {
    const previous = ['window', 'document', 'navigator'].map((key) =>
      [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    let clipboard = '';
    const sent: Message[] = [];
    const video = {};
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: {} },
      document: { configurable: true, value: { activeElement: video } },
      navigator: { configurable: true, value: { clipboard: { readText: async () => clipboard } } },
    });
    const divergent: string[] = [];
    try {
      for (const c of fixtures.keys) {
        sent.length = 0;
        let handlers!: ReturnType<typeof useScrcpyInput>;
        renderToString(createElement(() => {
          handlers = useScrcpyInput({
            containerRef: { current: null }, videoRef: { current: video },
            dataChannelRef: { current: {
              readyState: 'open', send: (bytes: ArrayBuffer) =>
                sent.push({ channel: 'control', hex: toHex(bytes) }),
            } },
            hoverChannelRef: { current: null },
          } as unknown as Parameters<typeof useScrcpyInput>[0]);
          return null;
        }));
        for (const e of c.events) {
          clipboard = e.clipboard;
          handlers.handleKeyboard({
            type: e.type, code: e.code, key: e.key,
            shiftKey: e.shift, altKey: e.alt, ctrlKey: e.ctrl, metaKey: e.meta,
            getModifierState: (name: string) => name === 'CapsLock' && e.caps_lock,
            preventDefault() {}, stopPropagation() {}, target: { tagName: 'VIDEO' },
          } as Parameters<typeof handlers.handleKeyboard>[0]);
          await Promise.resolve(); // Resolve clipboard reads before the next input event.
        }
        if (JSON.stringify(sent) !== JSON.stringify(c.expect)) divergent.push(c.name);
      }
    } finally {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
    const labelled = fixtures.keys.filter((c) => c.sdk_decisions.length > 0).map((c) => c.name);
    expect(divergent.sort()).toEqual(labelled.sort());
  });

  test('tracked releases use keyup metadata and never emit orphan UPs', () => {
    expect(keyOutput('alt released before fallback letter')).toEqual([
      keyWire(0, 57, 2), keyWire(0, 29, 2), keyWire(1, 57), keyWire(1, 29),
    ]);
    expect(keyOutput('cross modifier release uses current metadata')).toEqual([
      keyWire(0, 113, 4096), keyWire(0, 57, 4098), keyWire(0, 29, 4098),
      keyWire(1, 113, 2), keyWire(1, 29, 2), keyWire(1, 57),
    ]);
    expect(keyOutput('text before ctrl has no orphan up')).toEqual([
      { kind: 'text', text: 'a' }, keyWire(0, 113, 4096), keyWire(1, 113),
    ]);
    expect(keyOutput('orphan control up ignored')).toEqual([]);
    expect(keyOutput('repeat down and duplicate up')).toEqual([
      keyWire(0, 21), keyWire(0, 21), keyWire(1, 21),
    ]);
    expect(keyOutput('context menu fallback')).toEqual([keyWire(0, 82), keyWire(1, 82)]);
  });

  test('shortcuts match produced key and suppress letter UP in either release order', () => {
    for (const [modifier, keycode, meta] of [['ctrl', 113, 4096], ['meta', 117, 65536]] as const) {
      for (const value of ['v', 'm']) {
        for (const first of ['letter', 'modifier']) {
          const shortcut = value === 'v'
            ? [{ kind: 'set-clipboard', text: 'héllo\n😀', paste: true }]
            : [keyWire(0, 82), keyWire(1, 82)];
          expect(keyOutput(`${modifier} ${value} ${first} released first`)).toEqual([
            keyWire(0, keycode, meta), ...shortcut, keyWire(1, keycode),
          ]);
        }
      }
    }
    expect(keyOutput('ctrl paste matches key not code'))
      .toEqual([{ kind: 'set-clipboard', text: 'text', paste: true }]);
    expect(keyOutput('ctrl menu matches key not code')).toEqual([keyWire(0, 82), keyWire(1, 82)]);
    expect(keyOutput('ctrl period on v code is keycode'))
      .toEqual([keyWire(0, 50, 4096), keyWire(1, 50, 4096)]);
    expect(keyOutput('ctrl period on m code is keycode'))
      .toEqual([keyWire(0, 41, 4096), keyWire(1, 41, 4096)]);
  });

  test('one grapheme is text, while named keys and multiple graphemes stay keys', () => {
    for (const [name, text] of [
      ['emoji grapheme', '😀'], ['emoji unknown code grapheme', '😀'],
      ['emoji zwj grapheme', '👨‍👩‍👧‍👦'], ['emoji skin tone grapheme', '👍🏽'],
      ['nfd grapheme', 'e\u0301'],
    ]) expect(keyOutput(name!)).toEqual([{ kind: 'text', text: text! }]);
    expect(keyOutput('multiple graphemes fallback')).toEqual([keyWire(0, 29), keyWire(1, 29)]);
    expect(keyOutput('enter')).toEqual([keyWire(0, 66), keyWire(1, 66)]);
  });

  test('IME commit and finalized composition share splitting and control dropping', () => {
    const text = 'é😀\r\na\tb\u0000\u0085c\nd\r';
    const expected = [
      { kind: 'text', text: 'é😀' }, keyWire(0, 66), keyWire(1, 66),
      { kind: 'text', text: 'a' }, keyWire(0, 61), keyWire(1, 61),
      { kind: 'text', text: 'bc' }, keyWire(0, 66), keyWire(1, 66),
      { kind: 'text', text: 'd' }, keyWire(0, 66), keyWire(1, 66),
    ];
    for (const operation of ['commit', 'composition_end'] as const) {
      expect(routeIme({ operation, text }).map(decode)).toEqual(expected);
    }
    expect(routeIme({ operation: 'delete', composition_text: '' }).map(decode))
      .toEqual([keyWire(0, 67), keyWire(1, 67)]);
    expect(routeIme({ operation: 'delete', composition_text: 'a' })).toEqual([]);
  });

  test('pointer slots, last positions, primary buttons and concurrent hover', () => {
    expect(pointerOutput('lowest free slot reused').map((m) => [m.action, m.pointerId, m.x, m.y]))
      .toEqual([
        [0, 0, 10, 20], [0, 1, 30, 40], [1, 0, 10, 20],
        [0, 0, 50, 60], [3, 1, 30, 40], [1, 0, 50, 60],
      ]);
    const capacity = pointerOutput('ten slots capacity and recovery');
    expect(capacity.slice(0, 10).map((m) => m.pointerId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(capacity.slice(10, 12).map((m) => [m.action, m.pointerId])).toEqual([[1, 3], [0, 3]]);
    expect(capacity.length).toBe(22);
    expect(pointerOutput('outside movement release at last inside').map((m) => [m.action, m.x, m.y]))
      .toEqual([[0, 10, 20], [2, 20, 30], [1, 20, 30]]);
    for (const [button, mask] of [[1, 4], [2, 2]]) {
      expect(pointerOutput(`nonprimary button ${button} hover only`)).toEqual([
        { kind: 'hover', videoWidth: 1080, videoHeight: 2400, x: 30, y: 40, buttons: mask },
      ]);
    }
    expect(pointerOutput('nonprimary up does not end primary gesture').map((m) => m.action))
      .toEqual([0, 2, 1]);
    expect(pointerOutput('hover while touch slot active').map((m) =>
      [m.kind, m.kind === 'hover' ? m.buttons : m.pointerId]))
      .toEqual([['touch', 0], ['hover', 6], ['touch', 0], ['touch', 0]]);
  });

  test('geometry returns hand-checked upright dimensions and inclusive mapped points', () => {
    const expected: Record<string, [number, number, number, number] | null> = {
      'matching aspect center': [1080, 2400, 540, 1200],
      'pillarbox center': [100, 200, 50, 100],
      'pillarbox x 249': null, 'pillarbox x 250': [100, 200, 0, 100],
      'pillarbox x 750': [100, 200, 100, 100], 'pillarbox x 751': null,
      'letterbox center': [200, 100, 100, 50],
      'letterbox y 249': null, 'letterbox y 250': [200, 100, 100, 0],
      'letterbox y 750': [200, 100, 100, 100], 'letterbox y 751': null,
      'fractional point': [400, 200, 20.5, 41.5],
      'rotation 0 center': [200, 100, 100, 50], 'rotation 90 center': [100, 200, 50, 100],
      'rotation 180 center': [200, 100, 100, 50], 'rotation 270 center': [100, 200, 50, 100],
      'rotation 0 offset': [200, 100, 100, 10], 'rotation 90 offset': [100, 200, 50, 60],
      'rotation 180 offset': [200, 100, 100, 10], 'rotation 270 offset': [100, 200, 50, 60],
      'zero view width': null, 'zero view height': null,
      'zero video width': null, 'zero video height rotated': null, 'negative point': null,
    };
    for (const [name, point] of Object.entries(expected)) {
      expect(mapPoint(fixtures.geometry.find((c) => c.name === name)!), name).toEqual(point === null
        ? null : { width: point[0], height: point[1], x: point[2], y: point[3] });
    }
  });
});
