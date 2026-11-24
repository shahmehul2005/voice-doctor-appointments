"""SQLite store for doctors, slots and appointments.

One small file, no ORM. Slots are generated for a rolling window of upcoming
working days, so the demo always has fresh availability no matter when it runs.
"""

from __future__ import annotations

import os
import random
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.getenv("CLINIC_TIMEZONE", "Asia/Kolkata"))
DB_PATH = Path(os.getenv("DB_PATH", Path(__file__).resolve().parent.parent / "data" / "clinic.db"))
WINDOW_DAYS = 7  # how many working days of slots to keep open

DOCTORS = [
    # id, name, speciality, room, (start, end) hours, slot minutes
    ("dr-mehta", "Dr. Anjali Mehta", "General Physician", "101", [(9, 13), (15, 18)], 20),
    ("dr-rao", "Dr. Vikram Rao", "Cardiologist", "204", [(10, 14)], 30),
    ("dr-iyer", "Dr. Priya Iyer", "Dermatologist", "112", [(11, 15), (16, 19)], 30),
    ("dr-khan", "Dr. Sameer Khan", "Orthopedic Surgeon", "305", [(9, 12), (14, 17)], 30),
    ("dr-sharma", "Dr. Neha Sharma", "Pediatrician", "118", [(9, 13)], 20),
    ("dr-dsouza", "Dr. Karen D'Souza", "ENT Specialist", "210", [(14, 19)], 30),
]

SEED_PATIENTS = [
    ("Rohan Gupta", "9876501234"),
    ("Aisha Patel", "9820012345"),
    ("Kabir Singh", "9811122233"),
    ("Meera Nair", "9900054321"),
    ("Arjun Das", "9765409876"),
    ("Sara Thomas", "9833300111"),
]

_lock = threading.Lock()


def now() -> datetime:
    return datetime.now(TZ).replace(tzinfo=None)


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH, isolation_level=None)  # autocommit; explicit BEGIN when needed
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def init() -> None:
    global _last_refresh
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _lock, connect() as c:
        c.execute("PRAGMA journal_mode = WAL")
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS doctors (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                speciality TEXT NOT NULL,
                room TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doctor_id TEXT NOT NULL REFERENCES doctors(id),
                starts_at TEXT NOT NULL,          -- local clinic time, 'YYYY-MM-DDTHH:MM'
                minutes INTEGER NOT NULL,
                is_booked INTEGER NOT NULL DEFAULT 0,
                UNIQUE (doctor_id, starts_at)
            );
            CREATE TABLE IF NOT EXISTS appointments (
                id TEXT PRIMARY KEY,
                slot_id INTEGER NOT NULL REFERENCES slots(id),
                doctor_id TEXT NOT NULL REFERENCES doctors(id),
                patient_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                starts_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('booked', 'cancelled')),
                source TEXT NOT NULL DEFAULT 'voice',
                created_at TEXT NOT NULL,
                cancelled_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_appt_phone ON appointments(phone, status);
            """
        )
        c.execute("BEGIN")
        for doc_id, name, spec, room, _, _ in DOCTORS:
            c.execute(
                "INSERT OR IGNORE INTO doctors (id, name, speciality, room) VALUES (?, ?, ?, ?)",
                (doc_id, name, spec, room),
            )
        _top_up_slots(c)
        _seed_appointments(c)
        c.execute("COMMIT")
    _last_refresh = now().date()


def _working_days(start: date, count: int) -> list[date]:
    days, d = [], start
    while len(days) < count:
        if d.weekday() != 6:  # closed on Sundays
            days.append(d)
        d += timedelta(days=1)
    return days


def _top_up_slots(c: sqlite3.Connection) -> None:
    for day in _working_days(now().date(), WINDOW_DAYS):
        for doc_id, _, _, _, shifts, minutes in DOCTORS:
            for start_h, end_h in shifts:
                t = datetime.combine(day, time(start_h))
                end = datetime.combine(day, time(end_h))
                while t + timedelta(minutes=minutes) <= end:
                    c.execute(
                        "INSERT OR IGNORE INTO slots (doctor_id, starts_at, minutes) VALUES (?, ?, ?)",
                        (doc_id, t.strftime("%Y-%m-%dT%H:%M"), minutes),
                    )
                    t += timedelta(minutes=minutes)


def _seed_appointments(c: sqlite3.Connection) -> None:
    """Pre-book a few slots on a fresh database so the schedule looks lived in."""
    if c.execute("SELECT COUNT(*) FROM appointments").fetchone()[0]:
        return
    rng = random.Random(7)
    open_slots = c.execute(
        "SELECT id, doctor_id, starts_at FROM slots WHERE is_booked = 0 AND starts_at > ? ORDER BY starts_at",
        (now().strftime("%Y-%m-%dT%H:%M"),),
    ).fetchall()
    for (name, phone), slot in zip(SEED_PATIENTS, rng.sample(open_slots, len(SEED_PATIENTS)), strict=True):
        _insert_appointment(c, slot, name, phone, source="seed")


def _new_id() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I, easier to say out loud
    return "".join(secrets.choice(alphabet) for _ in range(5))


def _insert_appointment(c, slot, name: str, phone: str, source: str = "voice") -> str:
    appt_id = _new_id()
    c.execute("UPDATE slots SET is_booked = 1 WHERE id = ?", (slot["id"],))
    c.execute(
        """INSERT INTO appointments
           (id, slot_id, doctor_id, patient_name, phone, starts_at, status, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'booked', ?, ?)""",
        (appt_id, slot["id"], slot["doctor_id"], name, phone, slot["starts_at"], source,
         now().isoformat(timespec="seconds")),
    )
    return appt_id


# ---------- queries ----------

def list_doctors() -> list[dict]:
    with connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM doctors ORDER BY name")]


def open_slots(doctor_ids: list[str] | None = None, on_date: str | None = None) -> list[dict]:
    sql = "SELECT s.id, s.doctor_id, s.starts_at, s.minutes FROM slots s WHERE s.is_booked = 0 AND s.starts_at > ?"
    args: list = [now().strftime("%Y-%m-%dT%H:%M")]
    if doctor_ids:
        sql += f" AND s.doctor_id IN ({','.join('?' * len(doctor_ids))})"
        args += doctor_ids
    if on_date:
        sql += " AND substr(s.starts_at, 1, 10) = ?"
        args.append(on_date)
    sql += " ORDER BY s.starts_at"
    with connect() as c:
        return [dict(r) for r in c.execute(sql, args)]


def all_slots() -> list[dict]:
    """Every upcoming slot, booked or not. Used by the dashboard grid."""
    with connect() as c:
        return [
            dict(r)
            for r in c.execute(
                "SELECT id, doctor_id, starts_at, minutes, is_booked FROM slots WHERE starts_at > ? ORDER BY starts_at",
                (now().strftime("%Y-%m-%dT%H:%M"),),
            )
        ]


def list_appointments() -> list[dict]:
    with connect() as c:
        return [
            dict(r)
            for r in c.execute(
                """SELECT a.*, d.name AS doctor_name, d.speciality, d.room
                   FROM appointments a JOIN doctors d ON d.id = a.doctor_id
                   ORDER BY a.starts_at"""
            )
        ]


def upcoming_for_phone(phone: str) -> list[dict]:
    with connect() as c:
        return [
            dict(r)
            for r in c.execute(
                """SELECT a.*, d.name AS doctor_name, d.speciality
                   FROM appointments a JOIN doctors d ON d.id = a.doctor_id
                   WHERE a.phone = ? AND a.status = 'booked' AND a.starts_at > ?
                   ORDER BY a.starts_at""",
                (phone, now().strftime("%Y-%m-%dT%H:%M")),
            )
        ]


def get_appointment(appt_id: str) -> dict | None:
    with connect() as c:
        r = c.execute(
            """SELECT a.*, d.name AS doctor_name, d.speciality, d.room
               FROM appointments a JOIN doctors d ON d.id = a.doctor_id WHERE a.id = ?""",
            (appt_id,),
        ).fetchone()
        return dict(r) if r else None


class SlotTaken(Exception):
    pass


def book(doctor_id: str, starts_at: str, name: str, phone: str) -> dict:
    """Atomically claim a slot. Raises SlotTaken if someone else got it first."""
    with _lock, connect() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            slot = c.execute(
                "SELECT * FROM slots WHERE doctor_id = ? AND starts_at = ? AND starts_at > ?",
                (doctor_id, starts_at, now().strftime("%Y-%m-%dT%H:%M")),
            ).fetchone()
            if not slot or slot["is_booked"]:
                raise SlotTaken()
            appt_id = _insert_appointment(c, slot, name, phone)
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise
    return get_appointment(appt_id)


def cancel(appt_id: str) -> dict:
    with _lock, connect() as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            appt = c.execute("SELECT * FROM appointments WHERE id = ?", (appt_id,)).fetchone()
            c.execute(
                "UPDATE appointments SET status = 'cancelled', cancelled_at = ? WHERE id = ?",
                (now().isoformat(timespec="seconds"), appt_id),
            )
            c.execute("UPDATE slots SET is_booked = 0 WHERE id = ?", (appt["slot_id"],))
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise
    return get_appointment(appt_id)


_last_refresh: date | None = None


def refresh() -> None:
    """Keep the rolling slot window current. Cheap no-op unless the date changed."""
    global _last_refresh
    if _last_refresh == now().date():
        return
    with _lock, connect() as c:
        c.execute("BEGIN")
        _top_up_slots(c)
        c.execute("COMMIT")
    _last_refresh = now().date()
