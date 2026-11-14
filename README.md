# mobilerun-sdk-conformance

Shared conformance fixtures for the Mobilerun device stream SDKs (Swift, Kotlin, Flutter, React).

The fixtures are generated from the published `@mobilerun/react` package (pinned to an exact version), so every SDK is tested against the bytes and messages the React package actually produces. A CI check fails if regenerating the fixtures changes anything.

The fixtures cover control messages, signalling messages, reconnect scenarios and local input routing. Event frames are not part of this stage.

## Layout

```
fixtures/
  constants.json              control message types, AMOTION_EVENT values, ANDROID_KEYS, keyboard code map
  control/<builder>.json      array of { name, args, hex } per control message builder
    touch, scroll, hover, keycode, text, set-clipboard
  signalling/
    client-*.json             JSON text frames the client sends
    server-*.json             JSON text frames the client receives
    sequence.json             ordered happy-path exchange, mid-session refresh, timings, data channels
  reconnect/
    policy.json               reconnect constants and the backoff delay table
    scenarios.json            reconnect state machine scenarios as data
  input/
    keys.json                 keyboard event routing and modifier normalization
    ime.json                  SDK text commit and composition decisions
    pointers.json             touch slots, mouse gestures and hover channel routing
    geometry.json             letterbox mapping and upright rotation dimensions
    scroll.json               abstract wheel ticks to wire messages
generator/                    Bun + TypeScript generator and self-tests
```

All JSON is language-neutral. Integers, including the 64-bit `pointerId`, are JSON numbers within ±2^53; bytes are lowercase hex. Control and policy files are flat; the signalling and `sequence.json` files are nested. Key casing: snake_case except names taken from React or the wire (control args, signalling fields, data-channel options).

## Consuming from an SDK

Pin a git tag of this repository (for example `v0.1.0`) as a submodule, a pinned checkout in CI, or a downloaded tarball, and read `fixtures/` from it. Never track a branch.

### Control fixtures

Each file is `{ "cases": [ ... ] }` and each case is `{ "name", "args", "hex" }`. `args` are the named arguments of the React builder, with defaults made explicit. Encoding `args` with your SDK must produce exactly `hex`. Decoding is the inverse where the format is lossless (see the notes below).

Wire layouts (offsets in bytes; `LE` little-endian, `BE` big-endian):

| message | size | layout |
|---|---|---|
| touch (type 2) | 32 | `u8 type`, `u8 action`, `i64 pointerId BE`, `i32 x LE`, `i32 y LE`, `u16 videoWidth LE`, `u16 videoHeight LE`, `i16 pressure LE`, `i32 actionButton LE`, `i32 buttons LE` |
| scroll (type 3) | 21 | `u8 type`, `i32 x LE`, `i32 y LE`, `u16 videoWidth LE`, `u16 videoHeight LE`, `i16 hscroll LE`, `i16 vscroll LE`, `i32 buttons LE` |
| hover (type 21) | 17 | `u8 type`, `i32 x LE`, `i32 y LE`, `u16 videoWidth LE`, `u16 videoHeight LE`, `i32 buttons LE` |
| keycode (type 0) | 14 | `u8 type`, `u8 action`, `i32 keycode LE`, `i32 repeat LE`, `i32 metaState LE` |
| text (type 1) | 5 + n | `u8 type`, `i32 length LE`, `n` UTF-8 bytes |
| set-clipboard (type 9) | 14 + n | `u8 type`, `i64 sequence BE` (always 0), `u8 paste` (0 or 1), `u32 length BE`, `n` UTF-8 bytes |

Notes that every port must match:

- **Pointer id byte order.** React writes the touch pointer id big-endian; consumers must match these bytes. Mouse is pointer id `-1`, which is `ffffffffffffffff`.
- `x` and `y` are rounded with `Math.round` (half rounds toward +infinity: `2.5 → 3`, `-0.5 → 0`, `-1.5 → -1`).
- `pressure` is `round(pressure * 0xffff)` stored in an `i16`, so a pressure of `1.0` is `0xffff`, which is `-1` as `i16`. Cases `pressure 0.5` and `pressure 0` cover other values.
- Scroll ticks are divided by 16, clamped to `[-1, 1]`, multiplied by `0x8000`, rounded, and capped at `0x7fff`. Positive means up/left.
- `videoWidth`/`videoHeight` are `u16`; the fixtures stay within range.
- Text is UTF-8 encoded from the string as is (no normalisation), with one exception: an unpaired UTF-16 surrogate is written as U+FFFD (`efbfbd`), because React uses `TextEncoder`. Cases `lone high surrogate`, `lone low surrogate inside text`, `high surrogate at end after ascii` and `reversed surrogate pair` cover this (each unpaired surrogate becomes one `efbfbd`). Their `args.text` is stored with JSON `\uXXXX` escapes (for example `"ok\ud83d"`), which are not well-formed Unicode: consumers must parse lone surrogates (JSON parsers in Dart, Kotlin and Swift may reject or replace them; use a parser or a hex/escape workaround that keeps the code unit). Decoding these frames yields the U+FFFD text, not `args.text`, so the round trip is lossy for them.

### Signalling fixtures

Each `client-*`/`server-*` file is `{ type, direction, description, fields[]{name, type, required, notes?}, examples[]{name, json}, notes?[] }`. `sequence.json` lists the ordered exchanges (`happy_path`, `refresh`), the timings, the two negotiated data channels (control id 1 ordered and reliable, hover id 2 unordered with `maxRetransmits: 0`), the failure triggers and what is ignored.

### Reconnect fixtures

`policy.json` holds the constants and a table of `delay_cases`. The handshake timeouts `ws_open_timeout_ms` and `rtc_config_timeout_ms` live only in `signalling/sequence.json` (`timing`); the watchdog invariant `connect_timeout_ms > ws_open_timeout_ms + rtc_config_timeout_ms` reads them from there (`attempt`, `random`, `delay_ms`).

`scenarios.json` is `{ events, scenarios }` (`events` lists the event vocabulary); each scenario is `{ name, random, steps, expect }`:

- `random` is the constant the jitter source returns (0.5 means no jitter).
- `steps[]` is `{ at_ms, event }` on a fake clock. Events: `attempt_mounted`, `connected`, `disconnected`, `failure`, `wake`, `retry`, `disable`, `dispose`. They map to the controller methods `attemptMounted`, `handleConnected`, `handleDisconnected`, `handleFailure`, `handleWake`, `retry`, `setDisabled`, `dispose`.
- `expect[]` is `{ at_ms, after_steps, status, attempt, heal_calls, remount_calls }`, plus optionally `defer_target_change` (the value of `shouldDeferTargetChange()`) and `pending_timers` (number of timers still scheduled).

Replay algorithm, with a fake clock starting at 0 that fires due timers in due-time order (timers due at the same time fire in the order they were scheduled), and `i = 0`:

1. Evaluate every expectation with `after_steps == i`, in ascending `at_ms`: advance the clock to `at_ms`, then compare.
2. If steps remain: advance the clock to `steps[i].at_ms`, apply the event, `i += 1`, go to 1.

`heal_calls` and `remount_calls` count calls of the heal and remount callbacks. The mount callback is not simulated: a scenario contains an explicit `attempt_mounted` step wherever the host would have remounted.

The scenarios are the cases of the React package's reconnect unit tests. Their hand-checked values were copied from the assertions; fields the original test does not assert were recorded from the reference controller.

#### Manual ports

None. Every case is expressible as data. The two delay-function tests are in `policy.json` (`delay_cases`), and the watchdog-budget test is the policy invariant `connect_timeout_ms > ws_open_timeout_ms + rtc_config_timeout_ms` (timeouts from `sequence.json` timing).

## Input vectors

Each file in `input/` is `{ "cases": [ ... ] }`. Each case has a unique `name`, the inputs below,
and `expect`. Except for geometry, `expect` is an ordered list of
`{ "channel": "control" | "hover", "hex": "..." }`; an empty list means no message.
Replay each case independently with fresh state, collect messages in send order, then compare
channel and bytes exactly. Keyboard and pointer cases replay their entire `events[]` array.
All channels are open, the video is focused and available, and clipboard reads succeed.
These vectors specify routing, not DOM focus, channel availability, frame coalescing or native
operating-system event translation.

The reference in `generator/src/input.ts` uses the real encoders and constants from the pinned
`@mobilerun/react` package; it does not encode bytes itself. The React path comes from
`src/hooks/use-scrcpy-input.ts` at commit `68098f4bb8df0e6af5bc10a093a77b1e63a7423b`.
Its hook source matches the published `0.2.1` source map. Self-tests exercise that actual hook,
derive the sequences whose output differs from the reference, and require that set to equal the
sequences labelled with SDK decisions. All generated messages have independent decode, hex and
channel checks; the existing control fixtures also retain their encoder round-trip checks.

| File | Case inputs | Replay rule |
|---|---|---|
| `keys.json` | `events[]`, `sdk_decisions[]` | Stateful keyboard replay; React path plus SDK decisions below. |
| `ime.json` | `operation`, `text` or `composition_text` | One SDK composition/commit operation. |
| `pointers.json` | Video dimensions, `events[]` | `buttons` only in hover; mouse ignores `id`; SDK slots. |
| `geometry.json` | View/video dimensions, `rotation`, `x`, `y` | Map into upright video pixels or reject. |
| `scroll.json` | Video dimensions, `x`, `y`, `h`, `v`, `buttons` | React bounds check and tick encoder. |

**Lone-surrogate JSON warning:** input strings can contain unpaired UTF-16 surrogate escapes,
for example `"\ud83d"` in keyboard `key` or IME `text`. Dart, Kotlin and Swift JSON parsers may
reject or replace these strings. Use a parser or escape/hex workaround that preserves the original
code unit for routing. The React `TextEncoder` writes each unpaired surrogate as U+FFFD (`efbfbd`),
so decoding its wire frame is lossy. This is the same parsing requirement as the control fixtures.

### Keyboard: React path

Every event has `type` (`keydown`/`keyup`), `code`, `key`, `shift`, `alt`, `ctrl`, `meta`,
`caps_lock` and `clipboard`. Flags are booleans. `key` is the produced browser key value; `code`
is the physical code. Replay all events on a fresh set of pressed codes. `sdk_decisions` lists
output-changing decisions for that sequence: `tracked_key_release` and/or `grapheme_text`.
An empty list means that sequence's complete output matches React.

On keydown, React shortcut handling has first priority: Ctrl/Cmd plus produced key `v` sends
SET_CLIPBOARD with `paste = true` when `clipboard` is nonempty; Ctrl/Cmd plus produced key `m`
sends MENU down/up with metadata zero. Matching uses `key`, case-insensitively, regardless of
`code`. Thus Ctrl+key `v` on code Period pastes, while Ctrl+key `.` on code KeyV injects KEYCODE_V.

Next, React checks named control/navigation keys, modifier prefixes, arrow prefixes, its `F`
prefix heuristic (length at most three UTF-16 code units), or held Ctrl/Meta. These use `codeMap`.
The heuristic classifies uppercase `F` as a control key. F13 represents unmapped F13–F24.
Browser NumpadEnter has `code = "NumpadEnter"`, `key = "Enter"`.

For remaining keys, a single UTF-16 code unit uses INJECT_TEXT, including control characters and
unknown physical codes. Other values use a mapped keycode DOWN fallback, except for the grapheme
SDK decision below. Unmapped fallback codes emit nothing. Named values such as `Dead` and
`ContextMenu` stay keys, as do strings with multiple grapheme clusters.

Keycode metadata contains only SHIFT `1`, ALT `2`, CTRL `4096` and META `65536`. For letter
codes `KeyA`–`KeyZ`, effective shift is physical shift XOR CapsLock. CapsLock does not toggle shift
for nonletters. Repeat is always zero. The modifier-mask vectors use a control key so every mask
actually exercises keycode metadata.

### Keyboard: SDK decisions

**Tracked key release (`tracked_key_release`).** Record a physical `code` only when its keydown
emits INJECT_KEYCODE DOWN. Keyup emits UP only if that code is still recorded, then removes it.
Use the keyup event's current metadata, even if a modifier was released first or the produced
`key` changed. Text input and paste/menu shortcuts do not record their physical code; MENU's
synthetic down/up is already complete. Unmatched and duplicate keyups emit nothing.

React divergence: React omits fallback releases and can emit orphan V/M releases after shortcuts;
SDK replay balances sent keycode DOWNs and suppresses every UP without a recorded DOWN.

**Grapheme text (`grapheme_text`).** Outside the control/shortcut path, a produced value that is
exactly one extended grapheme cluster (Unicode UAX #29) with more than one UTF-16 code unit uses INJECT_TEXT on
keydown. This includes emoji, ZWJ/skin-tone sequences and NFD combining sequences. Preserve the
string without normalization. Multi-unit values containing control characters are not printable
graphemes. Text still emits nothing on keyup because it did not record a keycode DOWN.

React divergence: React treats these multi-unit values as keycode fallbacks, or ignores them if
the physical code is unmapped; the SDK sends their produced text.

### IME: SDK decisions

`commit`, `composition_update` and `composition_end` have a `text` field. Both `commit` and
`composition_end` split finalized text by the same rule: printable runs use INJECT_TEXT,
CRLF counts as one ENTER down/up, standalone CR/LF uses ENTER down/up, and TAB uses TAB down/up.
Other C0 controls (`U+0000`–`U+001F`), DEL and C1 controls (`U+007F`–`U+009F`) are dropped and
do not break the remaining text run. Other Unicode is preserved. Composition updates stay local.
Empty text emits nothing. Synthetic presses have repeat and metadata zero.

`delete` instead has `composition_text`: the current **uncommitted marked composition text**,
not previously committed text or the remote editor's contents. If that marked text is nonempty,
the deletion stays local. If it is empty, emit DEL down/up. React has no IME commit API; these
are SDK decisions, with no separate raw-control path for finalized composition.

### Pointers: React path and SDK decisions

Each event has `type` (`down`/`move`/`up`/`cancel`), `id`, `x`, `y`, `mouse`, `button` and
`buttons`. Positions and `video_width`/`video_height` use upright video pixels. `id` is ignored
when `mouse` is true. `button` is the event's changed-button ordinal: `0` primary, `1` middle,
`2` secondary. Only primary down/up starts or ends a gesture; touch events use `button = 0`.
Other button down/up events emit no touch frame. CANCEL releases an active gesture regardless
of the changed button.

`buttons` is the held-button mask and reaches the wire **only in hover frames** (`1` primary,
`2` secondary, `4` middle). Gesture frames always use PRIMARY for both action button and buttons,
and pressure `1`, including UP/CANCEL, matching the React path.

The SDK decision assigns each touch id the lowest free stable slot `0`–`9`; an eleventh
concurrent touch is ignored. Released slots are immediately reusable; duplicate downs and
unmatched touch events are ignored. Mouse identity is separate and always uses wire id `-1`.

React divergence: React forwards raw touch identifiers; the SDK assigns bounded reusable slots.

The React path uses inclusive video bounds, ignores outside DOWN and MOVE, and releases UP/CANCEL
at the last in-video position even when release coordinates are elsewhere. Mouse MOVE with no
active mouse gesture emits a hover frame on `hover`, preserving `buttons`; it never falls back
to `control`. A touch slot being active does not prevent independent mouse hover. The abstract
pointer event vocabulary is an SDK input contract; primary-button and channel rules match React.

### Geometry: SDK decisions

Cases have `view_width`, `view_height`, decoded `video_width`, `video_height`, `rotation`, `x`
and `y`. `rotation` is clockwise degrees (`0`, `90`, `180`, `270`); 90/270 swap decoded dimensions.
Fit the upright picture inside the view, center it and reject points in the letterbox. Valid
`expect` is `{ "width", "height", "x", "y" }`, with upright video dimensions and the mapped point;
invalid geometry or outside points return `null`. Compare coordinates within `1e-6` pixels.
Nonpositive view/video dimensions are invalid. Both point axes already describe the upright
picture, so no inverse rotation is applied. No wire message is emitted by geometry.

**Pointers and scroll must use `expect.width`/`expect.height` as their video dimensions**, including
for rotation 90/270, rather than the decoded frame dimensions. Mapping does not round coordinates;
the wire encoders round later. Inputs are finite JSON numbers and dimensions are integers.
React supplies aspect-fit mapping; rotation/dimension output is an SDK input contract.

### Scroll: React path

Cases have `video_width`, `video_height`, `x`, `y`, abstract ticks `h`, `v`, and held `buttons`.
Reject nonpositive video dimensions and outside points using the same inclusive bounds as pointers;
these cases have `expect: []`. Otherwise pass ticks directly to React's scroll encoder: ticks/16,
clamp to `[-1, 1]`, multiply by `0x8000`, round and cap at `0x7fff`. Positive ticks mean left/up.
Browser delta-mode conversion and sign inversion have already happened before this input boundary.

## Regeneration

```sh
cd generator
bun install --frozen-lockfile
bun run generate      # rewrites ../fixtures
bun test              # round-trip self-test
git diff --exit-code ../fixtures
```

`@mobilerun/react` is pinned to exactly `0.2.1`. The reconnect controller is not exported by the package, so `generator/vendor/stream-reconnect.ts` is an unmodified copy of `src/lib/stream-reconnect.ts` at the `v0.2.1` tag of `droidrun/mobilerun-react` (SHA-256 `af808d3a02622d8e143d8cd2551f7fdb4c203ab3e93545d1f0a974cd7c705f9b`, Apache-2.0, copyright Mobilerun). Signalling shapes are derived by hand from the same release and are not machine-extracted.

To move to a newer React release: bump the pin, refresh the vendored file from the same tag, regenerate, review the fixture diff and release a new tag.

CI runs the same steps and fails on any diff in `fixtures/`, including input vectors. The self-test decodes every control fixture back to its arguments with an independent decoder, replays every reconnect scenario against the reference controller, and checks input routing, channel selection, slot allocation and geometry against the rules above.

## Versioning

Semantic version tags (`v0.1.0` after the first merge). A change that alters any fixture byte is a new tag; a change that breaks existing consumers (renamed file, changed shape) is a major bump from `v1.0.0` on.

## Changelog

### v0.2.0

- Added language-neutral input vectors for keyboard routing, modifiers, IME commits, touch slots, mouse/hover, letterbox geometry and scroll ticks.
- Documented React paths separately from SDK decisions; check the exact divergence set against the published hook.
- Track keycode DOWNs for balanced releases and route one grapheme as text; label React divergences.
- Existing control, signalling and reconnect fixture files are unchanged.

### v0.1.1

- Added malformed-UTF-16 cases to `control/text` and `control/set-clipboard`.
- Removed the duplicated handshake timeouts from `reconnect/policy.json`; consumers read them from `signalling/sequence.json`.

## License

Apache-2.0, see `LICENSE`.
