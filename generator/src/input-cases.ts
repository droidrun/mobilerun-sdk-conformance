import {
  mapPoint, routeIme, routeKey, routePointers, routeScroll,
  type GeometryInput, type ImeInput, type KeyEvent, type PointerEvent,
  type PointerSequence, type ScrollInput,
} from './input';

type Named<T> = T & { name: string };
const key = (name: string, code: string, value: string, flags: Partial<KeyEvent> = {}): Named<KeyEvent>[] =>
  (['keydown', 'keyup'] as const).map((type) => ({
    name: `${name} ${type}`, type, code, key: value, shift: false, alt: false,
    ctrl: false, meta: false, caps_lock: false, clipboard: '', ...flags,
  }));

const keys = [
  ...['a', 'A', 'é', '中', ' ', '!', '\u0000', '\u0001', '\t', '\n', '\r', '\u001b', '\u007f', '\u0085']
    .flatMap((value) => key(`single character U+${value.charCodeAt(0).toString(16).padStart(4, '0')}`, 'KeyA', value)),
  ...key('unknown code printable', 'Unidentified', 'a'),
  ...key('unknown code control character', 'Unidentified', '\u0001'),
  ...key('unknown code nontext', 'Unidentified', 'Unidentified'),
  ...key('unknown code named control', 'Unidentified', 'Enter'),
  ...key('unknown code ctrl combo', 'Unidentified', 'a', { ctrl: true }),
  ...key('uppercase f control heuristic', 'KeyF', 'F', { shift: true }),
  ...key('dead key mapped fallback', 'Quote', 'Dead'),
  ...key('dead key unknown fallback', 'Unidentified', 'Dead'),
  ...key('emoji utf16 fallback', 'KeyA', '😀'),
  ...key('emoji unknown fallback', 'Unidentified', '😀'),
  ...key('empty key fallback', 'KeyA', ''),
  ...key('combining text fallback', 'KeyE', 'e\u0301'),
  ...key('caps lock fallback', 'CapsLock', 'CapsLock'),
  ...key('context menu fallback', 'ContextMenu', 'ContextMenu'),
  ...key('numpad no text fallback', 'Numpad1', 'Unidentified'),
  ...key('numpad decimal no text fallback', 'NumpadDecimal', ''),
  ...key('alt no char fallback', 'KeyA', '', { alt: true }),
  ...key('alt caps no char fallback', 'KeyC', '', { alt: true, caps_lock: true }),
  ...['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'Home', 'End', 'PageUp', 'PageDown',
    'Insert', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    .flatMap((code) => key(code.toLowerCase(), code, code)),
  ...key('numpad enter', 'NumpadEnter', 'Enter'),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`).flatMap((code) => key(code.toLowerCase(), code, code)),
  ...['Shift', 'Control', 'Alt', 'Meta'].flatMap((modifier) =>
    ['Left', 'Right'].flatMap((side) => key(`${modifier.toLowerCase()} ${side.toLowerCase()}`,
      modifier + side, modifier, {
        shift: modifier === 'Shift', alt: modifier === 'Alt',
        ctrl: modifier === 'Control', meta: modifier === 'Meta',
      }))),
  ...['ctrl', 'meta'].flatMap((modifier) => [
    ...key(`${modifier} paste`, 'KeyV', 'v', { [modifier]: true, clipboard: 'héllo\n😀' }),
    ...key(`${modifier} uppercase paste`, 'KeyV', 'V', { [modifier]: true, shift: true, clipboard: 'text' }),
    ...key(`${modifier} empty paste`, 'KeyV', 'v', { [modifier]: true }),
    ...key(`${modifier} menu`, 'KeyM', 'm', { [modifier]: true, shift: true, alt: true }),
  ]),
  // All four modifier combinations, plus CapsLock XOR for letter codes.
  ...Array.from({ length: 16 }, (_, mask) => [false, true].flatMap((caps_lock) =>
    key(`modifier mask ${mask} caps ${caps_lock}`, 'KeyC', 'c', {
      shift: !!(mask & 1), alt: !!(mask & 2), ctrl: !!(mask & 4), meta: !!(mask & 8), caps_lock,
    }))).flat(),
  ...key('caps lock nonletter', 'Digit1', 'Unidentified', { caps_lock: true, ctrl: true }),
  ...key('caps lock nonletter shift', 'Digit1', 'Unidentified', { caps_lock: true, shift: true, ctrl: true }),
  ...key('alt printable', 'KeyQ', '@', { alt: true }),
];

const ime: Named<ImeInput>[] = [
  ...[
    ['empty', ''], ['ascii', 'hello'], ['unicode', 'é中😀e\u0301'],
    ['lf', '\n'], ['cr', '\r'], ['crlf', '\r\n'], ['tab', '\t'],
    ['mixed', 'a\r\nb\rc\nd\te'], ['consecutive breaks', '\r\n\r\n\n\r\t\t'],
    ['c0 controls dropped', 'a\u0000\u0001\u0008\u001bb'],
    ['del and c1 dropped', 'a\u007f\u0085\u009fb'],
    ['only dropped controls', '\u0000\u001f\u007f\u009f'],
    ['controls between separators', 'a\u0000\tb\u007f\nc'],
    ['unicode line separators printable', 'a\u2028b\u2029c'],
    ['lone surrogate replacement', 'a\ud83d\tb'],
  ].map(([name, text]) => ({ name: name!, operation: 'commit' as const, text: text! })),
  { name: 'empty buffer delete', operation: 'delete', text: '' },
  { name: 'nonempty buffer delete stays local', operation: 'delete', text: 'a' },
  { name: 'composition update stays local', operation: 'composition_update', text: 'に' },
  { name: 'composition finalized', operation: 'composition_end', text: '日本語😀' },
  { name: 'composition finalized unsplit', operation: 'composition_end', text: 'a\t\nb' },
  { name: 'composition empty', operation: 'composition_end', text: '' },
];

const point = (type: PointerEvent['type'], id: number, x: number, y: number,
  mouse = false, buttons = 0): PointerEvent => ({ type, id, x, y, mouse, buttons });
const sequence = (name: string, events: PointerEvent[], video_width = 1080, video_height = 2400): Named<PointerSequence> =>
  ({ name, video_width, video_height, events });
const pointers = [
  sequence('single touch last position', [point('down', 42, 100, 200), point('move', 42, 110, 220), point('up', 42, 900, 900)]),
  sequence('two fingers independent slots', [point('down', 42, 100, 200), point('down', 7, 300, 400),
    point('move', 42, 120, 220), point('up', 7, 0, 0), point('up', 42, 0, 0)]),
  sequence('lowest free slot reused', [point('down', 8, 10, 20), point('down', 9, 30, 40),
    point('up', 8, 0, 0), point('down', 10, 50, 60), point('cancel', 9, 0, 0), point('up', 10, 0, 0)]),
  sequence('outside down ignored', [point('down', 4, -1, 20), point('move', 4, 10, 20), point('up', 4, 10, 20)]),
  sequence('outside movement release at last inside', [point('down', 4, 10, 20), point('move', 4, 20, 30),
    point('move', 4, 1081, 30), point('up', 4, 1081, 30)]),
  sequence('cancel last position', [point('down', 4, 10, 20), point('move', 4, 20, 30),
    point('cancel', 4, -1, -1), point('up', 4, 0, 0)]),
  sequence('mouse hover drag hover channels', [point('move', 99, 10, 20, true, 2),
    point('down', 99, 10, 20, true, 1), point('move', 99, 30, 40, true, 1),
    point('up', 99, 900, 900, true), point('move', 99, 50, 60, true)]),
  sequence('mouse and finger independent', [point('down', 5, 10, 20), point('down', 5, 30, 40, true),
    point('up', 5, 0, 0, true), point('cancel', 5, 0, 0)]),
  sequence('hover outside ignored', [point('move', 0, -1, 0, true), point('move', 0, 1081, 0, true),
    point('move', 0, 1080, 2400, true, 6)]),
  sequence('unmatched touch events', [point('move', 77, 10, 20), point('up', 77, 10, 20), point('cancel', 77, 10, 20)]),
  sequence('duplicate down ignored', [point('down', 77, 10, 20), point('down', 77, 30, 40), point('up', 77, 30, 40)]),
  sequence('inclusive bounds and rounding', [point('down', 1, 0, 0), point('move', 1, 2.5, 3.49),
    point('move', 1, 1080, 2400), point('up', 1, 0, 0)]),
  sequence('ten slots capacity and recovery', [
    ...Array.from({ length: 11 }, (_, i) => point('down', 100 + i, i * 10, i * 20)),
    point('up', 110, 0, 0), point('up', 103, 0, 0), point('down', 110, 80, 90),
    ...Array.from({ length: 11 }, (_, i) => point('cancel', 100 + i, -1, -1)),
  ]),
  sequence('video not ready', [point('down', 1, 0, 0), point('move', 0, 0, 0, true)], 0, 0),
];

const geometry = (name: string, view_width: number, view_height: number,
  video_width: number, video_height: number, x: number, y: number,
  rotation: GeometryInput['rotation'] = 0): Named<GeometryInput> =>
  ({ name, view_width, view_height, video_width, video_height, rotation, x, y });
const geometries = [
  geometry('matching aspect center', 540, 1200, 1080, 2400, 270, 600),
  geometry('pillarbox center', 1000, 1000, 100, 200, 500, 500),
  geometry('pillarbox left outside', 1000, 1000, 100, 200, 249, 500),
  geometry('pillarbox left edge', 1000, 1000, 100, 200, 250, 0),
  geometry('pillarbox right edge', 1000, 1000, 100, 200, 750, 1000),
  geometry('pillarbox right outside', 1000, 1000, 100, 200, 751, 500),
  geometry('letterbox center', 1000, 1000, 200, 100, 500, 500),
  geometry('letterbox top outside', 1000, 1000, 200, 100, 500, 249),
  geometry('letterbox top edge', 1000, 1000, 200, 100, 0, 250),
  geometry('letterbox bottom edge', 1000, 1000, 200, 100, 1000, 750),
  geometry('letterbox bottom outside', 1000, 1000, 200, 100, 500, 751),
  geometry('fractional point', 200, 100, 400, 200, 10.25, 20.75),
  ...([0, 90, 180, 270] as const).flatMap((rotation) => [
    geometry(`rotation ${rotation} center`, 1000, 1000, 200, 100, 500, 500, rotation),
    geometry(`rotation ${rotation} offset`, 1000, 1000, 200, 100, 500, 300, rotation),
  ]),
  geometry('zero view width', 0, 100, 200, 100, 0, 0),
  geometry('zero view height', 100, 0, 200, 100, 0, 0),
  geometry('zero video width', 100, 100, 0, 100, 0, 0),
  geometry('zero video height rotated', 100, 100, 200, 0, 0, 0, 90),
  geometry('negative point', 100, 100, 100, 100, -1, -1),
];

const scrolls: Named<ScrollInput>[] = [
  ['zero', 0, 0], ['up', 0, 1], ['down', 0, -1], ['left', 1, 0], ['right', -1, 0],
  ['fractional', 0.3, -0.07], ['half', 0.5, -0.5], ['both axes', 2, -3],
  ['positive limit', 16, 16], ['negative limit', -16, -16], ['saturated', 1000, -1000],
  ['positive half quantum', 1 / 4096, 0], ['negative half quantum', -1 / 4096, 0],
  ['below quantum', 1 / 8192, -1 / 8192],
].map(([name, h, v]) => ({ name: name as string, h: h as number, v: v as number,
  video_width: 1080, video_height: 2400, x: 10.5, y: 20.49, buttons: 0 }));
scrolls.push({ name: 'buttons and bounds', video_width: 2400, video_height: 1080,
  x: 2400, y: 1080, h: 0, v: 1, buttons: 3 });

export function buildInputFixtures() {
  return {
    keys: { cases: keys.map((c) => ({ ...c, expect: routeKey(c) })) },
    ime: { cases: ime.map((c) => ({ ...c, expect: routeIme(c) })) },
    pointers: { cases: pointers.map((c) => ({ ...c, expect: routePointers(c) })) },
    geometry: { cases: geometries.map((c) => ({ ...c, expect: mapPoint(c) })) },
    scroll: { cases: scrolls.map((c) => ({ ...c, expect: routeScroll(c) })) },
  };
}
