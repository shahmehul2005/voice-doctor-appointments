from datetime import timedelta

import pytest

from app import db, tools

PHONE = "9876543210"


def first_open(speciality="heart"):
    doc = tools.check_doctor_availability(speciality=speciality)["doctors"][0]
    return doc["doctor_id"], doc["date"], doc["times"][0]


# ---------- phone handling ----------

@pytest.mark.parametrize("raw", ["9876543210", "98765 43210", "+91 98765-43210", "09876543210", "919876543210"])
def test_normalize_phone_accepts_common_formats(raw):
    assert tools.normalize_phone(raw) == PHONE


@pytest.mark.parametrize("raw", ["", "12345", "98765432101234", "phone"])
def test_normalize_phone_rejects_bad_input(raw):
    assert tools.normalize_phone(raw) is None


def test_read_back_is_digit_by_digit():
    assert tools.read_back(PHONE) == "9 8 7 6 5, 4 3 2 1 0"


# ---------- availability ----------

@pytest.mark.parametrize(
    "query, expected",
    [
        ("heart", "Dr. Vikram Rao"),        # must not match the ENT "ear" hint
        ("cardiology", "Dr. Vikram Rao"),
        ("skin doctor", "Dr. Priya Iyer"),
        ("my kid", "Dr. Neha Sharma"),
        ("knee pain", "Dr. Sameer Khan"),
        ("ear infection", "Dr. Karen D'Souza"),
    ],
)
def test_speciality_matching(query, expected):
    result = tools.check_doctor_availability(speciality=query)
    assert [d["name"] for d in result["doctors"]] == [expected]


def test_doctor_lookup_by_name_or_id():
    assert tools.check_doctor_availability(doctor="Mehta")["doctors"][0]["doctor_id"] == "dr-mehta"
    assert tools.check_doctor_availability(doctor="dr-khan")["doctors"][0]["doctor_id"] == "dr-khan"


def test_unknown_doctor_returns_directory():
    result = tools.check_doctor_availability(doctor="Dr. Nobody")
    assert result["found"] is False
    assert len(result["doctors"]) == len(db.DOCTORS)


def test_no_arguments_lists_everyone():
    assert len(tools.check_doctor_availability()["doctors"]) == len(db.DOCTORS)


def test_closed_day_falls_forward_to_next_open_day():
    today = db.now().date()
    sunday = today + timedelta(days=(6 - today.weekday()) % 7 or 7)
    doc = tools.check_doctor_availability(doctor="dr-khan", date=sunday.isoformat())["doctors"][0]
    assert doc["note"].startswith("No openings")
    assert doc["date"] > sunday.isoformat()


def test_bad_date_is_reported():
    assert tools.check_doctor_availability(doctor="dr-khan", date="someday")["found"] is False


# ---------- booking ----------

def test_booking_requires_confirmed_number():
    doctor_id, date, time = first_open()
    result = tools.book_appointment(PHONE, doctor_id, date, time, "Mehul", number_confirmed=False)
    assert result == {
        "ok": False,
        "error": "number_not_confirmed",
        "message": "Read the number back as '9 8 7 6 5, 4 3 2 1 0' and wait for the caller to confirm.",
    }
    assert db.upcoming_for_phone(PHONE) == []


def test_booking_rejects_invalid_number():
    doctor_id, date, time = first_open()
    assert tools.book_appointment("123", doctor_id, date, time, "Mehul", True)["error"] == "invalid_phone"


def test_book_then_slot_is_taken():
    doctor_id, date, time = first_open()
    booked = tools.book_appointment(PHONE, doctor_id, date, time, "mehul shah", True)
    assert booked["ok"] is True
    assert booked["appointment"]["patient_name"] == "Mehul Shah"
    assert booked["appointment"]["doctor_id"] == doctor_id

    again = tools.book_appointment("9123456780", doctor_id, date, time, "Someone", True)
    assert again["error"] == "slot_unavailable"
    assert time not in again["open_times_that_day"]


def test_booking_accepts_12h_time_and_doctor_name():
    doctor_id, date, _ = first_open("skin")
    slot = next(s for s in db.open_slots([doctor_id], date) if s["starts_at"][11:13] >= "12")
    hh, mm = int(slot["starts_at"][11:13]), slot["starts_at"][14:16]
    spoken = f"{hh - 12 if hh > 12 else hh}:{mm} PM"
    result = tools.book_appointment(PHONE, "Dr. Iyer", date, spoken, "Mehul", True)
    assert result["ok"] is True
    assert result["appointment"]["time"] == slot["starts_at"][11:16]


def test_booked_slot_disappears_from_availability():
    doctor_id, date, time = first_open()
    tools.book_appointment(PHONE, doctor_id, date, time, "Mehul", True)
    doc = tools.check_doctor_availability(doctor=doctor_id, date=date)["doctors"][0]
    assert time not in doc["times"]


# ---------- cancelling ----------

def test_cancel_requires_confirmation_and_existing_booking():
    assert tools.cancel_appointment(PHONE, False)["error"] == "number_not_confirmed"
    assert tools.cancel_appointment(PHONE, True)["error"] == "not_found"


def test_cancel_frees_the_slot():
    doctor_id, date, time = first_open()
    appt_id = tools.book_appointment(PHONE, doctor_id, date, time, "Mehul", True)["appointment"]["appointment_id"]

    result = tools.cancel_appointment("+91 98765 43210", True)
    assert result["ok"] is True
    assert result["cancelled"]["appointment_id"] == appt_id
    assert db.get_appointment(appt_id)["status"] == "cancelled"
    assert time in tools.check_doctor_availability(doctor=doctor_id, date=date)["doctors"][0]["times"]


def test_cancel_with_several_bookings_asks_which_one():
    d1, date1, t1 = first_open("heart")
    d2, date2, t2 = first_open("skin")
    a1 = tools.book_appointment(PHONE, d1, date1, t1, "Mehul", True)["appointment"]["appointment_id"]
    tools.book_appointment(PHONE, d2, date2, t2, "Mehul", True)

    ask = tools.cancel_appointment(PHONE, True)
    assert ask["error"] == "multiple_appointments"
    assert len(ask["appointments"]) == 2

    done = tools.cancel_appointment(PHONE, True, appointment_id=a1.lower())
    assert done["ok"] is True and done["cancelled"]["appointment_id"] == a1
    assert len(db.upcoming_for_phone(PHONE)) == 1
