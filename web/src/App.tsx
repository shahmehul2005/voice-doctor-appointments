import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  fetchAppointments,
  fetchDoctors,
  fetchHealth,
  dayKey,
  fmt12,
  fmtDayFull,
  type Appointment,
  type Doctor,
  type Health,
} from "./lib/api";
import { useCall, type ServerEvent } from "./lib/useCall";
import { bookedChime, cancelledChime } from "./lib/sounds";
import { DayCalendar, type Flash } from "./components/DayCalendar";
import { AppointmentsTable } from "./components/AppointmentsTable";
import { Phone } from "./components/Phone";
import { ActivityIcon, CalendarIcon, ChevronLeft, ChevronRight, ClinicMark, HeadsetIcon, ListIcon, PhoneIcon } from "./components/Icons";

const FLASH_MS = 7000;

type Activity = { id: number; at: Date; kind: "booked" | "cancelled" | "checked" | "call"; text: string };

export default function App() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [now, setNow] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [spotlight, setSpotlight] = useState<string[] | null>(null);
  const [slotFlash, setSlotFlash] = useState<Flash>({});
  const [apptFlash, setApptFlash] = useState<Record<string, "booked" | "cancelled">>({});
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const spotTimer = useRef(0);
  const seq = useRef(0);

  const log = useCallback((kind: Activity["kind"], text: string) => {
    setActivity((a) => [{ id: ++seq.current, at: new Date(), kind, text }, ...a].slice(0, 30));
  }, []);

  const load = useCallback(async () => {
    try {
      const [d, a, h] = await Promise.all([fetchDoctors(), fetchAppointments(), fetchHealth()]);
      setDoctors(d.doctors);
      setNow(d.now);
      setAppts(a.appointments);
      setHealth(h);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  const days = useMemo(() => {
    const set = new Set<string>();
    doctors.forEach((d) => d.slots.forEach((s) => set.add(dayKey(s.starts_at))));
    return [...set].sort().slice(0, 7);
  }, [doctors]);

  useEffect(() => {
    if (days.length && (!day || !days.includes(day))) setDay(days[0]);
  }, [day, days]);

  const onServerEvent = useCallback(
    (e: ServerEvent) => {
      clearTimeout(spotTimer.current);
      if (e.type === "availability_checked") {
        setSpotlight(e.doctor_ids);
        if (e.date) setDay(e.date);
        log("checked", `Checked availability${e.date ? ` for ${fmtDayFull(e.date)}` : ""}`);
        spotTimer.current = window.setTimeout(() => setSpotlight(null), 12000);
        return;
      }
      const kind = e.type === "appointment_booked" ? "booked" : "cancelled";
      const a = e.appointment;
      const slotKey = `${a.doctor_id}|${a.date}T${a.time}`;
      (kind === "booked" ? bookedChime : cancelledChime)();
      log(kind, `${kind === "booked" ? "Booked" : "Cancelled"} ${a.patient_name} with ${a.doctor}, ${fmtDayFull(a.date)} at ${fmt12(a.time)}`);
      setSpotlight([a.doctor_id]);
      setDay(a.date);
      setSlotFlash((f) => ({ ...f, [slotKey]: kind }));
      setApptFlash((f) => ({ ...f, [a.appointment_id]: kind }));
      void load();
      window.setTimeout(() => {
        setSlotFlash(({ [slotKey]: _, ...rest }) => rest);
        setApptFlash(({ [a.appointment_id]: _, ...rest }) => rest);
      }, FLASH_MS);
      spotTimer.current = window.setTimeout(() => setSpotlight(null), FLASH_MS);
    },
    [load, log],
  );

  const call = useCall(onServerEvent);
  const onCall = call.status === "dialing" || call.status === "connected";
  const voiceReady = health?.voice_ready ?? true;
  const canCall = !offline && voiceReady;

  const prevStatus = useRef(call.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = call.status;
    if (call.status === "connected" && prev !== "connected") log("call", "Test call connected");
    if (call.status === "ended" && prev !== "ended") {
      const secs = call.startedAt && call.endedAt ? Math.round((call.endedAt - call.startedAt) / 1000) : 0;
      log("call", call.startedAt ? `Call ended after ${Math.floor(secs / 60)}m ${secs % 60}s` : "Call didn't connect");
      setSpotlight(null);
      void load();
    }
  }, [call.status, call.startedAt, call.endedAt, load, log]);

  const tryCall = () => {
    setPhoneOpen(true);
    void call.start();
  };
  const closePhone = () => {
    setPhoneOpen(false);
    call.reset();
  };

  const dayIdx = day ? days.indexOf(day) : -1;
  const today = dayKey(now);
  const dayAppts = appts.filter((a) => a.status === "booked" && day && dayKey(a.starts_at) === day);
  const daySlots = doctors.flatMap((d) => d.slots.filter((s) => day && dayKey(s.starts_at) === day));
  const dayOpen = daySlots.filter((s) => !s.booked).length;
  const utilisation = daySlots.length ? Math.round(((daySlots.length - dayOpen) / daySlots.length) * 100) : 0;

  const kpis = [
    { label: "Appointments", value: dayAppts.length, hint: day === today ? "today" : "this day" },
    { label: "Open slots", value: dayOpen, hint: `${utilisation}% booked` },
    { label: "Booked by voice", value: appts.filter((a) => a.source === "voice" && a.status === "booked").length, hint: "all upcoming" },
    { label: "Cancellations", value: appts.filter((a) => a.status === "cancelled").length, hint: "slots released" },
  ];

  const lineLabel = offline ? "Server offline" : !voiceReady ? "Not configured" : onCall ? "On a call" : "Online";

  return (
    <div className={`shell ${phoneOpen ? "has-phone" : ""}`}>
      <audio ref={call.audioRef} autoPlay playsInline />

      <aside className="sidebar">
        <div className="org">
          <ClinicMark />
          <div>
            <div className="org-name">Linden Health</div>
            <div className="org-sub">Andheri West · Mumbai</div>
          </div>
        </div>
        <nav className="nav">
          <a href="#schedule" className="is-active"><CalendarIcon size={17} /> Schedule</a>
          <a href="#appointments"><ListIcon size={17} /> Appointments</a>
          <a href="#agent"><HeadsetIcon size={17} /> Voice agent</a>
        </nav>
        <div className="sidebar-foot">
          <div className={`agent-pill ${offline || !voiceReady ? "is-off" : onCall ? "is-busy" : ""}`}>
            <span className="dot" />
            Mira · {lineLabel}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>Schedule</h1>
            <p className="sub">{day ? fmtDayFull(day) : "Loading…"}</p>
          </div>
          <div className="topbar-actions">
            <div className="datenav">
              <button aria-label="Previous day" disabled={dayIdx <= 0} onClick={() => setDay(days[dayIdx - 1])}>
                <ChevronLeft size={16} />
              </button>
              <button className="datenav-today" disabled={!days.length} onClick={() => setDay(days[0])}>
                {days[0] === today ? "Today" : "Next open day"}
              </button>
              <button aria-label="Next day" disabled={dayIdx === -1 || dayIdx >= days.length - 1} onClick={() => setDay(days[dayIdx + 1])}>
                <ChevronRight size={16} />
              </button>
            </div>
            <select className="dayselect" value={day ?? ""} onChange={(e) => setDay(e.target.value)} aria-label="Choose day">
              {days.map((d) => (
                <option key={d} value={d}>
                  {fmtDayFull(d)}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={tryCall} disabled={onCall || !canCall}>
              <PhoneIcon size={15} /> Test call
            </button>
          </div>
        </header>

        {offline && <div className="banner">Can't reach the server. Check that it's running and that the API URL is correct.</div>}
        {!offline && !voiceReady && <div className="banner">The voice agent has no API keys on the server, so calls are disabled.</div>}

        <section className="kpis">
          {kpis.map((k) => (
            <div key={k.label} className="kpi">
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
              <div className="kpi-hint">{k.hint}</div>
            </div>
          ))}
        </section>

        <section id="schedule" className="card">
          <div className="card-head">
            <h2>Day view</h2>
            <div className="legend">
              <span><i className="lg lg-open" /> Available</span>
              <span><i className="lg lg-off" /> Off shift</span>
              <span><i className="lg lg-booked" /> Booked</span>
              <span><i className="lg lg-voice" /> Booked by voice</span>
            </div>
          </div>
          {day && <DayCalendar doctors={doctors} appointments={appts} day={day} now={now} spotlight={spotlight} flash={slotFlash} />}
        </section>

        <section id="appointments" className="card">
          <div className="card-head">
            <h2>Appointments</h2>
          </div>
          <AppointmentsTable items={appts} now={now} flash={apptFlash} />
        </section>
      </div>

      <aside id="agent" className="panel">
        <AnimatePresence mode="wait" initial={false}>
          {phoneOpen ? (
            <Phone key="phone" call={call} onClose={closePhone} />
          ) : (
            <motion.div key="agent" className="agent-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
              <div className="agent-head">
                <span className="agent-avatar">M</span>
                <div>
                  <div className="agent-name">Mira</div>
                  <div className="agent-role">Voice receptionist</div>
                </div>
                <span className={`status ${offline || !voiceReady ? "status--off" : "status--on"}`}>{lineLabel}</span>
              </div>

              <dl className="agent-meta">
                <div><dt>STT</dt><dd>{health?.models?.stt ?? "—"}</dd></div>
                <div><dt>LLM</dt><dd>{health?.models?.llm ?? "—"}</dd></div>
                <div><dt>TTS</dt><dd>{health?.models?.tts ?? "—"}</dd></div>
                <div><dt>Lines in use</dt><dd>{health ? `${health.active_calls} / ${health.max_calls}` : "—"}</dd></div>
              </dl>

              <button className="btn btn-primary btn-block" onClick={tryCall} disabled={!canCall}>
                <PhoneIcon size={15} /> Start test call
              </button>
              <p className="agent-hint">Ask for a doctor or speciality, give a 10-digit mobile number, and confirm when Mira reads it back.</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="activity">
          <div className="activity-head">
            <ActivityIcon size={15} /> Activity
          </div>
          {activity.length === 0 ? (
            <div className="activity-empty">Bookings and cancellations made during calls appear here.</div>
          ) : (
            <ul>
              <AnimatePresence initial={false}>
                {activity.map((a) => (
                  <motion.li key={a.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className={`act act--${a.kind}`}>
                    <span className="act-dot" />
                    <span className="act-text">{a.text}</span>
                    <time>{a.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </aside>

      {!phoneOpen && (
        <button className="fab" onClick={tryCall} disabled={!canCall} aria-label="Start test call">
          <PhoneIcon size={18} /> Test call
        </button>
      )}
    </div>
  );
}
