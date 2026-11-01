"""GPT-Live REST adapter, independent of the mission agent and SDK version."""

import os
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, StrictStr

from .personality import BACKEND_INSTRUCTIONS, conversation_instructions

LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions"


class VoiceSettings(BaseModel):
    model: str = Field(default="gpt-live-1", min_length=1)
    voice: str = Field(default="meridian", min_length=1)
    backend_model: str = Field(default="gpt-6-luna", min_length=1)
    humor: int = Field(default=70, ge=0, le=100)

    @classmethod
    def from_env(cls) -> "VoiceSettings":
        return cls(
            model=os.getenv("OPENAI_VOICE_MODEL", "gpt-live-1").strip(),
            voice=os.getenv("OPENAI_VOICE", "meridian").strip(),
            backend_model=os.getenv("OPENAI_VOICE_BACKEND_MODEL", "gpt-6-luna").strip(),
            humor=os.getenv("VOICE_HUMOR", "70"),
        )

    def session_config(self) -> dict:
        return {
            "model": self.model,
            "instructions": conversation_instructions(self.humor),
            "audio": {"output": {"voice": self.voice}},
            "store": False,
            "input": [{
                "type": "message",
                "role": "developer",
                "content": [{
                    "type": "input_text",
                    "text": "Open with a brief greeting as Aether, identify yourself as an AI, then listen.",
                }],
            }],
            "delegation": {
                "type": "responses",
                "responses": {
                    "model": self.backend_model,
                    "instructions": BACKEND_INSTRUCTIONS,
                    "tools": [],
                    "tool_choice": "none",
                    "max_output_tokens": 1000,
                },
            },
            "client": {"data_channel": {
                "allowed_client_events": [
                    "session.close", "session.input_audio.mute", "session.input_audio.unmute",
                ],
                "allowed_server_events": "all",
            }},
        }


class SessionIdentifier(BaseModel):
    id: StrictStr = Field(min_length=1)


class WebRTCAnswer(BaseModel):
    type: Literal["webrtc"]
    sdp: StrictStr = Field(min_length=1)


class VoiceSession(BaseModel):
    # Only return connection metadata, even if upstream adds sensitive fields.
    model_config = ConfigDict(extra="ignore")
    session: SessionIdentifier
    transport: WebRTCAnswer


class VoiceUnavailable(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def create_session(sdp: str, settings: VoiceSettings) -> VoiceSession:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise VoiceUnavailable(503, "Set OPENAI_API_KEY on the server to enable GPT-Live voice.")
    try:
        # Do not retry: a lost response could otherwise create a second billed session.
        async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10)) as client:
            response = await client.post(
                LIVE_SESSIONS_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "session": settings.session_config(),
                    "transport": {"type": "webrtc", "sdp": sdp},
                },
            )
            response.raise_for_status()
            return VoiceSession.model_validate(response.json())
    except httpx.TimeoutException:
        raise VoiceUnavailable(504, "GPT-Live session setup timed out. Try connecting again.") from None
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 429:
            raise VoiceUnavailable(429, "GPT-Live quota or rate limit reached. Check your project limits.") from None
        if status in (401, 403):
            raise VoiceUnavailable(502, "GPT-Live authentication or model access failed. Check the server credentials.") from None
        raise VoiceUnavailable(502, "GPT-Live rejected session setup. Check model, voice, and account access.") from None
    except (httpx.RequestError, ValueError):
        # Never return upstream bodies, headers, keys, or raw network errors.
        raise VoiceUnavailable(502, "GPT-Live returned an invalid response or could not be reached.") from None
