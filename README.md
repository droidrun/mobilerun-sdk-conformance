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

Each file in `input/` is `{ "cases": [ ... ] }`. Cases have a unique `name`, the input fields below, and `expect`. Except for geometry, `expect` is an ordered list of `{ "channel": "control" | "hover", "hex": "..." }`; an empty list means no message. Replay each case independently with fresh state, collecting messages in send order and comparing channel and bytes exactly. All channels are open, the video is focused and available, and clipboard reads succeed. These vectors specify routing, not DOM focus, channel availability, frame coalescing or operating-system event translation.

The reference in `generator/src/input.ts` calls the real encoders and constants from the pinned `@mobilerun/react` package; it does not encode bytes itself. Keyboard routing follows `src/hooks/use-scrcpy-input.ts` at React commit `68098f4bb8df0e6af5bc10a093a77b1e63a7423b`, whose hook source matches the published `0.2.1` source map, except for the SDK fallback release described below. Self-tests compare keyboard cases with the actual published hook, assert that explicit divergence, and independently decode and re-encode all generated input messages.

| File | Case inputs | Replay rule and source |
|---|---|---|
| `keys.json` | `type` (`keydown`/`keyup`), `code`, `key`, `shift`, `alt`, `ctrl`, `meta`, `caps_lock`, `clipboard` | Pass one event through React's keyboard routing with the SDK fallback-release exception below. Flags are booleans; `key` is the produced browser key value and `code` is its physical code. Each case is independent, including keyup cases. |
| `ime.json` | `operation`, `text` | Apply one SDK operation: `commit`, `delete`, `composition_update`, or `composition_end`, as described below. |
| `pointers.json` | `video_width`, `video_height`, `events[]` | Start with no active pointers; replay events in array order, concatenate all emitted messages, then compare with `expect`. Each event has `type` (`down`/`move`/`up`/`cancel`), `id`, `x`, `y`, `mouse`, `buttons`. Positions are already in upright video pixels. |
| `geometry.json` | `view_width`, `view_height`, `video_width`, `video_height`, `rotation`, `x`, `y` | Map the view-local point to upright video pixels. `expect` is `{ "x", "y" }` or `null`; no wire message is emitted. Compare coordinates with absolute tolerance `1e-6` pixels. |
| `scroll.json` | `video_width`, `video_height`, `x`, `y`, `h`, `v`, `buttons` | Pass abstract horizontal/vertical ticks directly to React's scroll encoder. Positive ticks mean left/up. The browser's wheel delta-mode conversion and sign inversion have already happened. |

### React paths

Keyboard shortcut handling has first priority on keydown: Ctrl/Cmd+V sends one SET_CLIPBOARD with `paste = true` if `clipboard` is nonempty; Ctrl/Cmd+M sends MENU down and up with no modifiers. Keyup follows normal routing, so these shortcut keys can still emit their ordinary V/M keycode up when Ctrl/Cmd remains held.

Next, React tests `key` for named control/navigation keys, modifier prefixes, arrow prefixes, its `F` prefix heuristic (length at most three UTF-16 code units), or a held Ctrl/Meta flag. These use `codeMap` and emit keycode down/up when mapped. The heuristic also classifies the single uppercase `F` as a control key; F13–F24 are unmapped in the current `codeMap` and emit nothing. Browser NumpadEnter uses `code = "NumpadEnter"`, `key = "Enter"`.

For remaining keys, keydown with `key.length === 1` (UTF-16 code units) sends INJECT_TEXT, including control characters and unknown physical codes. It emits nothing on keyup. Other keydown values use a mapped keycode DOWN fallback. React omits the corresponding fallback keyup; the SDK decision below deliberately fixes that behavior. An unmapped code emits nothing when it reaches the keycode path. A non-BMP emoji occupies two UTF-16 code units and therefore takes the fallback, as the vectors demonstrate.

Keycode metadata contains only SHIFT `1`, ALT `2`, CTRL `4096` and META `65536`. For letter codes `KeyA`–`KeyZ`, effective shift is physical shift XOR CapsLock. CapsLock does not toggle shift for nonletters. Repeat is always zero.

React also supplies the scroll tick-to-i16 fixed-point rule (ticks/16, clamp, round, saturate), the binary encoders, and the pointer rules that ignore outside movement and release UP/CANCEL at the last in-video position. All pointer messages use pressure `1` and PRIMARY for both action button and buttons, including UP/CANCEL, matching the React touch builder calls.

### SDK decisions

**React divergence — fallback key release.** A mapped key that reaches React's noncontrol fallback branch emits INJECT_KEYCODE DOWN on keydown **and UP on keyup**, with the same metadata normalization as control keys. The predicate is: no control-key match, no Ctrl/Meta combo, and `key.length !== 1` in UTF-16 code units. This covers ContextMenu, numpad keys without text (for example with NumLock off), dead keys, and Alt+letter without a character. It also applies when React treats a multi-code-unit value as a fallback. React currently emits only DOWN and can leave these keys pressed. This is an SDK decision; ordinary single-code-unit text keyups still emit nothing, and unmapped fallback codes remain ignored.

React has no IME commit API. `commit` splits text at LF, CR, CRLF and TAB: printable text runs use INJECT_TEXT, CRLF counts as one ENTER down/up, standalone CR/LF use ENTER down/up, and TAB uses TAB down/up. Other C0 controls (`U+0000`–`U+001F`), DEL and C1 controls (`U+007F`–`U+009F`) are dropped and do not break a remaining text run. Unicode outside those ranges is preserved. `delete` uses `text` as the local buffer: only an empty buffer emits DEL down/up. Composition updates remain local; `composition_end` sends the nonempty finalized string as one INJECT_TEXT without splitting. Empty operations emit nothing. Synthetic presses have repeat and metadata zero.

The SDK pointer adapter assigns each touch id the lowest free stable slot `0`–`9`; an eleventh concurrent touch is ignored. A released slot is reusable immediately; duplicate active downs and unmatched touch events are ignored. Mouse identity is separate from touch identity, ignores the event's `id`, and always uses wire pointer id `-1`. Bounds are inclusive. An outside DOWN is ignored. Active MOVE outside is ignored; UP/CANCEL releases at the last valid position even if the release coordinates are elsewhere. Mouse MOVE with no active mouse gesture emits a hover frame on `hover`, preserving `buttons`; it never falls back to `control`. These abstract mouse/hover events and slot allocation are SDK decisions; the underlying hover encoder/channel and last-position rule come from React.

Geometry is an SDK input contract built on aspect-fit letterboxing. `rotation` is clockwise degrees (`0`, `90`, `180`, `270`) applied to the decoded `video_width`/`video_height`: 90/270 swap dimensions. Both the input view point and output video point use the upright picture's axes, so no additional inverse rotation is applied. Fit that upright picture inside the view, center it, reject points in the letterbox, and map inclusively onto video pixels without rounding. Nonpositive view/video dimensions yield `null`. Wire encoders perform coordinate rounding later. Inputs are finite JSON numbers; dimensions are integers.

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
- Documented React routing parity separately from SDK decisions; added published-hook parity and input-message round-trip self-tests.
- Release mapped noncontrol fallback keys on keyup as an explicit SDK divergence from React's missing release.
- Existing control, signalling and reconnect fixture files are unchanged.

### v0.1.1

- Added malformed-UTF-16 cases to `control/text` and `control/set-clipboard`.
- Removed the duplicated handshake timeouts from `reconnect/policy.json`; consumers read them from `signalling/sequence.json`.

## License

Apache-2.0, see `LICENSE`.
