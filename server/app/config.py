"""Environment config, read once and validated at startup.

Missing keys fail the server boot with a clear message instead of failing
mid-call with an auth error from a provider.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv(override=False)  # real env vars (e.g. on a host) win over .env


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    elevenlabs_api_key: str = field(default_factory=lambda: os.getenv("ELEVENLABS_API_KEY", "").strip())
    google_api_key: str = field(default_factory=lambda: os.getenv("GOOGLE_API_KEY", "").strip())

    elevenlabs_voice_id: str = field(default_factory=lambda: os.getenv("ELEVENLABS_VOICE_ID", "").strip() or "EXAVITQu4vr4xnSDxMaL")
    elevenlabs_tts_model: str = field(default_factory=lambda: os.getenv("ELEVENLABS_TTS_MODEL", "").strip() or "eleven_flash_v2_5")
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "").strip() or "gemini-3.5-flash-lite")

    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    )
    max_sessions: int = field(default_factory=lambda: _int("MAX_SESSIONS", 3))
    max_call_secs: int = field(default_factory=lambda: _int("MAX_CALL_SECS", 600))
    # "smart": Pipecat's Smart Turn model decides when the caller finished (best, ~+150 MB RAM).
    # "vad": Silero VAD + a short silence timeout. Use on small hosts (512 MB / shared CPU).
    turn_detection: str = field(default_factory=lambda: (os.getenv("TURN_DETECTION", "").strip().lower() or "smart"))
    ice_servers: list[dict] = field(
        default_factory=lambda: json.loads(os.getenv("ICE_SERVERS") or '[{"urls": "stun:stun.l.google.com:19302"}]')
    )

    def missing(self) -> list[str]:
        return [name for name, value in (
            ("ELEVENLABS_API_KEY", self.elevenlabs_api_key),
            ("GOOGLE_API_KEY", self.google_api_key),
        ) if not value]


settings = Settings()
