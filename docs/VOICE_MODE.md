# Standalone GPT-Live voice module

`backend/voice` prepares live, two-way voice conversations with `gpt-live-1`.
Aether speaks with a calm, concise, dryly humorous TARS-inspired personality.
The module is independent of mission control: no frontend, planner, telemetry,
or harness integration is installed. Audio capture and playback require a client.

## Run the backend

Use the project's existing Python environment and dependencies. Set
`OPENAI_API_KEY` in the root `.env` to an OpenAI project key with GPT-Live access.
Optional settings (defaults shown):

```dotenv
OPENAI_VOICE_MODEL=gpt-live-1
OPENAI_VOICE=meridian
OPENAI_VOICE_BACKEND_MODEL=gpt-6-luna
VOICE_HUMOR=70
```

`VOICE_HUMOR` accepts 0–100. Honesty remains at 100%; humor changes delivery,
never accuracy. `meridian` is a built-in voice; this does not clone the film actor.
The voice and model are chosen at session creation. Restart the standalone server
after changing `.env`. Voice uses OpenAI regardless of `AGENT_PROVIDER`.

From `aether-ai`:

```sh
python -m uvicorn backend.voice.app:app --host 127.0.0.1 --port 8001
```

Inspect **http://127.0.0.1:8001/docs** for the HTTP contract. The server serves
API endpoints only. No SDK upgrade or extra dependency is required: session
setup uses the GPT-Live REST API through the existing `httpx` dependency.

## HTTP contract

`GET /api/voice/status` returns `key_configured`, `model`, `voice`,
`backend_model`, `humor`, and `transport`. This checks local configuration;
it does not verify account access or quota.

`POST /api/voice/sessions` accepts only an audio SDP offer:

```json
{"sdp": "<complete WebRTC SDP offer>"}
```

Success is HTTP 201:

```json
{
  "session": {"id": "live_123"},
  "transport": {"type": "webrtc", "sdp": "<SDP answer>"}
}
```

Preserve the opaque session ID exactly. Responses include `Cache-Control:
no-store`; the standard API key is used exclusively on the server.

Failures return `{"detail": "..."}`: 422 for invalid input, 403 for an
unexpected browser origin, 503 for missing keys or invalid settings, 429 for
upstream quota/rate limits, 504 for setup timeouts, and 502 for other provider
or malformed-response failures. Raw provider errors are not returned. There is
no offline voice fallback. Setup is not retried automatically because retrying
a lost response could create another billed session.

## Client connection contract for later integration

1. From a user gesture, request microphone access on HTTPS or localhost.
2. Create an `RTCPeerConnection`, attach its microphone audio track, and play
   the incoming remote audio track through an audio element. Handle autoplay
   restrictions with a user playback control.
3. Create the `oai-events` data channel and register message handlers **before**
   creating the offer. Create/set the local offer, wait for ICE gathering with
   a bounded timeout, and POST the complete `localDescription.sdp` to the backend.
4. Apply `transport.sdp` as the peer's remote description with type `answer`.
   Wait for `session.started` on the data channel before enabling conversation
   controls. HTTP setup already starts the session; do not send `session.start`.
5. WebRTC media tracks carry microphone input and spoken replies, including
   overlapping speech and interruptions. Do not stream base64 audio over the
   data channel or implement a separate transcription/TTS pipeline.
6. Read `session.input_transcript.delta` and `session.output_transcript.delta`
   for captions. Preserve each fragment's text, `start_ms`, and `end_ms`;
   maintain user and assistant captions independently during overlapping speech.
7. To mute/unmute, send `session.input_audio.mute` or
   `session.input_audio.unmute`. These keep the billed session running.
8. To stop, send `session.close`. Keep media and the data channel alive until
   `session.closed` arrives, then stop microphone tracks and close the peer.
   Use a bounded finalization timeout; if it expires, release resources and mark
   final usage unconfirmed. Also clean up after setup errors or transport loss.

Handle `error` events throughout the call. Track cumulative voice usage from
`session.usage.updated` and final `session.closed`. Hosted reasoning events
arrive inside `response.event`; they are distinct from spoken captions.

The server permits only close and microphone mute/unmute commands from the
frontend data channel. Configuration, prompt changes, and tool commands remain
server-owned. The module requests `store: false` and does not save transcripts
or recordings locally. This flag does not change your project's other API data
retention settings.

## Integration boundaries

The voice model delegates reasoning to a hosted Responses model with no tools,
so conversation works without an application event worker. It can explain
general concepts but cannot retrieve project state or verify flight plans.
The independent prompts in `personality.py` enforce that distinction.

When ready to mount in the main backend, insert this **before** the frontend
catch-all route in `backend/main.py`:

```python
from .voice.api import router as voice_router
app.include_router(voice_router)
```

The existing main backend already loads `.env`. The standalone entrypoint loads
it separately and imports no mission code. Direct Python callers can use
`await backend.voice.service.create_session(sdp, VoiceSettings.from_env())`.

The standalone API is intended for localhost development. When exposing it to
users, apply application authentication and session-creation limits. Same-origin
checks are not authentication. For development, proxy `/api/voice` through the
client origin; cross-origin browser requests are currently rejected. Add mission
tools or change to client delegation explicitly during the later integration.

## Validation and references

Run `python -m pytest tests/test_voice.py`. Tests use a mocked HTTP transport:
they verify payloads, response filtering, configuration, validation, and errors
without opening billed sessions. Real speech quality, microphone playback, and
account access still require a live client test.

The implementation follows official OpenAI documentation checked on
1 November 2026: [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live),
[session creation schema](https://developers.openai.com/api/reference/resources/live/methods/create),
[session lifecycle and captions](https://developers.openai.com/api/docs/guides/live-conversations),
and [Responses delegation](https://developers.openai.com/api/docs/guides/live-delegation).
Voice duration and delegated Responses usage are billed separately; end unused
sessions instead of leaving them muted.
