import {
  AMOTION_EVENT,
  ANDROID_KEYS,
  createInjectKeycodeMessage,
  createInjectMouseHoverMessage,
  createInjectScrollEventMessage,
  createInjectTextMessage,
  createSetClipboardMessage,
  createTouchControlMessage,
} from '@mobilerun/react';

export type Args = Record<string, number | string | boolean>;
export interface ControlCase {
  name: string;
  args: Args;
  hex: string;
}

export const toHex = (buf: ArrayBuffer): string => Buffer.from(buf).toString('hex');

type Builder = (a: any) => ArrayBuffer;

/** One entry per message builder exported by @mobilerun/react. */
export const BUILDERS: Record<string, Builder> = {
  touch: (a) =>
    createTouchControlMessage(
      a.action,
      a.pointerId,
      a.videoWidth,
      a.videoHeight,
      a.x,
      a.y,
      a.pressure,
      a.actionButton,
      a.buttons,
    ),
  scroll: (a) =>
    createInjectScrollEventMessage(
      a.videoWidth,
      a.videoHeight,
      a.x,
      a.y,
      a.hscrollTicks,
      a.vscrollTicks,
      a.buttons,
    ),
  hover: (a) => createInjectMouseHoverMessage(a.videoWidth, a.videoHeight, a.x, a.y, a.buttons),
  keycode: (a) => createInjectKeycodeMessage(a.action, a.keycode, a.repeat, a.metaState),
  text: (a) => createInjectTextMessage(a.text),
  'set-clipboard': (a) => createSetClipboardMessage(a.text, a.paste),
};

const A = AMOTION_EVENT;
const K = ANDROID_KEYS;

function touch(
  name: string,
  action: number,
  pointerId: number,
  x: number,
  y: number,
  extra: Partial<{
    videoWidth: number;
    videoHeight: number;
    pressure: number;
    actionButton: number;
    buttons: number;
  }> = {},
) {
  return {
    name,
    args: {
      action,
      pointerId,
      videoWidth: extra.videoWidth ?? 1080,
      videoHeight: extra.videoHeight ?? 2400,
      x,
      y,
      pressure: extra.pressure ?? 1.0,
      actionButton: extra.actionButton ?? 0,
      buttons: extra.buttons ?? 0,
    },
  };
}

const touchCases = [
  // Mouse (pointer id -1), the way use-scrcpy-input sends it: pressure 1.0, primary button.
  touch('mouse down', A.ACTION_DOWN, -1, 540, 1200, { actionButton: A.BUTTON_PRIMARY, buttons: A.BUTTON_PRIMARY }),
  touch('mouse move', A.ACTION_MOVE, -1, 541.25, 1210.75, { actionButton: A.BUTTON_PRIMARY, buttons: A.BUTTON_PRIMARY }),
  touch('mouse up', A.ACTION_UP, -1, 541, 1211, { actionButton: A.BUTTON_PRIMARY, buttons: A.BUTTON_PRIMARY }),
  touch('mouse cancel', A.ACTION_CANCEL, -1, 541, 1211, { actionButton: A.BUTTON_PRIMARY, buttons: A.BUTTON_PRIMARY }),
  touch('mouse defaults only (no buttons)', A.ACTION_DOWN, -1, 10, 20),
  // Touch ids.
  touch('touch id 0 down', A.ACTION_DOWN, 0, 100, 200),
  touch('touch id 0 move', A.ACTION_MOVE, 0, 110, 220),
  touch('touch id 0 up', A.ACTION_UP, 0, 110, 220),
  touch('touch id 1 down', A.ACTION_DOWN, 1, 300, 400),
  touch('touch id 1 move', A.ACTION_MOVE, 1, 310, 410),
  touch('touch id 1 up', A.ACTION_UP, 1, 310, 410),
  touch('touch id 1 cancel', A.ACTION_CANCEL, 1, 310, 410),
  touch('touch id 9 down', A.ACTION_DOWN, 9, 800, 900),
  touch('touch id 9 up', A.ACTION_UP, 9, 800, 900),
  touch('touch id 1 pointer down', A.ACTION_POINTER_DOWN, 1, 300, 400),
  touch('touch id 1 pointer up', A.ACTION_POINTER_UP, 1, 300, 400),
  // Rounding: Math.round, i.e. half rounds toward +infinity.
  touch('x,y round half up (2.5, 3.5)', A.ACTION_MOVE, 0, 2.5, 3.5),
  touch('x,y round negative half (-0.5, -1.5)', A.ACTION_MOVE, 0, -0.5, -1.5),
  touch('x,y round down (10.4, 10.49)', A.ACTION_MOVE, 0, 10.4, 10.49),
  // Extremes and pressure.
  touch('origin', A.ACTION_DOWN, 0, 0, 0),
  touch('max coordinates', A.ACTION_DOWN, 0, 1080, 2400),
  touch('negative coordinates', A.ACTION_MOVE, 0, -5, -10),
  touch('large video size', A.ACTION_DOWN, 0, 4000, 3000, { videoWidth: 4096, videoHeight: 3072 }),
  touch('landscape video size', A.ACTION_DOWN, 0, 1000, 500, { videoWidth: 2400, videoHeight: 1080 }),
  touch('pressure 0.5', A.ACTION_MOVE, 0, 50, 50, { pressure: 0.5 }),
  touch('pressure 0', A.ACTION_MOVE, 0, 50, 50, { pressure: 0 }),
  touch('secondary button', A.ACTION_DOWN, -1, 50, 50, { actionButton: A.BUTTON_SECONDARY, buttons: A.BUTTON_SECONDARY }),
  touch('tertiary button', A.ACTION_DOWN, -1, 50, 50, { actionButton: A.BUTTON_TERTIARY, buttons: A.BUTTON_TERTIARY }),
  touch('combined buttons', A.ACTION_MOVE, -1, 50, 50, { actionButton: 0, buttons: A.BUTTON_PRIMARY | A.BUTTON_SECONDARY }),
];

function scroll(
  name: string,
  hscrollTicks: number,
  vscrollTicks: number,
  extra: Partial<{ x: number; y: number; buttons: number }> = {},
) {
  return {
    name,
    args: {
      videoWidth: 1080,
      videoHeight: 2400,
      x: extra.x ?? 540,
      y: extra.y ?? 1200,
      hscrollTicks,
      vscrollTicks,
      buttons: extra.buttons ?? 0,
    },
  };
}

const scrollCases = [
  scroll('zero', 0, 0),
  scroll('one tick up (vscroll +1)', 0, 1),
  scroll('one tick down (vscroll -1)', 0, -1),
  scroll('one tick left (hscroll +1)', 1, 0),
  scroll('one tick right (hscroll -1)', -1, 0),
  scroll('both axes', 2, -3),
  scroll('fractional trackpad ticks', 0.3, -0.07),
  scroll('half tick', 0.5, -0.5),
  scroll('eight ticks', 8, -8),
  scroll('15 ticks', 0, 15),
  scroll('exactly 16 ticks clamps positive (0x7fff)', 16, 16),
  scroll('exactly -16 ticks (-0x8000)', -16, -16),
  scroll('positive extreme clamped', 1000, 1000),
  scroll('negative extreme clamped', -1000, -1000),
  scroll('mixed extremes', 1000, -1000),
  scroll('with primary button held', 0, 1, { buttons: AMOTION_EVENT.BUTTON_PRIMARY }),
  scroll('at origin', 0, 1, { x: 0, y: 0 }),
  scroll('fractional position rounds', 0, 1, { x: 10.5, y: 20.5 }),
];

function hover(name: string, x: number, y: number, buttons = 0, videoWidth = 1080, videoHeight = 2400) {
  return { name, args: { videoWidth, videoHeight, x, y, buttons } };
}

const hoverCases = [
  hover('center', 540, 1200),
  hover('origin', 0, 0),
  hover('max corner', 1080, 2400),
  hover('fractional rounds', 12.5, 99.49),
  hover('with primary button', 100, 100, AMOTION_EVENT.BUTTON_PRIMARY),
  hover('landscape', 1200, 400, 0, 2400, 1080),
];

function keycode(name: string, action: number, kc: number, repeat = 0, metaState = 0) {
  return { name, args: { action, keycode: kc, repeat, metaState } };
}

const keycodeCases = [
  keycode('home down', K.ACTION_DOWN, K.KEYCODE_HOME),
  keycode('home up', K.ACTION_UP, K.KEYCODE_HOME),
  keycode('back down', K.ACTION_DOWN, K.KEYCODE_BACK),
  keycode('app switch down', K.ACTION_DOWN, K.KEYCODE_APP_SWITCH),
  keycode('menu down', K.ACTION_DOWN, K.MENU),
  keycode('enter down', K.ACTION_DOWN, K.ENTER),
  keycode('backspace down', K.ACTION_DOWN, K.DEL),
  keycode('letter a down, no meta', K.ACTION_DOWN, K.KEYCODE_A),
  keycode('letter a down, shift', K.ACTION_DOWN, K.KEYCODE_A, 0, K.META_SHIFT_ON),
  keycode('letter c down, ctrl', K.ACTION_DOWN, K.KEYCODE_C, 0, K.META_CTRL_ON),
  keycode('letter c up, ctrl', K.ACTION_UP, K.KEYCODE_C, 0, K.META_CTRL_ON),
  keycode('letter z down, alt', K.ACTION_DOWN, K.KEYCODE_Z, 0, K.META_ALT_ON),
  keycode('letter v down, meta (command)', K.ACTION_DOWN, K.KEYCODE_V, 0, K.META_META_ON),
  keycode(
    'all modifiers',
    K.ACTION_DOWN,
    K.KEYCODE_A,
    0,
    K.META_SHIFT_ON | K.META_ALT_ON | K.META_CTRL_ON | K.META_META_ON,
  ),
  keycode('shift+ctrl', K.ACTION_DOWN, K.KEYCODE_TAB, 0, K.META_SHIFT_ON | K.META_CTRL_ON),
  keycode('repeat 5', K.ACTION_DOWN, K.DEL, 5),
  keycode('arrow up', K.ACTION_DOWN, K.DPAD_UP),
  keycode('f12', K.ACTION_DOWN, K.KEYCODE_F12),
  keycode('highest keycode (soft sleep 276)', K.ACTION_DOWN, K.KEYCODE_SOFT_SLEEP),
  keycode('unknown keycode 0', K.ACTION_DOWN, K.KEYCODE_UNKNOWN),
];

const TEXTS: [string, string][] = [
  ['empty', ''],
  ['single ascii char', 'a'],
  ['ascii sentence', 'Hello, World!'],
  ['ascii punctuation and symbols', '!@#$%^&*()_+-=[]{}|;\':",./<>?`~\\'],
  ['digits', '0123456789'],
  ['space only', ' '],
  ['newline and tab', 'line1\nline2\tend'],
  ['latin-1 two-byte', 'héllo wörld ñ'],
  ['cyrillic', 'Привет'],
  ['cjk three-byte', '日本語のテキスト'],
  ['emoji four-byte', '😀'],
  ['emoji between ascii', 'a😀b'],
  ['emoji zwj sequence', '👨‍👩‍👧‍👦'],
  ['emoji with skin tone', '👍🏽'],
  ['flag regional indicators', '🇩🇪'],
  ['combining accent', 'é'],
  ['nul character', 'a\u0000b'],
  ['long ascii (300 chars)', 'x'.repeat(300)],
  // Malformed UTF-16: React's TextEncoder writes U+FFFD (efbfbd) for each unpaired surrogate.
  ['lone high surrogate', '\uD83D'],
  ['lone low surrogate inside text', 'a\uDC00b'],
  ['high surrogate at end after ascii', 'ok\uD83D'],
  ['reversed surrogate pair', '\uDE00\uD83D'],
];

const textCases = TEXTS.map(([name, text]) => ({ name, args: { text } }));
const clipboardCases = TEXTS.flatMap(([name, text]) => [
  { name: `${name}, paste true`, args: { text, paste: true } },
  { name: `${name}, paste false`, args: { text, paste: false } },
]);

export const CASES: Record<string, { name: string; args: Args }[]> = {
  touch: touchCases,
  scroll: scrollCases,
  hover: hoverCases,
  keycode: keycodeCases,
  text: textCases,
  'set-clipboard': clipboardCases,
};

export function buildControlFixtures(): Record<string, ControlCase[]> {
  const out: Record<string, ControlCase[]> = {};
  for (const [kind, cases] of Object.entries(CASES)) {
    const build = BUILDERS[kind]!;
    out[kind] = cases.map((c) => ({ name: c.name, args: c.args, hex: toHex(build(c.args)) }));
  }
  return out;
}
