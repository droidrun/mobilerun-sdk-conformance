# mobilerun-sdk-conformance

Shared conformance fixtures for the Mobilerun device stream SDKs (Swift, Kotlin, Flutter, React).

Control, signalling, reconnect and input fixtures are generated from the published `@mobilerun/react`
package (pinned to an exact version). Token-provider fixtures are independently specified lifecycle
oracles with separate source provenance below. CI fails if regeneration changes any fixture.

The fixtures cover control messages, signalling messages, reconnect scenarios, local input routing
and per-socket token providers. Event frames are not part of this stage.

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
  credentials/
    token-provider.json       per-socket credential acquisition and lifecycle oracles
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

### Token-provider fixtures

`credentials/token-provider.json` is additive; it does not extend the reconnect controller's event
vocabulary. Its root contains `schema_version: 1`, `reference: {repo, commit, decision}`,
`provider_timeout_ms: 10000`, `connect_timeout_ms: 45000`, and `cases`. These are literal lifecycle
oracles in `generator/src/token-provider-cases.ts`, not outputs of the published React `0.2.1` package.
The reference is `droidrun/mobilerun-react` at
[`6f139eca842def898b61146428f90bb7ef22e830`][token-provider-source],
specifically `src/hooks/use-webrtc-connection.ts`, its tests, and `src/lib/stream-reconnect.ts`.
Decision D14 requires immediate media teardown on close 1001 in both credential modes.

[token-provider-source]:
  https://github.com/droidrun/mobilerun-react/commit/6f139eca842def898b61146428f90bb7ef22e830

Each case has a unique `name`, `mode` (`provider` or `static`), `url`, optional `static_token`,
`steps`, and `expect`. All keys are synthetic test strings and all non-loopback hosts use `.invalid`.
The initial target is `a`, with callback identity `provider-a` in provider mode. Static mode has no
callback; an omitted static token means nil/absent, and an empty token retains the existing URL
query behavior. Provider mode never falls back to a static or embedded query token.
The static token field/path is deprecated; target discovery remains a separate callback and keeps
its existing semantics. The per-target async `tokenProvider` runs once per new socket, with an
independent deadline and exactly one normal failure for a throw, rejection, blank key or timeout.
Keep the returned key transient to the socket; never cache it in the committed target.

Replay each case against the SDK's actual session engine or React hook, with fake time, external
transports and provider IO. Do not implement a second token/session engine in the fixture adapter.
Use jitter `0.5` and the existing `reconnect/policy.json` limits (six retries); discovery and heal
callbacks return the current target unchanged and never mint keys. Mount each scheduled attempt
immediately. Begin with no sockets, peers, media or pending screenshots and a visible application.
Use the normal successful, empty-ICE-server configuration, offer/answer and channel setup when
opening/configuring a peer; `peer_connected` completes that negotiation with live media/channels.

Every step has `at_ms` and `event`. This vocabulary belongs only to this file:

- `start`: start the session; optional `visible` sets initial visibility.
  `provider_throws: true` makes the callback throw synchronously.
- `provider_resolve`: resolve named `request_id` with raw string `value`.
- `provider_reject`: reject named `request_id` with a generic synthetic error.
- `socket_open`: open the current allocated fake socket.
- `config`: deliver valid RTC configuration on that socket, including a refresh response when requested.
- `peer_connected`: mark the current peer connected with live media and both negotiated channels.
- `socket_close`: close the current socket with integer `code`; before open this is a refused upgrade.
- `target_replace`: commit `target: {id, url, provider}`; callback identity is a fake-provider label.
- `stop`, `dispose`, `parent_cancel`: invalidate the attempt and cancel owned work without waiting
  for provider cooperation. Map parent cancellation to disposal where no parent scope exists.
- `ICE_refresh`: request the existing socket's ICE credential/configuration refresh.
- `screenshot`: start a screenshot request and leave its response pending.
- `visibility`: set `visible` and deliver the SDK's visibility/lifecycle signal.
- `retry`, `wake`: invoke manual retry (after exhaustion) or wake (during backoff).

Name provider calls `p1`, `p2`, etc. in invocation order across the whole case, including retries
and target replacements. A call stays externally settleable after timeout, stop or cancellation;
the fake provider deliberately ignores cancellation. Every new attempt captures its current target's
callback once. A same-id/same-URL callback-only replacement neither invalidates the in-flight call
nor restarts healthy media; the next attempt uses the new callback. A changed logical target
invalidates the previous attempt before any await.

Replay with a fake clock starting at zero and `i = 0`:

1. Keep common expectations plus those for the selected profile. For every row with
   `after_steps == i`, advance to `at_ms` in ascending order, drain async queues, then assert.
2. Advance to `steps[i].at_ms`, firing due timers in deadline order (insertion order breaks ties).
   Drain async queues after each timer so an async failure schedules backoff at its deadline.
3. Apply that step, drain async queues, increment `i`, and repeat. Stop after all expectations.

At equal timestamps, timers fire before steps; `after_steps` distinguishes observations before
and after an event. Expectations are partial observations: assert every supplied field, including
nested fields, and ignore omitted fields. Absolute timer deadlines make allocation timing observable:

- `provider_calls`, `socket_allocations`, `failures`, `heal_calls`: cumulative call, allocation,
  normal attempt-failure and heal counts; never reset on retry.
- `last_provider`: callback identity captured by the latest provider invocation.
- `last_socket`: latest allocation's `target` id and decoded `token` (null if absent). Optional
  `token_count` and ordered decoded `other_query` pairs assert URL replacement semantics.
- `status`: normalized reconnect status: `connecting`, `connected`, `reconnecting`, `unavailable`.
- `timers`: current attempt's `provider`, `connect`, `ws_open`, `rtc_config`, `retry` absolute
  deadlines; null means absent. Stale attempts own no timers.
- `media_active`: the current session still retains connected media.
- `peer_released`, `channels_released`, `media_released`: all corresponding resources from the
  last connected peer have been released.
- `pending_screenshots`: outstanding screenshot requests, cleared/settled during teardown.
- `keepalive_active`, `keepalive_sent`: a keepalive timer is bound to the current socket;
  cumulative keepalive messages sent on it.
- `state_unchanged_since_step`: no new state notification, failure, allocation or resource/timer
  change since the last observation at that `after_steps` checkpoint. Compare after draining async
  queues; exclude clock movement and fake-provider settlement itself.
- `profile`: apply the row only to `react` or `native`; never silently skip an unknown profile.

Only the connected-close-1006 cases use profiles. React preserves connected media and does not
schedule a reconnect for that close. The native profile preserves its existing rebuild behavior:
Kotlin releases on the next remount, while Swift and Flutter release immediately. Native rows
therefore assert teardown by the next attempt, without imposing a new immediate-1006 rule.
Historical native baselines are Kotlin `27f29c8c2017aaf4e04293cdfc3d2638e4e58a5f`,
Swift `84ecab04bafcde82b3c2c9f2eda08389a02b81d5`, and
Flutter `f586a15a381ffda6806c84a1a071c89ae4226167`.
Close 1001 has no profile exception: peer, channels, media references, keepalive/startup timers
and pending screenshots are released immediately, followed by normal bounded reconnect.

The watchdog case resolves each key at 9000ms into its attempt, completes socket-open/configuration,
then stalls ICE. It tests the full 45000ms socket budget through the final retry, independently of
the 10000ms provider deadline and the two 15000ms handshake phase budgets. Raw nonblank keys are
preserved; trimming is validation only. Provider-mode URL validation precedes callback invocation:
WSS needs a valid host, and WS permits only localhost, 127.0.0.1 or IPv6 loopback. Static URL handling
stays unchanged. ICE refresh on an existing socket does not invoke the provider.

The fixture self-test validates integrity, coverage, boundaries and reproducible serialization;
it does **not** prove runtime SDK compliance. SDK adapters must claim every case name exactly once,
reject unknown events/observations, and replay the whole file through the real lifecycle. Existing
controller-only reconnect suites remain valid but cannot replace these session-level replays.
Consumers opt into an approved release tag via their existing sync scripts; do not track this
development branch or claim four-SDK conformance before all four adapters pass the same pinned tag.
This addition leaves existing fixture bytes unchanged and assigns no new release/tag itself.

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

CI runs the same steps and fails on any diff in `fixtures/`, including input and credential vectors.
The self-tests decode control fixtures, replay reconnect scenarios against the reference controller,
check input routing and geometry, and validate the independent token-provider fixture contract.

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
