"""Business logic behind the three voice tools.

Plain functions that take simple arguments and return JSON-able dicts. The
Pipecat layer (bot.py) only adapts these to function calls, so everything here
can be exercised without a microphone or an LLM.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from . import db

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]

# Words a caller might use instead of the speciality name.
SPECIALITY_HINTS = {
    "General Physician": ["general", "physician", "gp", "fever", "cold", "family", "checkup", "check-up"],
    "Cardiologist": ["cardio", "heart", "chest", "blood pressure", "bp"],
    "Dermatologist": ["derma", "skin", "rash", "acne", "hair"],
    "Orthopedic Surgeon": ["ortho", "bone", "joint", "knee", "back", "fracture", "spine"],
    "Pediatrician": ["pediatric", "paediatric", "child", "kid", "baby", "infant"],
    "ENT Specialist": ["ent", "ear", "nose", "throat", "sinus"],
}

MAX_SLOTS_PER_DOCTOR = 6


# ---------- formatting helpers ----------

def spoken_time(dt: datetime) -> str:
    h = dt.hour % 12 or 12
    suffix = "AM" if dt.hour < 12 else "PM"
    return f"{h}:{dt.minute:02d} {suffix}" if dt.minute else f"{h} {suffix}"


def spoken_day(dt: datetime) -> str:
    today = db.now().date()
    if dt.date() == today:
        return "today"
    if dt.date() == today + timedelta(days=1):
        return "tomorrow"
    return f"{WEEKDAYS[dt.weekday()]}, {dt.day} {MONTHS[dt.month - 1]}"


def spoken_when(starts_at: str) -> str:
    dt = datetime.fromisoformat(starts_at)
    return f"{spoken_day(dt)} at {spoken_time(dt)}"


def normalize_phone(raw: str) -> str | None:
    """Accept a 10-digit Indian mobile, with or without +91 / leading 0."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def read_back(phone: str) -> str:
    """'98765 43210' -> '9 8 7 6 5, 4 3 2 1 0' so TTS says it digit by digit."""
    return f"{' '.join(phone[:5])}, {' '.join(phone[5:])}"


def _normalize_date(value: str) -> str | None:
    value = (value or "").strip().lower()
    if not value:
        return None
    today = db.now().date()
    if value == "today":
        return today.isoformat()
    if value == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    try:
        return datetime.fromisoformat(value).date().isoformat()
    except ValueError:
        return None


def _normalize_time(value: str) -> str | None:
    """Accept '14:30', '2:30 PM', '2 pm', '1430'."""
    v = (value or "").strip().upper().replace(".", "")
    for fmt in ("%H:%M", "%I:%M %p", "%I:%M%p", "%I %p", "%I%p", "%H%M"):
        try:
            return datetime.strptime(v, fmt).strftime("%H:%M")
        except ValueError:
            continue
    return None


def _match_doctors(doctor: str, speciality: str) -> list[dict]:
    doctors = db.list_doctors()
    if doctor:
        words = [w for w in re.findall(r"[a-z']+", doctor.lower()) if w not in {"dr", "doctor", "doc"}]
        by_name = [d for d in doctors
                   if d["id"] == doctor.lower()
                   or any(len(w) > 2 and w in d["name"].lower() for w in words)]
        if by_name:
            return by_name
    if speciality:
        s = speciality.lower()
        # Word-prefix match so "heart" doesn't hit the "ear" hint and "cardiology" hits "cardio".
        return [d for d in doctors
                if s in d["speciality"].lower()
                or any(re.search(rf"\b{re.escape(h)}", s) for h in SPECIALITY_HINTS.get(d["speciality"], []))]
    return [] if doctor else doctors


def _doctor_summary(d: dict) -> dict:
    return {"doctor_id": d["id"], "name": d["name"], "speciality": d["speciality"]}


def _appt_summary(a: dict) -> dict:
    return {
        "appointment_id": a["id"],
        "doctor_id": a["doctor_id"],
        "doctor": a["doctor_name"],
        "speciality": a["speciality"],
        "when": spoken_when(a["starts_at"]),
        "date": a["starts_at"][:10],
        "time": a["starts_at"][11:],
        "patient_name": a["patient_name"],
    }


# ---------- tools ----------

def check_doctor_availability(doctor: str = "", speciality: str = "", date: str = "") -> dict:
    matches = _match_doctors(doctor, speciality)
    if not matches:
        return {
            "found": False,
            "message": "No doctor matched. Offer the caller the list below.",
            "doctors": [_doctor_summary(d) for d in db.list_doctors()],
        }

    on_date = _normalize_date(date)
    if date and not on_date:
        return {"found": False, "message": f"Could not understand the date '{date}'. Ask again."}

    results = []
    for d in matches:
        slots = db.open_slots([d["id"]], on_date)
        note = None
        if on_date and not slots:
            # Nothing that day: fall forward to the next day after it that has room.
            upcoming = db.open_slots([d["id"]])
            slots = [s for s in upcoming if s["starts_at"][:10] > on_date] or upcoming
            note = f"No openings on {spoken_day(datetime.fromisoformat(on_date))}."
        if slots:
            first_day = slots[0]["starts_at"][:10]
            day_slots = [s for s in slots if s["starts_at"].startswith(first_day)]
            other_days = sorted({s["starts_at"][:10] for s in slots} - {first_day})[:4]
        else:
            day_slots, other_days = [], []
        results.append({
            **_doctor_summary(d),
            "note": note,
            "date": day_slots[0]["starts_at"][:10] if day_slots else None,
            "day": spoken_day(datetime.fromisoformat(day_slots[0]["starts_at"])) if day_slots else None,
            "times": [s["starts_at"][11:] for s in day_slots[:MAX_SLOTS_PER_DOCTOR]],
            "more_times_that_day": max(0, len(day_slots) - MAX_SLOTS_PER_DOCTOR),
            "other_days_with_openings": other_days,
        })
    return {"found": True, "doctors": results}


def book_appointment(phone_number: str, doctor_id: str, date: str, time: str,
                     patient_name: str = "", number_confirmed: bool = False) -> dict:
    phone = normalize_phone(phone_number)
    if not phone:
        return {"ok": False, "error": "invalid_phone",
                "message": "That is not a valid 10-digit mobile number. Ask the caller to say it again."}
    if not number_confirmed:
        return {"ok": False, "error": "number_not_confirmed",
                "message": f"Read the number back as '{read_back(phone)}' and wait for the caller to confirm."}

    doctors = _match_doctors(doctor_id, "")
    if len(doctors) != 1:
        return {"ok": False, "error": "unknown_doctor",
                "doctors": [_doctor_summary(d) for d in db.list_doctors()]}
    doc = doctors[0]

    day, hhmm = _normalize_date(date), _normalize_time(time)
    if not day or not hhmm:
        return {"ok": False, "error": "bad_date_or_time",
                "message": "Use date as YYYY-MM-DD and time as HH:MM (24h)."}

    try:
        appt = db.book(doc["id"], f"{day}T{hhmm}", (patient_name or "Caller").strip().title(), phone)
    except db.SlotTaken:
        alternatives = [s["starts_at"][11:] for s in db.open_slots([doc["id"]], day)][:MAX_SLOTS_PER_DOCTOR]
        return {"ok": False, "error": "slot_unavailable",
                "message": f"{doc['name']} is not free at that time.",
                "open_times_that_day": alternatives}

    return {"ok": True, "appointment": {**_appt_summary(appt), "room": appt["room"]},
            "phone_read_back": read_back(phone)}


def cancel_appointment(phone_number: str, number_confirmed: bool = False,
                       appointment_id: str = "", date: str = "") -> dict:
    phone = normalize_phone(phone_number)
    if not phone:
        return {"ok": False, "error": "invalid_phone",
                "message": "That is not a valid 10-digit mobile number. Ask the caller to say it again."}
    if not number_confirmed:
        return {"ok": False, "error": "number_not_confirmed",
                "message": f"Read the number back as '{read_back(phone)}' and wait for the caller to confirm."}

    upcoming = db.upcoming_for_phone(phone)
    if not upcoming:
        return {"ok": False, "error": "not_found",
                "message": f"No upcoming appointment is booked under {read_back(phone)}."}

    candidates = upcoming
    if appointment_id:
        candidates = [a for a in candidates if a["id"] == appointment_id.strip().upper()] or candidates
    if date and (day := _normalize_date(date)):
        candidates = [a for a in candidates if a["starts_at"].startswith(day)] or candidates

    if len(candidates) > 1:
        return {"ok": False, "error": "multiple_appointments",
                "message": "Ask which one to cancel, then call again with its appointment_id.",
                "appointments": [_appt_summary(a) for a in candidates]}

    cancelled = db.cancel(candidates[0]["id"])
    return {"ok": True, "cancelled": _appt_summary(cancelled)}
