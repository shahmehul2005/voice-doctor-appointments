import pytest
from fastapi.testclient import TestClient

from app import config, main, tools


@pytest.fixture
def client():
    with TestClient(main.app) as c:
        yield c


def test_health(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert "voice_ready" in body


def test_doctors_include_slots(client):
    body = client.get("/api/doctors").json()
    assert len(body["doctors"]) == 6
    assert all({"starts_at", "minutes", "booked"} <= set(s) for d in body["doctors"] for s in d["slots"])


def test_appointments_never_expose_full_phone(client):
    doc = tools.check_doctor_availability(speciality="heart")["doctors"][0]
    tools.book_appointment("9876543210", doc["doctor_id"], doc["date"], doc["times"][0], "Mehul", True)

    rows = client.get("/api/appointments").json()["appointments"]
    assert rows, "seed + new booking should be listed"
    assert all("phone" not in r for r in rows)
    mine = next(r for r in rows if r["patient_name"] == "Mehul")
    assert mine["phone_masked"] == "98••••••10"
    assert "9876543210" not in client.get("/api/appointments").text


def test_offer_refused_when_keys_missing(client, monkeypatch):
    monkeypatch.setattr(main, "settings", config.Settings(elevenlabs_api_key="", google_api_key=""))
    res = client.post("/api/offer", json={"sdp": "v=0", "type": "offer"})
    assert res.status_code == 503
