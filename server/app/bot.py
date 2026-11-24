"""The voice pipeline: caller audio -> ElevenLabs STT -> Gemini -> ElevenLabs TTS -> caller audio."""

from __future__ import annotations

import asyncio
import random
from datetime import timedelta

from google.genai.types import HttpOptions, HttpRetryOptions
from loguru import logger
from pipecat.adapters.llm.schemas.direct_function import tool_options
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame, LLMRunFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi.observer import RTVIFunctionCallReportLevel, RTVIObserverParams
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.base_transport import BaseTransport
from pipecat.workers.runner import WorkerRunner

from . import db, tools
from .config import settings

CLINIC = "Linden Health"
AGENT = "Mira"


def _calendar() -> str:
    """Spell out the next two weeks so the model never has to do date maths."""
    today = db.now().date()
    lines = []
    for i in range(14):
        d = today + timedelta(days=i)
        tag = " (today)" if i == 0 else " (tomorrow)" if i == 1 else ""
        closed = " - closed" if d.weekday() == 6 else ""
        lines.append(f"- {tools.WEEKDAYS[d.weekday()]} {d.isoformat()}{tag}{closed}")
    return "\n".join(lines)


def system_prompt() -> str:
    now = db.now()
    doctors = "\n".join(
        f"- {d['name']} ({d['speciality']}), id {d['id']}" for d in db.list_doctors()
    )
    return f"""You are {AGENT}, the front-desk voice assistant at {CLINIC}, a multi-speciality clinic.
You are on a live phone call. Everything you say is spoken aloud.

Style:
- Warm, calm, efficient. One or two short sentences per turn. Plain spoken English.
- No lists, markdown, emojis or symbols. Say times like "10:30 AM", dates like "Thursday the 27th".
- Offer at most three time options at once.
- Never invent doctors, slots or appointments. Only use what the tools return.

Identity:
- The caller is identified ONLY by the mobile number they say. There is no login.
- Before booking or cancelling, read the number back digit by digit and ask them to confirm.
  Only set number_confirmed=true after they clearly say yes. If they correct it, read back again.

What you can do:
1. Check availability with check_doctor_availability (by doctor, speciality and/or date).
2. Book with book_appointment. You need: the caller's name, their confirmed mobile number,
   the doctor_id, the date (YYYY-MM-DD) and the time (HH:MM, 24-hour) from the availability result.
   Before booking, briefly repeat the doctor, day and time.
3. Cancel with cancel_appointment, found by the caller's confirmed mobile number.
   If several appointments come back, ask which one and call again with its appointment_id.

After a booking, confirm the doctor, day, time and room in one sentence. Do not read out the
appointment id unless asked. Then ask if there is anything else. Keep the conversation moving.
If someone asks about something unrelated to appointments, say politely that you can only help with appointments.
For emergencies tell them to call 112 immediately.

Clinic hours: Monday to Saturday. Closed on Sundays.
Current date and time: {tools.WEEKDAYS[now.weekday()]} {now.strftime('%Y-%m-%d %H:%M')} (clinic local time).
Calendar:
{_calendar()}

Doctors:
{doctors}
"""


FILLERS = ["One moment.", "Let me check.", "Sure, one second."]


async def run_bot(transport: BaseTransport, session_id: str) -> None:
    logger.info(f"[{session_id}] starting voice session")
    db.refresh()

    stt = ElevenLabsRealtimeSTTService(api_key=settings.elevenlabs_api_key)

    tts = ElevenLabsTTSService(
        api_key=settings.elevenlabs_api_key,
        settings=ElevenLabsTTSService.Settings(
            voice=settings.elevenlabs_voice_id,
            model=settings.elevenlabs_tts_model,
        ),
    )

    llm = GoogleLLMService(
        api_key=settings.google_api_key,
        # Gemini's free tier returns 429/503 under load; retry quickly before giving up.
        http_options=HttpOptions(
            retry_options=HttpRetryOptions(
                attempts=4, initial_delay=0.4, max_delay=2.0, http_status_codes=[429, 500, 502, 503, 504]
            ),
        ),
        settings=GoogleLLMService.Settings(
            model=settings.gemini_model,
            system_instruction=system_prompt(),
            temperature=0.4,
        ),
    )

    worker: PipelineWorker | None = None

    async def notify(kind: str, payload: dict) -> None:
        """Tell the browser something changed so the dashboard can refresh and highlight it."""
        if worker is not None:
            await worker.rtvi.send_server_message({"type": kind, **payload})

    # ---- tools registered with the LLM (schema is generated from signature + docstring) ----

    async def check_doctor_availability(
        params: FunctionCallParams, doctor: str = "", speciality: str = "", date: str = ""
    ):
        """Look up open appointment slots. Call with no arguments to list every doctor's next openings.

        Args:
            doctor: Doctor's name or id, e.g. "Dr. Mehta" or "dr-mehta". Optional.
            speciality: Speciality or symptom area, e.g. "cardiologist", "skin", "child". Optional.
            date: Day to check as YYYY-MM-DD. Optional; leave empty for the next available day.
        """
        result = tools.check_doctor_availability(doctor, speciality, date)
        if result["found"]:
            # Lets the dashboard spotlight the doctors the agent is looking at.
            await notify("availability_checked", {
                "doctor_ids": [d["doctor_id"] for d in result["doctors"]],
                "date": next((d["date"] for d in result["doctors"] if d["date"]), None),
            })
        await params.result_callback(result)

    @tool_options(cancel_on_interruption=False)
    async def book_appointment(
        params: FunctionCallParams,
        phone_number: str,
        doctor_id: str,
        date: str,
        time: str,
        patient_name: str = "",
        number_confirmed: bool = False,
    ):
        """Book an open slot for the caller.

        Args:
            phone_number: The caller's 10-digit mobile number exactly as they said it, digits only.
            doctor_id: Doctor id from the availability result, e.g. "dr-mehta".
            date: Appointment date as YYYY-MM-DD.
            time: Appointment start time as HH:MM in 24-hour format, e.g. "14:30".
            patient_name: The caller's name.
            number_confirmed: True only after you read the number back and the caller said yes.
        """
        result = tools.book_appointment(phone_number, doctor_id, date, time, patient_name, number_confirmed)
        if result["ok"]:
            await notify("appointment_booked", {"appointment": result["appointment"]})
        await params.result_callback(result)

    @tool_options(cancel_on_interruption=False)
    async def cancel_appointment(
        params: FunctionCallParams,
        phone_number: str,
        number_confirmed: bool = False,
        appointment_id: str = "",
        date: str = "",
    ):
        """Cancel the caller's upcoming appointment, found by their mobile number.

        Args:
            phone_number: The caller's 10-digit mobile number, digits only.
            number_confirmed: True only after you read the number back and the caller said yes.
            appointment_id: Which appointment to cancel, if the caller has more than one. Optional.
            date: Date of the appointment to cancel as YYYY-MM-DD, if the caller mentioned it. Optional.
        """
        result = tools.cancel_appointment(phone_number, number_confirmed, appointment_id, date)
        if result["ok"]:
            await notify("appointment_cancelled", {"appointment": result["cancelled"]})
        await params.result_callback(result)

    context = LLMContext(tools=[check_doctor_availability, book_appointment, cancel_appointment])
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    @llm.event_handler("on_function_calls_started")
    async def on_function_calls_started(service, function_calls):
        # Fill the silence while the tool and the follow-up LLM turn run.
        await tts.queue_frame(TTSSpeakFrame(random.choice(FILLERS)))

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=180,
        # Let the browser see which tool is running (name only, never arguments or results).
        rtvi_observer_params=RTVIObserverParams(
            function_call_report_level={"*": RTVIFunctionCallReportLevel.NAME},
        ),
        # If STT/TTS/LLM can't recover (bad key, quota), hang up instead of leaving dead air.
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)

    @worker.event_handler("on_pipeline_error")
    async def on_pipeline_error(worker, frame):
        # The LLM failed even after retries. Say something instead of going silent;
        # the caller's next sentence starts a fresh attempt.
        if frame.processor is llm and not frame.fatal:
            logger.warning(f"[{session_id}] LLM error, asking caller to repeat: {frame.error}")
            await worker.queue_frames([TTSSpeakFrame("Sorry, the line dropped for a second. Could you say that again?")])

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"[{session_id}] caller connected")
        context.add_message({
            "role": "developer",
            "content": f"The call just connected. Greet the caller as {AGENT} from {CLINIC} in one short sentence and ask how you can help.",
        })
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info(f"[{session_id}] caller hung up")
        await runner.cancel()

    async def call_time_limit():
        # Hard cap per call so one open tab can't burn through the API quota.
        await asyncio.sleep(settings.max_call_secs)
        logger.info(f"[{session_id}] call time limit reached")
        await worker.queue_frames([
            TTSSpeakFrame("We've reached the time limit for this call. Please call again if you need anything else. Goodbye."),
            EndFrame(),
        ])

    limiter = asyncio.create_task(call_time_limit())
    try:
        await runner.run()
    finally:
        limiter.cancel()
    logger.info(f"[{session_id}] session ended")
