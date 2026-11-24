# Linden Health · Voice front desk

A voice agent that books and cancels doctor appointments over a live call, plus a dashboard that shows the schedule change as the agent works.

- **Voice pipeline:** Pipecat 1.17 (Python)
- **STT:** ElevenLabs Scribe v2 Realtime
- **TTS:** ElevenLabs Flash v2.5
- **LLM:** Google Gemini, `gemini-3.5-flash-lite` by default (free tier). Set `GEMINI_MODEL` to change it.
- **VAD:** Silero
- **Frontend:** React + Vite, Pipecat client SDK over WebRTC
- **Data:** SQLite with mock doctors and a rolling 7-day slot window

```
browser mic ──WebRTC──▶ Silero VAD ─▶ ElevenLabs STT ─▶ Gemini ─▶ ElevenLabs TTS ──WebRTC──▶ speaker
                                                          │  ▲
                                          function calls  ▼  │ results
                                      check_doctor_availability · book_appointment · cancel_appointment
                                                          │
                                                       SQLite ──REST──▶ dashboard
                                   (RTVI server messages tell the dashboard what just changed)
```

## Run locally

You need Python 3.12, Node 20+, an [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys) and a [Google AI Studio key](https://aistudio.google.com/apikey).

**1. Server** (port 7860)

```bash
cd server
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in ELEVENLABS_API_KEY and GOOGLE_API_KEY
uvicorn app.main:app --port 7860
```

**2. Dashboard** (port 5173)

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173, click **Try call** and allow the microphone. Headphones give the cleanest demo.

## Things to say

- "Is there a skin doctor free tomorrow afternoon?"
- "Book the 2:30 with Dr. Iyer. I'm Mehul, my number is 98765 43210."
- "Actually, cancel my appointment."

The agent reads the number back digit by digit and only books or cancels after you say yes.

## How it works

| Piece | File |
| --- | --- |
| Pipeline, prompt, tool registration | `server/app/bot.py` |
| Tool logic (pure Python, no LLM needed to test) | `server/app/tools.py` |
| SQLite schema, seeding, atomic booking | `server/app/db.py` |
| REST + WebRTC signalling + WebSocket endpoint | `server/app/main.py` |
| Env config, validated at startup | `server/app/config.py` |
| Tests | `server/tests/` |
| Call lifecycle, transcript, events | `web/src/lib/useCall.ts` |
| Phone UI, schedule grid, appointment list | `web/src/components/` |

Details worth knowing:

- **Identity is the spoken phone number only.** `book_appointment` and `cancel_appointment` take a `number_confirmed` flag. If the model calls them before confirming, the tool refuses and returns the read-back string. The prompt already asks for confirmation, and this check enforces it in code too.
- **No double booking.** A booking claims its slot inside a `BEGIN IMMEDIATE` transaction. If the slot is gone, the tool returns the open times for that day.
- **Dates.** The prompt includes a 14-day calendar so the model never has to work out what "next Friday" is.
- **Live dashboard.** After a tool runs, the bot sends an RTVI server message (`availability_checked`, `appointment_booked`, `appointment_cancelled`). The dashboard refetches, jumps to that day, spotlights the doctor and highlights the slot and row.
- **Transcript.** It uses Pipecat's `bot-output` word progress, so agent text fills in as it is spoken. If you interrupt, the unspoken rest is struck through.
- Bookings and cancellations run with `cancel_on_interruption=False`, so talking over the agent can't abort a half-done write.
- The dashboard API masks phone numbers.

## Deploying

The dashboard is a static Vite build, so it runs on Vercel. The voice server is a long-running Python process with WebRTC, so Vercel can't host it. Run it somewhere else and point the dashboard at it.

**Frontend on Vercel:** import the repo, set **Root Directory** to `web`, and add these environment variables:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | public HTTPS URL of the server |
| `VITE_TRANSPORT` | `webrtc`, or `websocket` if your host blocks UDP |

**Server:** `server/Dockerfile` runs on any container host (Hugging Face Spaces with Docker, Render, Railway, Fly). Set the same variables as in `.env`, plus `CORS_ORIGINS=https://<your-app>.vercel.app`. Most container hosts don't allow inbound UDP. On those, either set `VITE_TRANSPORT=websocket` or add a TURN server through `ICE_SERVERS`.

## Development

```bash
cd server
pip install -r requirements-dev.txt
ruff check .        # lint
pytest              # 33 tests: tools, booking rules, API (no API keys needed)

cd ../web
npm run typecheck
npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, tests and the frontend build on every push and pull request.

## Safety and limits

- If either API key is missing, the server still starts and serves the dashboard. Calls are then refused with HTTP 503, `/api/health` reports `voice_ready: false`, and the dashboard shows "Agent not configured".
- `MAX_SESSIONS` caps how many calls can run at once (HTTP 429 when full). `MAX_CALL_SECS` ends a call politely after 10 minutes by default, so a forgotten tab can't use up the quota.
- A pipeline ends the call if STT, TTS or the LLM fails three times in a row (for example a bad key), instead of leaving the caller in silence. The error is shown on the phone screen.

## Config

See `server/.env.example` and `web/.env.example`. No keys are committed.
