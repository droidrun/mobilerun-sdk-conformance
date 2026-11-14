import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { useScrcpyInput } from '@mobilerun/react';
import { BUILDERS, toHex, type Args } from '../src/control-cases';
import { decodeControl, expectedWire } from '../src/decode';
import { buildInputFixtures } from '../src/input-cases';
import { mapPoint, routeIme, routePointers, type Message } from '../src/input';

// The peer runtimes are already locked; avoid adding DOM/type packages for this server-rendered probe.
const createElement: (component: () => null) => unknown = require('react').createElement;
const renderToString: (element: unknown) => string = require('react-dom/server').renderToString;
const fixtures = buildInputFixtures();
const kindByType: Record<number, string> = { 0: 'keycode', 1: 'text', 2: 'touch', 3: 'scroll', 9: 'set-clipboard', 21: 'hover' };
function decode(m: Message): { kind: string } & Args {
  const kind = kindByType[parseInt(m.hex.slice(0, 2), 16)]!;
  return { kind, ...decodeControl(kind, m.hex) };
}

describe('input fixtures', () => {
  for (const [kind, data] of Object.entries(fixtures)) {
    test(`${kind} regenerates with unique names`, () => {
      const committed = JSON.parse(readFileSync(`${import.meta.dir}/../../fixtures/input/${kind}.json`, 'utf8'));
      expect(committed).toEqual(data);
      expect(new Set(data.cases.map((c) => c.name)).size).toBe(data.cases.length);
    });
  }
  for (const [kind, data] of Object.entries(fixtures)) {
    if (kind === 'geometry') continue;
    test(`${kind} messages decode and re-encode`, () => {
      for (const c of data.cases) {
        for (const m of c.expect as Message[]) {
          expect(m.hex).toMatch(/^([0-9a-f]{2})+$/);
          const { kind: messageKind, ...args } = decode(m);
          expect(m.channel).toBe(messageKind === 'hover' ? 'hover' : 'control');
          if (messageKind === 'touch') args.pressure = (Number(args.pressure) & 0xffff) / 0xffff;
          if (messageKind === 'scroll') {
            args.hscrollTicks = Number(args.hscrollTicks) / 2048;
            args.vscrollTicks = Number(args.vscrollTicks) / 2048;
          }
          expect(toHex(BUILDERS[messageKind]!(args))).toBe(m.hex);
        }
      }
    });
  }

  test('all keyboard cases match the actual React hook', async () => {
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
    try {
      let handlers!: ReturnType<typeof useScrcpyInput>;
      renderToString(createElement(() => {
        handlers = useScrcpyInput({
          containerRef: { current: null }, videoRef: { current: video },
          dataChannelRef: { current: { readyState: 'open', send: (bytes: ArrayBuffer) =>
            sent.push({ channel: 'control', hex: toHex(bytes) }) } },
          hoverChannelRef: { current: null },
        } as unknown as Parameters<typeof useScrcpyInput>[0]);
        return null;
      }));
      for (const c of fixtures.keys.cases) {
        sent.length = 0;
        clipboard = c.clipboard;
        handlers.handleKeyboard({
          type: c.type, code: c.code, key: c.key,
          shiftKey: c.shift, altKey: c.alt, ctrlKey: c.ctrl, metaKey: c.meta,
          getModifierState: (name: string) => name === 'CapsLock' && c.caps_lock,
          preventDefault() {}, stopPropagation() {}, target: { tagName: 'VIDEO' },
        } as Parameters<typeof handlers.handleKeyboard>[0]);
        await Promise.resolve(); // Clipboard read resolves before comparing the complete output.
        expect(sent, c.name).toEqual(c.expect);
      }
    } finally {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  test('IME commit splits CRLF once, routes tab, drops controls and preserves Unicode', () => {
    const out = routeIme({ operation: 'commit', text: 'é😀\r\na\tb\u0000\u0085c\nd\r' }).map(decode);
    expect(out).toEqual([
      { kind: 'text', text: 'é😀' },
      { kind: 'keycode', action: 0, keycode: 66, repeat: 0, metaState: 0 },
      { kind: 'keycode', action: 1, keycode: 66, repeat: 0, metaState: 0 },
      { kind: 'text', text: 'a' },
      { kind: 'keycode', action: 0, keycode: 61, repeat: 0, metaState: 0 },
      { kind: 'keycode', action: 1, keycode: 61, repeat: 0, metaState: 0 },
      { kind: 'text', text: 'bc' },
      { kind: 'keycode', action: 0, keycode: 66, repeat: 0, metaState: 0 },
      { kind: 'keycode', action: 1, keycode: 66, repeat: 0, metaState: 0 },
      { kind: 'text', text: 'd' },
      { kind: 'keycode', action: 0, keycode: 66, repeat: 0, metaState: 0 },
      { kind: 'keycode', action: 1, keycode: 66, repeat: 0, metaState: 0 },
    ]);
    expect(routeIme({ operation: 'delete', text: '' }).map(decode)).toEqual([
      { kind: 'keycode', action: 0, keycode: 67, repeat: 0, metaState: 0 },
      { kind: 'keycode', action: 1, keycode: 67, repeat: 0, metaState: 0 },
    ]);
    expect(routeIme({ operation: 'composition_end', text: 'a\t\nb' }).map(decode))
      .toEqual([{ kind: 'text', text: 'a\t\nb' }]);
  });

  test('pointer slots remain stable, release at last position and reuse lowest free slot', () => {
    const c = fixtures.pointers.cases.find((c) => c.name === 'lowest free slot reused')!;
    expect(c.expect.map(decode).map((m) => [m.action, m.pointerId, m.x, m.y])).toEqual([
      [0, 0, 10, 20], [0, 1, 30, 40], [1, 0, 10, 20],
      [0, 0, 50, 60], [3, 1, 30, 40], [1, 0, 50, 60],
    ]);
    const capacity = fixtures.pointers.cases.find((c) => c.name === 'ten slots capacity and recovery')!;
    const messages = capacity.expect.map(decode);
    expect(messages.slice(0, 10).map((m) => m.pointerId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(messages[10]!.action).toBe(1);
    expect(messages[10]!.pointerId).toBe(3);
    expect(messages[11]!.action).toBe(0);
    expect(messages[11]!.pointerId).toBe(3);
    expect(messages.length).toBe(22);
    const outside = fixtures.pointers.cases.find((c) => c.name === 'outside movement release at last inside')!;
    expect(outside.expect.map(decode).map((m) => [m.action, m.x, m.y]))
      .toEqual([[0, 10, 20], [2, 20, 30], [1, 20, 30]]);
  });

  test('hover uses its own channel and preserves the button mask', () => {
    const c = fixtures.pointers.cases.find((c) => c.name === 'mouse hover drag hover channels')!;
    expect(c.expect.map((m) => m.channel)).toEqual(['hover', 'control', 'control', 'control', 'hover']);
    expect(c.expect.map(decode).map((m) => [m.kind, m.kind === 'hover' ? 'none' : m.pointerId, m.buttons]))
      .toEqual([['hover', 'none', 2], ['touch', -1, 1], ['touch', -1, 1], ['touch', -1, 1], ['hover', 'none', 0]]);
    expect(routePointers({ video_width: 100, video_height: 100, events: [
      { type: 'move', id: 0, x: -1, y: 10, mouse: true, buttons: 0 },
    ] })).toEqual([]);
  });

  test('geometry has hand-checked edges, letterbox rejection and upright rotations', () => {
    const expected: Record<string, { x: number; y: number } | null> = {
      'matching aspect center': { x: 540, y: 1200 },
      'pillarbox left outside': null, 'pillarbox left edge': { x: 0, y: 0 },
      'pillarbox right edge': { x: 100, y: 200 }, 'pillarbox right outside': null,
      'letterbox top outside': null, 'letterbox top edge': { x: 0, y: 0 },
      'letterbox bottom edge': { x: 200, y: 100 }, 'letterbox bottom outside': null,
      'fractional point': { x: 20.5, y: 41.5 },
      'rotation 0 center': { x: 100, y: 50 }, 'rotation 90 center': { x: 50, y: 100 },
      'rotation 180 center': { x: 100, y: 50 }, 'rotation 270 center': { x: 50, y: 100 },
      'rotation 0 offset': { x: 100, y: 10 }, 'rotation 90 offset': { x: 50, y: 60 },
      'rotation 180 offset': { x: 100, y: 10 }, 'rotation 270 offset': { x: 50, y: 60 },
      'zero view width': null, 'zero view height': null,
      'zero video width': null, 'zero video height rotated': null, 'negative point': null,
    };
    for (const [name, point] of Object.entries(expected)) {
      expect(mapPoint(fixtures.geometry.cases.find((c) => c.name === name)!), name).toEqual(point);
    }
  });

  test('scroll tick conversion matches the independent wire specification', () => {
    for (const c of fixtures.scroll.cases) {
      const expected = expectedWire('scroll', {
        videoWidth: c.video_width, videoHeight: c.video_height,
        x: c.x, y: c.y, hscrollTicks: c.h, vscrollTicks: c.v, buttons: c.buttons,
      });
      // Signed zero is a JavaScript arithmetic detail, not a wire distinction.
      expected.hscrollTicks = Number(expected.hscrollTicks) + 0;
      expected.vscrollTicks = Number(expected.vscrollTicks) + 0;
      expect(decodeControl('scroll', c.expect[0]!.hex)).toEqual(expected);
    }
    const half = fixtures.scroll.cases.find((c) => c.name === 'negative half quantum')!;
    expect(decode(half.expect[0]!).hscrollTicks).toBe(0);
  });
});
