"""Router ready to mount when voice is integrated into the main application."""

import os
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr, ValidationError, field_validator

from .service import VoiceSession, VoiceSettings, VoiceUnavailable, create_session

router = APIRouter(prefix="/api/voice", tags=["GPT-Live voice"])


class SessionOffer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sdp: StrictStr = Field(min_length=1, max_length=65536)

    @field_validator("sdp")
    @classmethod
    def audio_offer(cls, value: str) -> str:
        if not value.startswith(("v=0\r\n", "v=0\n")) or not re.search(r"^m=audio ", value, re.MULTILINE):
            raise ValueError("Provide a WebRTC SDP offer with an audio track.")
        return value


def settings() -> VoiceSettings:
    try:
        return VoiceSettings.from_env()
    except ValidationError:
        raise HTTPException(503, "Invalid voice configuration. Check OPENAI_VOICE_* and VOICE_HUMOR.") from None


@router.get("/status")
def status(config: VoiceSettings = Depends(settings)):
    return {
        "key_configured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "model": config.model,
        "voice": config.voice,
        "backend_model": config.backend_model,
        "humor": config.humor,
        "transport": "webrtc",
    }


@router.post("/sessions", response_model=VoiceSession, status_code=201)
async def start_session(offer: SessionOffer, request: Request, response: Response,
                        config: VoiceSettings = Depends(settings)):
    # The standalone service accepts same-origin browsers and non-browser clients.
    # This is not authentication; mount behind application auth when integrating.
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
        raise HTTPException(403, "Unexpected voice request origin.")
    response.headers["Cache-Control"] = "no-store"
    try:
        return await create_session(offer.sdp, config)
    except VoiceUnavailable as exc:
        raise HTTPException(exc.status_code, exc.detail) from None
