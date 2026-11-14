// Independent decoder for the control wire format. It deliberately shares no
// code with @mobilerun/react: it reads the layouts documented in the README
// and is used by the round-trip self-test.
import type { Args } from './control-cases';

const fromHex = (hex: string) => {
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};

const decoder = new TextDecoder('utf-8', { fatal: true });

export function decodeControl(kind: string, hex: string): Args {
  const v = fromHex(hex);
  const type = v.getUint8(0);
  switch (kind) {
    case 'touch': {
      checkHeader(type, 2, v.byteLength, 32);
      return {
        action: v.getUint8(1),
        pointerId: Number(v.getBigInt64(2, false)), // big-endian, as React writes it
        x: v.getInt32(10, true),
        y: v.getInt32(14, true),
        videoWidth: v.getUint16(18, true),
        videoHeight: v.getUint16(20, true),
        pressure: v.getInt16(22, true), // raw i16
        actionButton: v.getInt32(24, true),
        buttons: v.getInt32(28, true),
      };
    }
    case 'scroll': {
      checkHeader(type, 3, v.byteLength, 21);
      return {
        x: v.getInt32(1, true),
        y: v.getInt32(5, true),
        videoWidth: v.getUint16(9, true),
        videoHeight: v.getUint16(11, true),
        hscrollTicks: v.getInt16(13, true), // raw i16 fixed point
        vscrollTicks: v.getInt16(15, true),
        buttons: v.getInt32(17, true),
      };
    }
    case 'hover': {
      checkHeader(type, 21, v.byteLength, 17);
      return {
        x: v.getInt32(1, true),
        y: v.getInt32(5, true),
        videoWidth: v.getUint16(9, true),
        videoHeight: v.getUint16(11, true),
        buttons: v.getInt32(13, true),
      };
    }
    case 'keycode': {
      checkHeader(type, 0, v.byteLength, 14);
      return {
        action: v.getUint8(1),
        keycode: v.getInt32(2, true),
        repeat: v.getInt32(6, true),
        metaState: v.getInt32(10, true),
      };
    }
    case 'text': {
      const len = v.getInt32(1, true);
      if (type !== 1 || v.byteLength !== 5 + len) throw new Error('bad text frame');
      return { text: decoder.decode(new Uint8Array(v.buffer, v.byteOffset + 5, len)) };
    }
    case 'set-clipboard': {
      const len = v.getUint32(10, false);
      if (type !== 9 || v.byteLength !== 14 + len) throw new Error('bad clipboard frame');
      if (v.getBigInt64(1, false) !== 0n) throw new Error('clipboard sequence must be 0');
      return {
        paste: v.getUint8(9) === 1,
        text: decoder.decode(new Uint8Array(v.buffer, v.byteOffset + 14, len)),
      };
    }
  }
  throw new Error(`unknown kind ${kind}`);
}

function checkHeader(type: number, wantType: number, len: number, wantLen: number) {
  if (type !== wantType) throw new Error(`type ${type} != ${wantType}`);
  if (len !== wantLen) throw new Error(`length ${len} != ${wantLen}`);
}

// ---- expected wire-level values for a case's args (independent of React) ----

const wrapI16 = (n: number) => ((((n + 0x8000) % 0x10000) + 0x10000) % 0x10000) - 0x8000;

function scrollFixedPoint(ticks: number): number {
  const clamped = Math.max(-1, Math.min(1, ticks / 16));
  const scaled = Math.round(clamped * 0x8000);
  return Math.min(scaled, 0x7fff);
}

const rnd = (n: number) => Math.round(n) + 0; // +0 normalises -0

export function expectedWire(kind: string, a: Args): Args {
  const n = (k: string) => a[k] as number;
  switch (kind) {
    case 'touch':
      return {
        action: n('action'),
        pointerId: n('pointerId'),
        x: rnd(n('x')),
        y: rnd(n('y')),
        videoWidth: n('videoWidth'),
        videoHeight: n('videoHeight'),
        pressure: wrapI16(Math.round(n('pressure') * 0xffff)),
        actionButton: n('actionButton'),
        buttons: n('buttons'),
      };
    case 'scroll':
      return {
        x: rnd(n('x')),
        y: rnd(n('y')),
        videoWidth: n('videoWidth'),
        videoHeight: n('videoHeight'),
        hscrollTicks: scrollFixedPoint(n('hscrollTicks')),
        vscrollTicks: scrollFixedPoint(n('vscrollTicks')),
        buttons: n('buttons'),
      };
    case 'hover':
      return { ...a, x: rnd(n('x')), y: rnd(n('y')) };
    case 'text':
    case 'set-clipboard':
      // Unpaired surrogates are written as U+FFFD, so decoding returns the
      // well-formed string, not the original args (documented in the README).
      return { ...a, text: (a.text as string).toWellFormed() };
    default:
      return { ...a };
  }
}
