"""HTTP + signalling server.

- REST endpoints the dashboard reads (doctors, slots, appointments).
- /api/offer: WebRTC signalling for Pipecat's SmallWebRTC transport (default, best audio).
- /ws: WebSocket transport, for hosts that can't do WebRTC/UDP.
Each call gets its own Pipecat pipeline, started in the background.
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

from . import db
from .bot import run_bot
from .config import settings

_sessions: set[asyncio.Task] = set()
webrtc = SmallWebRTCRequestHandler(ice_servers=[IceServer(**s) for s in settings.ice_servers])


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    if missing := settings.missing():
        logger.error(f"Voice calls disabled until these are set: {', '.join(missing)}")
    yield
    await webrtc.close()


app = FastAPI(title="Linden Health voice desk", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)


def _track(task: asyncio.Task) -> None:
    _sessions.add(task)
    task.add_done_callback(_sessions.discard)


def _can_take_call() -> str | None:
    """Return a reason the call can't start, or None."""
    if settings.missing():
        return "The voice agent isn't configured on the server."
    if len(_sessions) >= settings.max_sessions:
        return "All lines are busy. Try again in a minute."
    return None


# ---------- dashboard data ----------

@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "voice_ready": not settings.missing(),
        "active_calls": len(_sessions),
        "max_calls": settings.max_sessions,
        "models": {
            "stt": "ElevenLabs Scribe v2 Realtime",
            "llm": settings.gemini_model,
            "tts": f"ElevenLabs {settings.elevenlabs_tts_model}",
        },
    }


@app.get("/api/doctors")
async def doctors():
    db.refresh()
    slots = db.all_slots()
    return {
        "now": db.now().isoformat(timespec="minutes"),
        "doctors": [
            {
                **d,
                "slots": [
                    {"starts_at": s["starts_at"], "minutes": s["minutes"], "booked": bool(s["is_booked"])}
                    for s in slots
                    if s["doctor_id"] == d["id"]
                ],
            }
            for d in db.list_doctors()
        ],
    }


@app.get("/api/appointments")
async def appointments():
    rows = db.list_appointments()
    for r in rows:
        # The dashboard is shared, so never send full phone numbers to the browser.
        r["phone_masked"] = f"{r['phone'][:2]}••••••{r['phone'][-2:]}"
        del r["phone"]
    return {"appointments": rows}


# ---------- WebRTC signalling ----------

@app.post("/api/offer")
async def offer(request: dict):
    req = SmallWebRTCRequest.from_dict(request)
    if not req.pc_id and (reason := _can_take_call()):
        raise HTTPException(status_code=503 if settings.missing() else 429, detail=reason)

    async def on_connection(connection: SmallWebRTCConnection):
        transport = SmallWebRTCTransport(
            webrtc_connection=connection,
            params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
        )
        _track(asyncio.create_task(run_bot(transport, connection.pc_id)))

    return await webrtc.handle_web_request(request=req, webrtc_connection_callback=on_connection)


@app.patch("/api/offer")
async def ice_candidate(request: SmallWebRTCPatchRequest):
    await webrtc.handle_patch_request(request)
    return {"status": "success"}


# ---------- WebSocket transport ----------

@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    if reason := _can_take_call():
        await websocket.close(code=1013, reason=reason[:120])
        return
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=ProtobufFrameSerializer(),
        ),
    )
    session_id = f"ws-{uuid.uuid4().hex[:8]}"
    task = asyncio.create_task(run_bot(transport, session_id))
    _track(task)
    try:
        await task  # keep the socket open for the life of the call
    except Exception:
        logger.exception(f"[{session_id}] session crashed")
