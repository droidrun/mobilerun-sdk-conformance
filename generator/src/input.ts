import {
  AMOTION_EVENT as A, ANDROID_KEYS as K, codeMap,
  createInjectKeycodeMessage, createInjectMouseHoverMessage,
  createInjectScrollEventMessage, createInjectTextMessage,
  createSetClipboardMessage, createTouchControlMessage,
} from '@mobilerun/react';
import { toHex } from './hex';

export type Message = { channel: 'control' | 'hover'; hex: string };
const message = (bytes: ArrayBuffer, channel: Message['channel'] = 'control'): Message =>
  ({ channel, hex: toHex(bytes) });
const press = (keycode: number): Message[] => [K.ACTION_DOWN, K.ACTION_UP].map((action) =>
  message(createInjectKeycodeMessage(action, keycode, 0, K.META_NONE)));

const CONTROL_KEYS = new Set([
  'Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'Home', 'End', 'PageUp', 'PageDown', 'Insert',
]);
const MODIFIER_PREFIXES = ['Shift', 'Control', 'Alt', 'Meta'];
const GRAPHEMES = new Intl.Segmenter('und', { granularity: 'grapheme' });
const MAX_TOUCH_SLOTS = 10;
const MOUSE_POINTER_ID = -1;

export type KeyEvent = {
  type: 'keydown' | 'keyup'; code: string; key: string;
  shift: boolean; alt: boolean; ctrl: boolean; meta: boolean;
  caps_lock: boolean; clipboard: string;
};
export type KeyDecision = 'tracked_key_release' | 'grapheme_text';
export type KeySequence = { events: KeyEvent[]; sdk_decisions: KeyDecision[] };

function isReactControlKey(e: KeyEvent): boolean {
  return CONTROL_KEYS.has(e.key) || e.key.startsWith('Arrow') ||
    (e.key.startsWith('F') && e.key.length <= 3) ||
    MODIFIER_PREFIXES.some((prefix) => e.key.startsWith(prefix)) || e.ctrl || e.meta;
}

function isKeyText(key: string): boolean {
  // React accepts every single code unit; the SDK additionally accepts a printable grapheme.
  return key.length === 1 || (key.length > 1 && !/\p{Cc}/u.test(key) &&
    [...GRAPHEMES.segment(key)].length === 1);
}

function keyMeta(e: KeyEvent): number {
  const letter = e.code >= 'KeyA' && e.code <= 'KeyZ';
  const shift = letter ? e.shift !== e.caps_lock : e.shift;
  return (shift ? K.META_SHIFT_ON : 0) | (e.alt ? K.META_ALT_ON : 0) |
    (e.ctrl ? K.META_CTRL_ON : 0) | (e.meta ? K.META_META_ON : 0);
}

/** Fresh state per sequence. Focus and an open control channel are preconditions. */
export function routeKeys(c: KeySequence): Message[] {
  const pressed = new Set<string>();
  return c.events.flatMap((e): Message[] => {
    const keycode = codeMap[e.code];
    if (e.type === 'keyup') {
      if (!pressed.delete(e.code) || !keycode) return [];
      // SDK decision / React divergence: only release a previously sent DOWN, with keyup's metadata.
      return [message(createInjectKeycodeMessage(K.ACTION_UP, keycode, 0, keyMeta(e)))];
    }
    if (e.ctrl || e.meta) {
      if (e.key.toLowerCase() === 'v') {
        return e.clipboard ? [message(createSetClipboardMessage(e.clipboard, true))] : [];
      }
      if (e.key.toLowerCase() === 'm') return press(K.MENU);
    }
    if (!isReactControlKey(e) && isKeyText(e.key)) {
      return [message(createInjectTextMessage(e.key))];
    }
    if (!keycode) return [];
    pressed.add(e.code);
    return [message(createInjectKeycodeMessage(K.ACTION_DOWN, keycode, 0, keyMeta(e)))];
  });
}

export type ImeInput =
  | { operation: 'delete'; composition_text: string }
  | { operation: 'commit' | 'composition_update' | 'composition_end'; text: string };

/** SDK decision: finalized composition and explicit commits share the split/drop rule. */
export function routeIme(e: ImeInput): Message[] {
  if (e.operation === 'delete') return e.composition_text === '' ? press(K.DEL) : [];
  if (e.operation === 'composition_update') return [];
  const out: Message[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push(message(createInjectTextMessage(text)));
    text = '';
  };
  for (let i = 0; i < e.text.length; i++) {
    const char = e.text[i]!;
    if (char === '\r' || char === '\n' || char === '\t') {
      flush();
      out.push(...press(char === '\t' ? K.KEYCODE_TAB : K.ENTER));
      if (char === '\r' && e.text[i + 1] === '\n') i++;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159)) continue;
    text += char;
  }
  flush();
  return out;
}

export type PointerEvent = {
  type: 'down' | 'move' | 'up' | 'cancel'; id: number;
  x: number; y: number; mouse: boolean; button: number; buttons: number;
};
export type PointerSequence = { video_width: number; video_height: number; events: PointerEvent[] };
const isInsideVideo = (width: number, height: number, x: number, y: number): boolean =>
  width > 0 && height > 0 && x >= 0 && x <= width && y >= 0 && y <= height;

/** SDK slots and abstract mouse events; React's primary-button and last-position rules. */
export function routePointers(c: PointerSequence): Message[] {
  const active = new Map<string, { slot: number; x: number; y: number }>();
  const out: Message[] = [];
  for (const e of c.events) {
    if ((e.type === 'down' || e.type === 'up') && e.button !== 0) continue;
    const id = e.mouse ? 'mouse' : String(e.id);
    let pointer = active.get(id);
    const inside = isInsideVideo(c.video_width, c.video_height, e.x, e.y);
    let action: number;
    if (e.type === 'down') {
      if (!inside || pointer) continue;
      let slot = MOUSE_POINTER_ID;
      if (!e.mouse) {
        const used = new Set([...active.values()].map((p) => p.slot));
        for (slot = 0; slot < MAX_TOUCH_SLOTS; slot++) {
          if (!used.has(slot)) break;
        }
        if (slot === MAX_TOUCH_SLOTS) continue;
      }
      pointer = { slot, x: e.x, y: e.y };
      active.set(id, pointer);
      action = A.ACTION_DOWN;
    } else if (e.type === 'move') {
      if (!inside) continue;
      if (!pointer) {
        if (e.mouse) out.push(message(createInjectMouseHoverMessage(
          c.video_width, c.video_height, e.x, e.y, e.buttons,
        ), 'hover'));
        continue;
      }
      pointer.x = e.x;
      pointer.y = e.y;
      action = A.ACTION_MOVE;
    } else {
      if (!pointer) continue;
      action = e.type === 'cancel' ? A.ACTION_CANCEL : A.ACTION_UP;
      active.delete(id);
    }
    out.push(message(createTouchControlMessage(
      action, pointer.slot, c.video_width, c.video_height, pointer.x, pointer.y,
      1, A.BUTTON_PRIMARY, A.BUTTON_PRIMARY,
    )));
  }
  return out;
}

export type GeometryInput = {
  view_width: number; view_height: number; video_width: number; video_height: number;
  rotation: 0 | 90 | 180 | 270; x: number; y: number;
};
export type VideoPoint = { width: number; height: number; x: number; y: number };

/** SDK decision: rotate dimensions upright before React's aspect-fit mapping. */
export function mapPoint(c: GeometryInput): VideoPoint | null {
  const quarter = c.rotation === 90 || c.rotation === 270;
  const width = quarter ? c.video_height : c.video_width;
  const height = quarter ? c.video_width : c.video_height;
  if (c.view_width <= 0 || c.view_height <= 0 || width <= 0 || height <= 0) return null;
  const scale = Math.min(c.view_width / width, c.view_height / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const x = c.x - (c.view_width - renderedWidth) / 2;
  const y = c.y - (c.view_height - renderedHeight) / 2;
  if (x < 0 || y < 0 || x > renderedWidth || y > renderedHeight) return null;
  return {
    width, height,
    x: Math.max(0, Math.min(width, x / renderedWidth * width)),
    y: Math.max(0, Math.min(height, y / renderedHeight * height)),
  };
}

export type ScrollInput = {
  video_width: number; video_height: number; x: number; y: number;
  h: number; v: number; buttons: number;
};
export function routeScroll(c: ScrollInput): Message[] {
  if (!isInsideVideo(c.video_width, c.video_height, c.x, c.y)) return [];
  return [message(createInjectScrollEventMessage(
    c.video_width, c.video_height, c.x, c.y, c.h, c.v, c.buttons,
  ))];
}
