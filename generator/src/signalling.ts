import { createRTCConfigurationRequest } from '@mobilerun/react';
import {
  STREAM_RTC_CONFIG_TIMEOUT_MS,
  STREAM_WS_OPEN_TIMEOUT_MS,
} from '../vendor/stream-reconnect';

interface Field {
  name: string;
  type: string;
  required: boolean;
  notes?: string;
}
interface Doc {
  type: string;
  direction: 'client_to_server' | 'server_to_client';
  description: string;
  fields: Field[];
  examples: { name: string; json: unknown }[];
  notes?: string[];
}

const SID = 'sess_0123456789abcdef';
const SDP_OFFER =
  'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
const SDP_ANSWER =
  'v=0\r\no=- 7614219274584779017 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
const CANDIDATE = 'candidate:842163049 1 udp 1677729535 203.0.113.7 46154 typ srflx raddr 0.0.0.0 rport 0 generation 0';
const ICE_SERVERS = [
  { urls: ['stun:stun.example.test:3478'] },
  { urls: ['turn:turn.example.test:3478?transport=udp', 'turns:turn.example.test:5349?transport=tcp'], username: '1700000000:user', credential: 'cred-example' },
];

const sessionId: Field = { name: 'sessionId', type: 'string', required: true };
const typeField = (t: string): Field => ({ name: 'type', type: `string (constant "${t}")`, required: true });

const iceCandidateFields: Field[] = [
  { name: 'candidate', type: 'string', required: true, notes: 'SDP candidate line, passed as RTCIceCandidateInit.candidate' },
  { name: 'sdpMid', type: 'string | null', required: true, notes: 'May be null' },
  { name: 'sdpMLineIndex', type: 'integer | null', required: true, notes: 'May be null' },
];

export function buildSignalling(): Record<string, Doc> {
  const requestConfig = createRTCConfigurationRequest(SID);
  return {
    'client-request-rtc-configuration': {
      type: 'requestRtcConfiguration',
      direction: 'client_to_server',
      description: 'First message after the WebSocket opens. Asks the server for the RTCConfiguration (ICE servers).',
      fields: [
        typeField('requestRtcConfiguration'),
        sessionId,
        { name: 'supportsLiveRtcRefresh', type: 'boolean (constant true)', required: true, notes: 'Opt-in to unsolicited mid-session rtcConfiguration pushes. The client always sends true.' },
      ],
      examples: [{ name: 'as produced by createRTCConfigurationRequest', json: requestConfig }],
    },
    'client-offer': {
      type: 'offer',
      direction: 'client_to_server',
      description: 'SDP offer. Sent once after the peer connection is set up, and again for every mid-session ICE-restart.',
      fields: [typeField('offer'), { name: 'sdp', type: 'string', required: true }, sessionId],
      examples: [{ name: 'initial offer', json: { type: 'offer', sdp: SDP_OFFER, sessionId: SID } }],
    },
    'client-candidate': {
      type: 'candidate',
      direction: 'client_to_server',
      description: 'A locally gathered ICE candidate, sent as soon as it is gathered (trickle ICE). The end-of-candidates null event is not sent.',
      fields: [typeField('candidate'), ...iceCandidateFields, sessionId],
      examples: [{ name: 'srflx candidate', json: { type: 'candidate', candidate: CANDIDATE, sdpMid: '0', sdpMLineIndex: 0, sessionId: SID } }],
    },
    'client-keep-alive': {
      type: 'keepAlive',
      direction: 'client_to_server',
      description: 'Sent every 10 s while the page is visible and the socket is open.',
      fields: [typeField('keepAlive'), sessionId],
      examples: [{ name: 'keepAlive', json: { type: 'keepAlive', sessionId: SID } }],
    },
    'client-request-frame': {
      type: 'requestFrame',
      direction: 'client_to_server',
      description: 'Asks the encoder for a fresh frame. Sent 12 times, 125 ms apart, starting when the control data channel opens.',
      fields: [typeField('requestFrame'), sessionId],
      examples: [{ name: 'requestFrame', json: { type: 'requestFrame', sessionId: SID } }],
    },
    'client-open-url': {
      type: 'openUrl',
      direction: 'client_to_server',
      description: 'Optional. Sent once when the control data channel opens, only if the embedding app supplied a URL to open.',
      fields: [
        typeField('openUrl'),
        { name: 'url', type: 'string', required: true, notes: 'The supplied URL after decodeURIComponent; if decoding throws, the supplied value unchanged' },
        sessionId,
      ],
      examples: [
        { name: 'percent-encoded input', json: { type: 'openUrl', url: 'https://example.test/path?q=a b', sessionId: SID }, },
      ],
      notes: ['Input "https%3A%2F%2Fexample.test%2Fpath%3Fq%3Da%20b" yields the shown url.'],
    },
    'client-screenshot-request': {
      type: 'screenshot',
      direction: 'client_to_server',
      description: 'Requests a screenshot. The reply (screenshot or screenshotError) carries the same id.',
      fields: [
        typeField('screenshot'),
        { name: 'id', type: 'string', required: true, notes: 'Client-chosen correlation id; React uses "ui-ss-<epoch ms>-<7 random base36 chars>"' },
      ],
      examples: [{ name: 'screenshot request', json: { type: 'screenshot', id: 'ui-ss-1700000000000-k3j9x2a' } }],
      notes: ['No sessionId in this message.', 'The client rejects the pending request after 30000 ms without a reply.'],
    },
    'server-rtc-configuration': {
      type: 'rtcConfiguration',
      direction: 'server_to_client',
      description:
        'ICE configuration. The first one is the reply to requestRtcConfiguration. Later ones are unsolicited mid-session credential refreshes (only sent to clients that advertised supportsLiveRtcRefresh).',
      fields: [
        typeField('rtcConfiguration'),
        { name: 'rtcConfiguration', type: 'object (RTCConfiguration)', required: true, notes: 'Initial reply: the whole object is given to the RTCPeerConnection constructor. Refresh: only iceServers is read.' },
        { name: 'rtcConfiguration.iceServers', type: 'array of {urls: string | string[], username?: string, credential?: string}', required: false, notes: 'Required for a refresh to have any effect: a refresh without iceServers is ignored.' },
      ],
      examples: [
        { name: 'initial reply', json: { type: 'rtcConfiguration', rtcConfiguration: { iceServers: ICE_SERVERS } } },
        { name: 'mid-session refresh', json: { type: 'rtcConfiguration', rtcConfiguration: { iceServers: ICE_SERVERS } } },
        { name: 'refresh without iceServers (ignored)', json: { type: 'rtcConfiguration', rtcConfiguration: {} } },
      ],
      notes: [
        'Which of the two it is depends only on arrival order: the first rtcConfiguration after the request is the reply; any later one is a refresh.',
      ],
    },
    'server-answer': {
      type: 'answer',
      direction: 'server_to_client',
      description: 'SDP answer to the latest offer (initial or ICE-restart).',
      fields: [typeField('answer'), { name: 'sdp', type: 'string', required: true }],
      examples: [{ name: 'answer', json: { type: 'answer', sdp: SDP_ANSWER } }],
      notes: ['A failing setRemoteDescription (e.g. a stale answer) is ignored; buffered candidates stay buffered.'],
    },
    'server-candidate': {
      type: 'candidate',
      direction: 'server_to_client',
      description: 'A remote ICE candidate. Buffered until the remote description is set, then applied.',
      fields: [typeField('candidate'), ...iceCandidateFields],
      examples: [{ name: 'remote candidate', json: { type: 'candidate', candidate: CANDIDATE, sdpMid: '0', sdpMLineIndex: 0 } }],
    },
    'server-screenshot': {
      type: 'screenshot',
      direction: 'server_to_client',
      description: 'Successful screenshot reply.',
      fields: [
        typeField('screenshot'),
        { name: 'id', type: 'string', required: true, notes: 'Must match a pending request, otherwise ignored' },
        { name: 'dataUri', type: 'string', required: true, notes: 'e.g. "data:image/png;base64,..."' },
      ],
      examples: [{ name: 'screenshot', json: { type: 'screenshot', id: 'ui-ss-1700000000000-k3j9x2a', dataUri: 'data:image/png;base64,iVBORw0KGgo=' } }],
      notes: ['A message missing a string id or string dataUri is ignored.'],
    },
    'server-screenshot-error': {
      type: 'screenshotError',
      direction: 'server_to_client',
      description: 'Failed screenshot reply.',
      fields: [
        typeField('screenshotError'),
        { name: 'id', type: 'string', required: true, notes: 'Must match a pending request, otherwise ignored' },
        { name: 'message', type: 'string', required: true },
      ],
      examples: [{ name: 'error', json: { type: 'screenshotError', id: 'ui-ss-1700000000000-k3j9x2a', message: 'capture failed' } }],
      notes: ['A message missing a string id or string message is ignored.'],
    },
  };
}

export function buildSequence() {
  const timing = {
    ws_open_timeout_ms: STREAM_WS_OPEN_TIMEOUT_MS,
    rtc_config_timeout_ms: STREAM_RTC_CONFIG_TIMEOUT_MS,
    request_frame_count: 12,
    request_frame_interval_ms: 125,
    keep_alive_interval_ms: 10_000,
    ice_restart_grace_ms: 15_000,
    screenshot_timeout_ms: 30_000,
  };
  const channels = {
    control: { label: 'control', id: 1, negotiated: true, ordered: true, maxRetransmits: null, notes: 'reliable, ordered; carries all binary control messages' },
    hover: { label: 'hover', id: 2, negotiated: true, ordered: false, maxRetransmits: 0, notes: 'unordered, no retransmits; carries hover messages only, dropped (never sent on control) while not open' },
  };
  const peerConnection = {
    transceivers: [
      { kind: 'audio', direction: 'recvonly' },
      { kind: 'video', direction: 'recvonly', notes: 'codec preference order: VP9, H265/HEVC, H264/AVC, then the rest' },
    ],
    ice_servers_from: 'rtcConfiguration reply',
  };
  const step = (n: number, actor: string, action: string, message: string | null = null, notes?: string) => ({
    n,
    actor,
    action,
    message,
    ...(notes ? { notes } : {}),
  });
  const happy_path = [
    step(1, 'client', 'open WebSocket (token, if any, as query parameter "token")', null, `fail if not open within ${timing.ws_open_timeout_ms} ms or if closed before open`),
    step(2, 'client', 'start keepAlive timer (first tick 10 s after mount), paused while the page is hidden', null, 'timer is armed at mount, not after the control channel opens; ticks are skipped unless the socket is open'),
    step(3, 'client', 'send', 'client-request-rtc-configuration'),
    step(4, 'server', 'send', 'server-rtc-configuration', `fail if no reply within ${timing.rtc_config_timeout_ms} ms`),
    step(5, 'client', 'create peer connection with the received configuration; add recvonly audio and video transceivers; create negotiated data channels control (id 1) and hover (id 2)'),
    step(6, 'client', 'attach message handler (answer, candidate, screenshot, screenshotError, later rtcConfiguration)'),
    step(7, 'client', 'create offer, set local description, send', 'client-offer'),
    step(8, 'client', 'send each locally gathered ICE candidate immediately', 'client-candidate', 'may start before the answer arrives'),
    step(9, 'server', 'send', 'server-answer'),
    step(10, 'server', 'send zero or more (may arrive before the answer)', 'server-candidate', 'candidates arriving before the answer is applied are buffered, then added in arrival order right after setRemoteDescription'),
    step(11, 'client', 'set remote description from the answer, then flush buffered remote candidates'),
    step(12, 'client', 'control data channel opens: send requestFrame 12 times, at +0, +125, ... +1375 ms', 'client-request-frame'),
    step(13, 'client', 'if an URL to open was supplied, send right after step 12 scheduling', 'client-open-url'),
    step(14, 'client', 'peer connection state "connected": report connected'),
    step(15, 'client', 'keepAlive every 10000 ms', 'client-keep-alive'),
  ];
  const refresh = [
    step(1, 'server', 'send unsolicited credential refresh (any time after step 3 of the happy path)', 'server-rtc-configuration'),
    step(2, 'client', 'ignore if rtcConfiguration.iceServers is missing; otherwise setConfiguration({iceServers}); if that throws, stop here'),
    step(3, 'client', `suppress non-terminal connection-state dips for ${timing.ice_restart_grace_ms} ms (grace window)`, null, '"failed" and "closed" always pass through; a re-check at the end of the window reports a non-connected state'),
    step(4, 'client', 'create offer with iceRestart: true, set local description'),
    step(5, 'client', 'mark remote description as not set; drop buffered candidates; send', 'client-offer', 'candidates arriving from now on are buffered until the answer'),
    step(6, 'server', 'send', 'server-answer'),
    step(7, 'client', 'set remote description; flush buffered candidates'),
    step(8, 'client', 'on "connected" the grace window ends immediately'),
  ];
  const failure_triggers = [
    'WebSocket fails to open in time or closes before open',
    'rtcConfiguration reply missing after the timeout, or the handler throws',
    'offer creation / negotiation setup throws',
    'WebSocket closes while the peer connection state is not "connected"',
    'peer connection state becomes "failed" or "closed"',
  ];
  const ignored = [
    'Messages that are not valid JSON are dropped.',
    'Messages with an unknown type are dropped.',
    'answer or candidate while there is no peer connection is dropped.',
  ];
  return { timing, channels, peer_connection: peerConnection, happy_path, refresh, failure_triggers, ignored };
}
