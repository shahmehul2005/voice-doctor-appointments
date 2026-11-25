// The server URL can be overridden at runtime with ?api=https://... (remembered in
// localStorage), so a deployed dashboard can point at a new tunnel without a rebuild.
function resolveApiUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get("api");
  if (fromQuery && /^https?:\/\//.test(fromQuery)) localStorage.setItem("api_url", fromQuery);
  if (fromQuery === "reset") localStorage.removeItem("api_url");
  return (localStorage.getItem("api_url") || import.meta.env.VITE_API_URL || "http://localhost:7860").replace(/\/$/, "");
}

export const API_URL = resolveApiUrl();
const transportParam = new URLSearchParams(location.search).get("transport");
export const TRANSPORT: "webrtc" | "websocket" =
  (transportParam || import.meta.env.VITE_TRANSPORT) === "websocket" ? "websocket" : "webrtc";

export type Slot = { starts_at: string; minutes: number; booked: boolean };
export type Doctor = { id: string; name: string; speciality: string; room: string; slots: Slot[] };
export type Appointment = {
  id: string;
  doctor_id: string;
  doctor_name: string;
  speciality: string;
  room: string;
  patient_name: string;
  phone_masked: string;
  starts_at: string;
  status: "booked" | "cancelled";
  source: "voice" | "seed";
  created_at: string;
  cancelled_at: string | null;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export type Health = {
  ok: boolean;
  voice_ready: boolean;
  active_calls: number;
  max_calls: number;
  models?: { stt: string; llm: string; tts: string };
};
export const fetchHealth = () => get<Health>("/api/health");
export const fetchDoctors = () => get<{ now: string; doctors: Doctor[] }>("/api/doctors");
export const fetchAppointments = () => get<{ appointments: Appointment[] }>("/api/appointments");

// ---------- formatting (all times are clinic-local strings, no TZ juggling) ----------

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const parseLocal = (s: string) => {
  const [d, t = "00:00"] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  return new Date(y, m - 1, day, h, min);
};

export const dayKey = (s: string) => s.slice(0, 10);
export const fmtTime = (s: string) => s.slice(11, 16);
export const fmtDayShort = (key: string) => {
  const d = parseLocal(key);
  return { dow: DAYS[d.getDay()], day: d.getDate(), month: MONTHS[d.getMonth()] };
};
export const fmtDayLong = (key: string) => {
  const { dow, day, month } = fmtDayShort(key);
  return `${dow} ${day} ${month}`;
};
export const shortDoctor = (name: string) => name.replace(/^Dr\.\s+\S+\s+/, "Dr. ");

const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Thursday, 26 November" */
export const fmtDayFull = (key: string) => {
  const d = parseLocal(key);
  return `${LONG_DAYS[d.getDay()]}, ${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`;
};

/** "14:30" -> "2:30 PM" */
export const fmt12 = (hhmm: string) => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export const initials = (name: string) =>
  name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
