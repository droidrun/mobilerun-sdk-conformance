import {
  AMOTION_EVENT as A, ANDROID_KEYS as K, codeMap,
  createInjectKeycodeMessage, createInjectMouseHoverMessage,
  createInjectScrollEventMessage, createInjectTextMessage,
  createSetClipboardMessage, createTouchControlMessage,
} from '@mobilerun/react';
import { toHex } from './control-cases';

export type Message = { channel: 'control' | 'hover'; hex: string };
const message = (bytes: ArrayBuffer, channel: Message['channel'] = 'control'): Message =>
  ({ channel, hex: toHex(bytes) });
const press = (keycode: number): Message[] => [K.ACTION_DOWN, K.ACTION_UP].map((action) =>
  message(createInjectKeycodeMessage(action, keycode, 0, K.META_NONE)));

export type KeyEvent = {
  type: 'keydown' | 'keyup'; code: string; key: string;
  shift: boolean; alt: boolean; ctrl: boolean; meta: boolean;
  caps_lock: boolean; clipboard: string;
};

/** React routing, with SDK fallback keyup release; focus and open channel are preconditions. */
export function routeKey(e: KeyEvent): Message[] {
  if (e.type === 'keydown' && (e.ctrl || e.meta)) {
    if (e.key.toLowerCase() === 'v') {
      return e.clipboard ? [message(createSetClipboardMessage(e.clipboard, true))] : [];
    }
    if (e.key.toLowerCase() === 'm') return press(K.MENU);
  }
  const control = ['Backspace', 'Delete', 'Enter', 'Tab', 'Escape', 'Home', 'End',
    'PageUp', 'PageDown', 'Insert'].includes(e.key) ||
    e.key.startsWith('Arrow') || (e.key.startsWith('F') && e.key.length <= 3) ||
    ['Shift', 'Control', 'Alt', 'Meta'].some((prefix) => e.key.startsWith(prefix)) ||
    e.ctrl || e.meta;
  if (!control && e.key.length === 1) {
    return e.type === 'keydown' ? [message(createInjectTextMessage(e.key))] : [];
  }
  const keycode = codeMap[e.code];
  if (!keycode) return [];
  // SDK decision / React divergence: release mapped nontext fallback keys on keyup.
  const letter = e.code >= 'KeyA' && e.code <= 'KeyZ';
  const shift = letter ? e.shift !== e.caps_lock : e.shift;
  const meta = (shift ? K.META_SHIFT_ON : 0) | (e.alt ? K.META_ALT_ON : 0) |
    (e.ctrl ? K.META_CTRL_ON : 0) | (e.meta ? K.META_META_ON : 0);
  return [message(createInjectKeycodeMessage(
    e.type === 'keydown' ? K.ACTION_DOWN : K.ACTION_UP, keycode, 0, meta,
  ))];
}

export type ImeInput = {
  operation: 'commit' | 'delete' | 'composition_update' | 'composition_end'; text: string;
};

/** SDK decision: split committed text, but send finalized composition as one text frame. */
export function routeIme(e: ImeInput): Message[] {
  if (e.operation === 'delete') return e.text === '' ? press(K.DEL) : [];
  if (e.operation === 'composition_update') return [];
  if (e.operation === 'composition_end') return e.text ? [message(createInjectTextMessage(e.text))] : [];
  const out: Message[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push(message(createInjectTextMessage(text)));
    text = '';
  };
  for (let i = 0; i < e.text.length; i++) {
    const char = e.text[i]!;
    const code = char.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159)) {
      if (char === '\r' || char === '\n' || char === '\t') {
        flush();
        out.push(...press(char === '\t' ? K.KEYCODE_TAB : K.ENTER));
        if (char === '\r' && e.text[i + 1] === '\n') i++;
      }
      // Dropped controls do not break a printable run.
    } else text += char;
  }
  flush();
  return out;
}

export type PointerEvent = {
  type: 'down' | 'move' | 'up' | 'cancel'; id: number;
  x: number; y: number; mouse: boolean; buttons: number;
};
export type PointerSequence = { video_width: number; video_height: number; events: PointerEvent[] };

/** SDK slots and hover routing; React's last-in-video release and message builders. */
export function routePointers(c: PointerSequence): Message[] {
  const active = new Map<string, { slot: number; x: number; y: number }>();
  const out: Message[] = [];
  for (const e of c.events) {
    const id = e.mouse ? 'mouse' : String(e.id);
    let pointer = active.get(id);
    const inside = c.video_width > 0 && c.video_height > 0 &&
      e.x >= 0 && e.x <= c.video_width && e.y >= 0 && e.y <= c.video_height;
    let action: number;
    if (e.type === 'down') {
      if (!inside || pointer) continue;
      const used = new Set([...active.values()].map((p) => p.slot));
      const slot = e.mouse ? -1 : Array.from({ length: 10 }, (_, i) => i).find((i) => !used.has(i));
      if (slot === undefined) continue;
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

/** SDK decision: rotate dimensions upright before React's aspect-fit mapping. */
export function mapPoint(c: GeometryInput): { x: number; y: number } | null {
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
  return { x: Math.max(0, Math.min(width, x / renderedWidth * width)),
    y: Math.max(0, Math.min(height, y / renderedHeight * height)) };
}

export type ScrollInput = {
  video_width: number; video_height: number; x: number; y: number;
  h: number; v: number; buttons: number;
};
export const routeScroll = (c: ScrollInput): Message[] => [message(createInjectScrollEventMessage(
  c.video_width, c.video_height, c.x, c.y, c.h, c.v, c.buttons,
))];
