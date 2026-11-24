import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { fetchAppointments, fetchDoctors, fetchHealth, dayKey, parseLocal, type Appointment, type Doctor } from "./lib/api";
import { useCall, type ServerEvent } from "./lib/useCall";
import { bookedChime, cancelledChime } from "./lib/sounds";
import { ScheduleBoard, type Flash } from "./components/ScheduleBoard";
import { Ledger } from "./components/Ledger";
import { Phone } from "./components/Phone";
import { LeafMark, PhoneIcon } from "./components/Icons";

const FLASH_MS = 7000;

export default function App() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [now, setNow] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [voiceReady, setVoiceReady] = useState(true);
  const [spotlight, setSpotlight] = useState<string[] | null>(null);
  const [slotFlash, setSlotFlash] = useState<Flash>({});
  const [apptFlash, setApptFlash] = useState<Record<string, "booked" | "cancelled">>({});
  const [phoneOpen, setPhoneOpen] = useState(false);
  const spotTimer = useRef(0);

  const load = useCallback(async () => {
    try {
      const [d, a, h] = await Promise.all([fetchDoctors(), fetchAppointments(), fetchHealth()]);
      setVoiceReady(h.voice_ready);
      setDoctors(d.doctors);
      setNow(d.now);
      setAppts(a.appointments);
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
    if (!day && days.length) setDay(days[0]);
  }, [day, days]);

  const onServerEvent = useCallback(
    (e: ServerEvent) => {
      clearTimeout(spotTimer.current);
      if (e.type === "availability_checked") {
        setSpotlight(e.doctor_ids);
        if (e.date) setDay(e.date);
        spotTimer.current = window.setTimeout(() => setSpotlight(null), 12000);
        return;
      }
      const kind = e.type === "appointment_booked" ? "booked" : "cancelled";
      const a = e.appointment;
      const slotKey = `${a.doctor_id}|${a.date}T${a.time}`;
      (kind === "booked" ? bookedChime : cancelledChime)();
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
    [load],
  );

  const call = useCall(onServerEvent);
  const onCall = call.status === "dialing" || call.status === "connected";
  const canCall = !offline && voiceReady;

  useEffect(() => {
    if (call.status === "ended") {
      setSpotlight(null);
      void load();
    }
  }, [call.status, load]);

  const tryCall = () => {
    setPhoneOpen(true);
    void call.start();
  };
  const closePhone = () => {
    setPhoneOpen(false);
    call.reset();
  };

  const todayLabel = labelFor(now);
  const upcoming = appts.filter((a) => a.status === "booked" && a.starts_at > now);
  const stats = [
    { label: "Open slots", value: doctors.reduce((n, d) => n + d.slots.filter((s) => !s.booked).length, 0), sub: "next 7 days" },
    { label: "Upcoming", value: upcoming.length, sub: "appointments" },
    { label: "Booked by Mira", value: appts.filter((a) => a.source === "voice" && a.status === "booked").length, sub: "over the phone" },
    { label: "Cancelled", value: appts.filter((a) => a.status === "cancelled").length, sub: "slots released" },
  ];

  return (
    <div className={`app ${phoneOpen ? "has-phone" : ""}`}>
      <audio ref={call.audioRef} autoPlay playsInline />

      <header className="top">
        <div className="brand">
          <LeafMark />
          <span className="brand-name">Linden Health</span>
          <span className="brand-sep" />
          <span className="brand-sub">Front desk</span>
        </div>
        <div className={`line ${onCall ? "is-live" : ""} ${offline || !voiceReady ? "is-off" : ""}`}>
          <span className="line-dot" />
          {offline
            ? "Server offline"
            : !voiceReady
              ? "Agent not configured"
              : onCall
                ? call.status === "dialing"
                  ? "Ringing"
                  : "On call"
                : "Line open"}
        </div>
        <button className="btn-call" onClick={tryCall} disabled={onCall || !canCall}>
          <PhoneIcon size={16} />
          Try call
        </button>
      </header>

      <section className="hero">
        <div className="hero-title">
          <h1>
            {todayLabel.dow} <em>{todayLabel.rest}</em>
          </h1>
          <p>Every call Mira takes lands here.</p>
        </div>
        <dl className="stats">
          {stats.map((s) => (
            <div key={s.label} className="stat">
              <dt>{s.label}</dt>
              <dd>
                <AnimatedNumber value={s.value} />
              </dd>
              <span>{s.sub}</span>
            </div>
          ))}
        </dl>
      </section>

      <main className="layout">
        <div className="main-col">
          {day && <ScheduleBoard doctors={doctors} days={days} day={day} onDay={setDay} now={now} spotlight={spotlight} flash={slotFlash} />}
          <Ledger items={appts} now={now} flash={apptFlash} />
        </div>

        <aside className="rail">
          <div className="rail-sticky">
            <AnimatePresence mode="wait">
              {phoneOpen ? (
                <Phone key="phone" call={call} onClose={closePhone} />
              ) : (
                <motion.div
                  key="idle"
                  className="desk-card"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="desk-top">
                    <span className="avatar">M</span>
                    <div>
                      <div className="desk-name">Mira</div>
                      <div className="desk-role">Voice receptionist</div>
                    </div>
                  </div>
                  <ul className="desk-try">
                    <li>“Is Dr. Rao free tomorrow?”</li>
                    <li>“Book me with a skin doctor.”</li>
                    <li>“Cancel my appointment.”</li>
                  </ul>
                  <button className="btn-dial" onClick={tryCall} disabled={!canCall}>
                    <span className="btn-dial-icon"><PhoneIcon size={18} /></span>
                    Try call
                  </button>
                  <div className="desk-foot">Pipecat · ElevenLabs · Gemini</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>
      </main>

      {!phoneOpen && (
        <button className="fab" onClick={tryCall} disabled={!canCall} aria-label="Try call">
          <PhoneIcon size={20} />
          Try call
        </button>
      )}
    </div>
  );
}

function labelFor(now: string) {
  const d = now ? parseLocal(now) : new Date();
  return {
    dow: d.toLocaleDateString("en-GB", { weekday: "long" }),
    rest: d.toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
  };
}

function AnimatedNumber({ value }: { value: number }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        initial={{ y: "60%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "-60%", opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        style={{ display: "inline-block" }}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
}
