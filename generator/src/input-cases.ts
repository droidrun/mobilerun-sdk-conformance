import {
  mapPoint, routeIme, routeKeys, routePointers, routeScroll,
  type GeometryInput, type ImeInput, type KeyDecision, type KeyEvent, type KeySequence,
  type PointerEvent, type PointerSequence, type ScrollInput,
} from './input';

type Named<T> = T & { name: string };
type KeyFlags = Partial<Omit<KeyEvent, 'type' | 'code' | 'key'>>;
const keyEvent = (
  type: KeyEvent['type'], code: string, key: string, flags: KeyFlags = {},
): KeyEvent => ({
  type, code, key, shift: false, alt: false, ctrl: false, meta: false,
  caps_lock: false, clipboard: '', ...flags,
});
const keySequence = (
  name: string, events: KeyEvent[], sdk_decisions: KeyDecision[] = [],
): Named<KeySequence> => ({ name, sdk_decisions, events });
const keyPair = (
  name: string, code: string, key: string, flags: KeyFlags = {}, sdk_decisions: KeyDecision[] = [],
): Named<KeySequence> => keySequence(name, [
  keyEvent('keydown', code, key, flags), keyEvent('keyup', code, key, flags),
], sdk_decisions);

const modifiers: { flag: 'ctrl' | 'meta'; code: string; key: string }[] = [
  { flag: 'ctrl', code: 'ControlLeft', key: 'Control' },
  { flag: 'meta', code: 'MetaLeft', key: 'Meta' },
];
const keys: Named<KeySequence>[] = [
  ...['a', 'A', 'é', '中', ' ', '!', '\u0000', '\u0001', '\t', '\n', '\r',
    '\u001b', '\u007f', '\u0085', '\ud83d']
    .map((value) => keyPair(
      `single character U+${value.charCodeAt(0).toString(16).padStart(4, '0')}`, 'KeyA', value,
    )),
  keyPair('unknown code printable', 'Unidentified', 'a'),
  keyPair('unknown code control character', 'Unidentified', '\u0001'),
  keyPair('unknown code nontext', 'Unidentified', 'Unidentified'),
  keyPair('unknown code named control', 'Unidentified', 'Enter'),
  keyPair('unknown code ctrl combo', 'Unidentified', 'a', { ctrl: true }),
  keyPair('uppercase f control heuristic', 'KeyF', 'F', { shift: true }),
  keyPair('dead key mapped fallback', 'Quote', 'Dead', {}, ['tracked_key_release']),
  keyPair('dead key unknown fallback', 'Unidentified', 'Dead'),
  keyPair('emoji grapheme', 'KeyA', '😀', {}, ['grapheme_text']),
  keyPair('emoji unknown code grapheme', 'Unidentified', '😀', {}, ['grapheme_text']),
  keyPair('emoji zwj grapheme', 'KeyA', '👨‍👩‍👧‍👦', {}, ['grapheme_text']),
  keyPair('emoji skin tone grapheme', 'KeyA', '👍🏽', {}, ['grapheme_text']),
  keyPair('nfd grapheme', 'KeyE', 'e\u0301', {}, ['grapheme_text']),
  keyPair('multiple graphemes fallback', 'KeyA', 'ab', {}, ['tracked_key_release']),
  keyPair('empty key fallback', 'KeyA', '', {}, ['tracked_key_release']),
  keyPair('caps lock unmapped', 'CapsLock', 'CapsLock'),
  keyPair('context menu fallback', 'ContextMenu', 'ContextMenu', {}, ['tracked_key_release']),
  keyPair('numpad no text fallback', 'Numpad1', 'Unidentified', {}, ['tracked_key_release']),
  keyPair('numpad decimal no text fallback', 'NumpadDecimal', '', {}, ['tracked_key_release']),
  keyPair('alt no char fallback', 'KeyA', '', { alt: true }, ['tracked_key_release']),
  keyPair('alt caps no char fallback', 'KeyC', '', { alt: true, caps_lock: true },
    ['tracked_key_release']),
  ...['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'Home', 'End', 'PageUp', 'PageDown',
    'Insert', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    .map((code) => keyPair(code.toLowerCase(), code, code)),
  keyPair('numpad enter', 'NumpadEnter', 'Enter'),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)
    .map((code) => keyPair(code.toLowerCase(), code, code)),
  keyPair('unmapped function representative', 'F13', 'F13'),
  ...['Shift', 'Control', 'Alt', 'Meta'].flatMap((modifier) =>
    ['Left', 'Right'].map((side) => keySequence(`${modifier.toLowerCase()} ${side.toLowerCase()}`, [
      keyEvent('keydown', modifier + side, modifier, {
        shift: modifier === 'Shift', alt: modifier === 'Alt',
        ctrl: modifier === 'Control', meta: modifier === 'Meta',
      }),
      keyEvent('keyup', modifier + side, modifier),
    ]))),
  // A nontext control key exercises all sixteen modifier masks on both DOWN and UP.
  ...Array.from({ length: 16 }, (_, mask) => keyPair(
    `modifier mask ${mask}`, 'ArrowLeft', 'ArrowLeft', {
      shift: !!(mask & 1), alt: !!(mask & 2), ctrl: !!(mask & 4), meta: !!(mask & 8),
    },
  )),
  ...[false, true].flatMap((shift) => [false, true].map((caps_lock) => keyPair(
    `letter shift ${shift} caps ${caps_lock}`, 'KeyC', 'c', { shift, caps_lock, ctrl: true },
  ))),
  keyPair('caps lock nonletter', 'Digit1', 'Unidentified', { caps_lock: true, ctrl: true }),
  keyPair('caps lock nonletter shift', 'Digit1', 'Unidentified',
    { caps_lock: true, shift: true, ctrl: true }),
  keyPair('alt printable', 'KeyQ', '@', { alt: true }),
  ...modifiers.flatMap(({ flag, code, key }) => ['v', 'm'].flatMap((value) =>
    [true, false].map((letterFirst) => {
      const flags = { [flag]: true, clipboard: 'héllo\n😀' };
      const letterCode = value === 'v' ? 'KeyV' : 'KeyM';
      const modifierUp = keyEvent('keyup', code, key);
      const letterUp = keyEvent('keyup', letterCode, value, letterFirst ? flags : {});
      return keySequence(`${flag} ${value} ${letterFirst ? 'letter' : 'modifier'} released first`, [
        keyEvent('keydown', code, key, flags), keyEvent('keydown', letterCode, value, flags),
        ...(letterFirst ? [letterUp, modifierUp] : [modifierUp, letterUp]),
      ], letterFirst ? ['tracked_key_release'] : []);
    }))),
  keyPair('ctrl uppercase paste', 'KeyV', 'V',
    { ctrl: true, shift: true, clipboard: 'text' }, ['tracked_key_release']),
  keyPair('ctrl empty paste', 'KeyV', 'v', { ctrl: true }, ['tracked_key_release']),
  keyPair('ctrl paste matches key not code', 'Period', 'v',
    { ctrl: true, clipboard: 'text' }, ['tracked_key_release']),
  keyPair('ctrl period on v code is keycode', 'KeyV', '.', { ctrl: true }),
  keyPair('ctrl menu matches key not code', 'Period', 'm', { ctrl: true }, ['tracked_key_release']),
  keyPair('ctrl period on m code is keycode', 'KeyM', '.', { ctrl: true }),
  keySequence('alt released before fallback letter', [
    keyEvent('keydown', 'AltLeft', 'Alt', { alt: true }),
    keyEvent('keydown', 'KeyA', '', { alt: true }),
    keyEvent('keyup', 'AltLeft', 'Alt'), keyEvent('keyup', 'KeyA', 'a'),
  ], ['tracked_key_release']),
  keySequence('cross modifier release uses current metadata', [
    keyEvent('keydown', 'ControlLeft', 'Control', { ctrl: true }),
    keyEvent('keydown', 'AltLeft', 'Alt', { ctrl: true, alt: true }),
    keyEvent('keydown', 'KeyA', 'a', { ctrl: true, alt: true }),
    keyEvent('keyup', 'ControlLeft', 'Control', { alt: true }),
    keyEvent('keyup', 'KeyA', 'a', { alt: true }), keyEvent('keyup', 'AltLeft', 'Alt'),
  ], ['tracked_key_release']),
  keySequence('text before ctrl has no orphan up', [
    keyEvent('keydown', 'KeyA', 'a'), keyEvent('keydown', 'ControlLeft', 'Control', { ctrl: true }),
    keyEvent('keyup', 'KeyA', 'a', { ctrl: true }), keyEvent('keyup', 'ControlLeft', 'Control'),
  ], ['tracked_key_release']),
  keySequence('orphan control up ignored', [keyEvent('keyup', 'ControlLeft', 'Control')],
    ['tracked_key_release']),
  keySequence('repeat down and duplicate up', [
    keyEvent('keydown', 'ArrowLeft', 'ArrowLeft'), keyEvent('keydown', 'ArrowLeft', 'ArrowLeft'),
    keyEvent('keyup', 'ArrowLeft', 'ArrowLeft'), keyEvent('keyup', 'ArrowLeft', 'ArrowLeft'),
  ], ['tracked_key_release']),
];

const commitTexts: [string, string][] = [
  ['empty', ''], ['ascii', 'hello'], ['unicode', 'é中😀e\u0301'],
  ['lf', '\n'], ['cr', '\r'], ['crlf', '\r\n'], ['tab', '\t'],
  ['mixed', 'a\r\nb\rc\nd\te'], ['consecutive breaks', '\r\n\r\n\n\r\t\t'],
  ['c0 controls dropped', 'a\u0000\u0001\u0008\u001bb'],
  ['del and c1 dropped', 'a\u007f\u0085\u009fb'],
  ['only dropped controls', '\u0000\u001f\u007f\u009f'],
  ['controls between separators', 'a\u0000\tb\u007f\nc'],
  ['unicode line separators printable', 'a\u2028b\u2029c'],
  ['lone surrogate replacement', 'a\ud83d\tb'],
];
const ime: Named<ImeInput>[] = [
  ...commitTexts.map(([name, text]): Named<ImeInput> => ({ name, operation: 'commit', text })),
  { name: 'empty marked composition delete', operation: 'delete', composition_text: '' },
  { name: 'nonempty marked composition delete stays local', operation: 'delete', composition_text: 'a' },
  { name: 'composition update stays local', operation: 'composition_update', text: 'に' },
  { name: 'composition finalized', operation: 'composition_end', text: '日本語😀' },
  { name: 'composition finalized splits and drops', operation: 'composition_end', text: 'a\t\nb\u0000' },
  { name: 'composition empty', operation: 'composition_end', text: '' },
];

const point = (
  type: PointerEvent['type'], id: number, x: number, y: number,
  mouse = false, buttons = 0, button = 0,
): PointerEvent => ({ type, id, x, y, mouse, button, buttons });
const pointerSequence = (
  name: string, events: PointerEvent[], video_width = 1080, video_height = 2400,
): Named<PointerSequence> => ({ name, video_width, video_height, events });
const pointers = [
  pointerSequence('single touch last position', [
    point('down', 42, 100, 200), point('move', 42, 110, 220), point('up', 42, 900, 900),
  ]),
  pointerSequence('two fingers independent slots', [
    point('down', 42, 100, 200), point('down', 7, 300, 400),
    point('move', 42, 120, 220), point('up', 7, 0, 0), point('up', 42, 0, 0),
  ]),
  pointerSequence('lowest free slot reused', [
    point('down', 8, 10, 20), point('down', 9, 30, 40), point('up', 8, 0, 0),
    point('down', 10, 50, 60), point('cancel', 9, 0, 0), point('up', 10, 0, 0),
  ]),
  pointerSequence('outside down ignored', [
    point('down', 4, -1, 20), point('move', 4, 10, 20), point('up', 4, 10, 20),
  ]),
  pointerSequence('outside movement release at last inside', [
    point('down', 4, 10, 20), point('move', 4, 20, 30),
    point('move', 4, 1081, 30), point('up', 4, 1081, 30),
  ]),
  pointerSequence('cancel last position', [
    point('down', 4, 10, 20), point('move', 4, 20, 30),
    point('cancel', 4, -1, -1), point('up', 4, 0, 0),
  ]),
  pointerSequence('mouse hover drag hover channels', [
    point('move', 99, 10, 20, true, 2), point('down', 99, 10, 20, true, 1),
    point('move', 99, 30, 40, true, 1), point('up', 99, 900, 900, true),
    point('move', 99, 50, 60, true),
  ]),
  pointerSequence('mouse and finger independent', [
    point('down', 5, 10, 20), point('down', 5, 30, 40, true),
    point('up', 5, 0, 0, true), point('cancel', 5, 0, 0),
  ]),
  pointerSequence('hover outside ignored', [
    point('move', 0, -1, 0, true), point('move', 0, 1081, 0, true),
    point('move', 0, 1080, 2400, true, 6),
  ]),
  pointerSequence('unmatched touch events', [
    point('move', 77, 10, 20), point('up', 77, 10, 20), point('cancel', 77, 10, 20),
  ]),
  pointerSequence('duplicate down ignored', [
    point('down', 77, 10, 20), point('down', 77, 30, 40), point('up', 77, 30, 40),
  ]),
  pointerSequence('inclusive bounds and rounding', [
    point('down', 1, 0, 0), point('move', 1, 2.5, 3.49),
    point('move', 1, 1080, 2400), point('up', 1, 0, 0),
  ]),
  pointerSequence('ten slots capacity and recovery', [
    ...Array.from({ length: 11 }, (_, i) => point('down', 100 + i, i * 10, i * 20)),
    point('up', 110, 0, 0), point('up', 103, 0, 0), point('down', 110, 80, 90),
    ...Array.from({ length: 11 }, (_, i) => point('cancel', 100 + i, -1, -1)),
  ]),
  pointerSequence('video not ready', [point('down', 1, 0, 0), point('move', 0, 0, 0, true)], 0, 0),
  ...[1, 2].map((button) => pointerSequence(`nonprimary button ${button} hover only`, [
    point('down', 0, 10, 20, true, button === 1 ? 4 : 2, button),
    point('move', 0, 30, 40, true, button === 1 ? 4 : 2),
    point('up', 0, 50, 60, true, 0, button),
  ])),
  pointerSequence('nonprimary up does not end primary gesture', [
    point('down', 0, 10, 20, true, 1), point('up', 0, 20, 30, true, 1, 2),
    point('move', 0, 30, 40, true, 1), point('up', 0, 50, 60, true),
  ]),
  pointerSequence('hover while touch slot active', [
    point('down', 42, 10, 20), point('move', 999, 30, 40, true, 6),
    point('move', 42, 50, 60), point('cancel', 42, 0, 0),
  ]),
];

type GeometryArgs = {
  view: [number, number]; video: [number, number]; point: [number, number];
  rotation?: GeometryInput['rotation'];
};
const geometry = (name: string, c: GeometryArgs): Named<GeometryInput> => ({
  name, view_width: c.view[0], view_height: c.view[1],
  video_width: c.video[0], video_height: c.video[1], rotation: c.rotation ?? 0,
  x: c.point[0], y: c.point[1],
});
const rotations: GeometryInput['rotation'][] = [0, 90, 180, 270];
const geometries = [
  geometry('matching aspect center', { view: [540, 1200], video: [1080, 2400], point: [270, 600] }),
  geometry('pillarbox center', { view: [1000, 1000], video: [100, 200], point: [500, 500] }),
  ...[249, 250, 750, 751].map((x) => geometry(`pillarbox x ${x}`, {
    view: [1000, 1000], video: [100, 200], point: [x, 500],
  })),
  geometry('letterbox center', { view: [1000, 1000], video: [200, 100], point: [500, 500] }),
  ...[249, 250, 750, 751].map((y) => geometry(`letterbox y ${y}`, {
    view: [1000, 1000], video: [200, 100], point: [500, y],
  })),
  geometry('fractional point', { view: [200, 100], video: [400, 200], point: [10.25, 20.75] }),
  ...rotations.flatMap((rotation) => [
    geometry(`rotation ${rotation} center`, {
      view: [1000, 1000], video: [200, 100], point: [500, 500], rotation,
    }),
    geometry(`rotation ${rotation} offset`, {
      view: [1000, 1000], video: [200, 100], point: [500, 300], rotation,
    }),
  ]),
  geometry('zero view width', { view: [0, 100], video: [200, 100], point: [0, 0] }),
  geometry('zero view height', { view: [100, 0], video: [200, 100], point: [0, 0] }),
  geometry('zero video width', { view: [100, 100], video: [0, 100], point: [0, 0] }),
  geometry('zero video height rotated', {
    view: [100, 100], video: [200, 0], point: [0, 0], rotation: 90,
  }),
  geometry('negative point', { view: [100, 100], video: [100, 100], point: [-1, -1] }),
];

const scroll = (
  name: string, h: number, v: number, extra: Partial<Omit<ScrollInput, 'h' | 'v'>> = {},
): Named<ScrollInput> => ({
  name, h, v, video_width: 1080, video_height: 2400, x: 10.5, y: 20.49, buttons: 0, ...extra,
});
const scrolls = [
  scroll('zero', 0, 0), scroll('up', 0, 1), scroll('down', 0, -1),
  scroll('left', 1, 0), scroll('right', -1, 0), scroll('fractional', 0.3, -0.07),
  scroll('half', 0.5, -0.5), scroll('both axes', 2, -3),
  scroll('positive limit', 16, 16), scroll('negative limit', -16, -16), scroll('saturated', 1000, -1000),
  scroll('positive half quantum', 1 / 4096, 0), scroll('negative half quantum', -1 / 4096, 0),
  scroll('below quantum', 1 / 8192, -1 / 8192),
  scroll('buttons and bounds', 0, 1, { video_width: 2400, video_height: 1080,
    x: 2400, y: 1080, buttons: 3 }),
  scroll('origin inclusive', 0, 1, { x: 0, y: 0 }),
  scroll('outside left', 0, 1, { x: -1 }), scroll('outside right', 0, 1, { x: 1081 }),
  scroll('outside top', 0, 1, { y: -1 }), scroll('outside bottom', 0, 1, { y: 2401 }),
  scroll('video not ready', 0, 1, { video_width: 0, video_height: 0, x: 0, y: 0 }),
];

export function buildInputFixtures() {
  return {
    keys: keys.map((c) => ({ ...c, expect: routeKeys(c) })),
    ime: ime.map((c) => ({ ...c, expect: routeIme(c) })),
    pointers: pointers.map((c) => ({ ...c, expect: routePointers(c) })),
    geometry: geometries.map((c) => ({ ...c, expect: mapPoint(c) })),
    scroll: scrolls.map((c) => ({ ...c, expect: routeScroll(c) })),
  };
}
