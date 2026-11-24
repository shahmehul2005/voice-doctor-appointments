# Pipeline description

The browser talks to a Python server over WebRTC (Pipecat's SmallWebRTC transport). For each call the server builds one Pipecat pipeline: mic audio → Silero VAD → ElevenLabs Scribe realtime STT → Gemini (Flash-Lite) → ElevenLabs Flash TTS → back to the browser. Silero detects when I stop talking, and only then does the transcript go to the LLM.

Gemini has three tools registered in the pipeline: `check_doctor_availability`, `book_appointment` and `cancel_appointment`. They are plain Python functions over a SQLite file with six mock doctors and a rolling week of slots. The caller is identified only by the number they say. The booking and cancel tools refuse to run until the model has read the number back and the caller has confirmed it, so this rule is enforced in code as well as in the prompt. Booking claims the slot inside a transaction, so two calls can't take the same slot.

After every tool call the bot sends a small RTVI message to the browser. The dashboard uses it to refetch, spotlight the doctor and highlight the new or freed slot. The live transcript comes from Pipecat's own events.

What I'd improve next: phone numbers are assumed to be 10-digit Indian mobiles. WebRTC on a cloud host needs a TURN server, so the hosted version can fall back to WebSocket. The free Gemini tier has a daily request limit.
