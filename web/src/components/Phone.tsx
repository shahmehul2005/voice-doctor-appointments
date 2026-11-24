import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { useCall, Turn, BookingSummary } from "../lib/useCall";
import { fmtDayLong } from "../lib/api";
import { Waveform } from "./Waveform";
import { CheckIcon, EndIcon, MicIcon, MicOffIcon, PhoneIcon, StatusBar, XIcon } from "./Icons";

type Call = ReturnType<typeof useCall>;

const TOOL_LABEL: Record<string, [string, string]> = {
  check_doctor_availability: ["Checking the schedule", "Checked the schedule"],
  book_appointment: ["Booking", "Booking processed"],
  cancel_appointment: ["Cancelling", "Cancellation processed"],
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

export function Phone({ call, onClose }: { call: Call; onClose: () => void }) {
  const now = useNow();
  const { status, turns, startedAt, endedAt } = call;
  const elapsed = startedAt ? (endedAt ?? now) - startedAt : 0;
  const wall = new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <motion.div
      className={`phone phone--${status}`}
      initial={{ y: 40, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 30, opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
    >
      <div className="phone-screen">
        <StatusBar time={wall} />
        <div className="island" />

        <AnimatePresence mode="popLayout" initial={false}>
          {status === "dialing" && (
            <motion.div key="dial" className="dial" exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
              <div className="dial-avatar">
                <span className="ring r1" />
                <span className="ring r2" />
                <span className="ring r3" />
                <span className="avatar avatar--lg">M</span>
              </div>
              <div className="dial-name">Mira</div>
              <div className="dial-sub">Linden Health front desk</div>
              <div className="dial-state">
                Calling<span className="dots"><i>.</i><i>.</i><i>.</i></span>
              </div>
            </motion.div>
          )}

          {status !== "dialing" && (
            <motion.div
              key="live"
              className="live"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
            >
              <header className="live-head">
                <span className={`avatar ${call.agentSpeaking ? "avatar--speaking" : ""}`}>M</span>
                <div>
                  <div className="live-name">Mira</div>
                  <div className="live-sub">
                    {status === "ended" ? (
                      <span>Call ended · {clock(elapsed)}</span>
                    ) : (
                      <>
                        <span className="rec" /> {clock(elapsed)}
                      </>
                    )}
                  </div>
                </div>
              </header>
              <Waveform levels={call.levels} active={status === "connected"} />
              <Transcript turns={turns} />
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="phone-controls">
          {status === "ended" ? (
            <>
              {call.error && <div className="phone-error">{call.error}</div>}
              <div className="ctl-row">
                <button className="ctl" onClick={onClose} aria-label="Close">
                  <span className="ctl-btn"><XIcon size={22} /></span>
                  <span>Close</span>
                </button>
                <button className="ctl" onClick={call.start} aria-label="Call again">
                  <span className="ctl-btn ctl-btn--call"><PhoneIcon size={22} /></span>
                  <span>Call again</span>
                </button>
              </div>
            </>
          ) : (
            <div className="ctl-row">
              <button
                className={`ctl ${call.muted ? "is-on" : ""}`}
                onClick={call.toggleMute}
                disabled={status !== "connected"}
                aria-pressed={call.muted}
              >
                <span className="ctl-btn">{call.muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}</span>
                <span>{call.muted ? "Unmute" : "Mute"}</span>
              </button>
              <button className="ctl" onClick={call.hangUp} aria-label="End call">
                <span className="ctl-btn ctl-btn--end"><EndIcon size={26} /></span>
                <span>End</span>
              </button>
            </div>
          )}
        </footer>
        <div className="home-bar" />
      </div>
    </motion.div>
  );
}

function Transcript({ turns }: { turns: Turn[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns]);

  return (
    <div className="transcript" ref={box}>
      {turns.length === 0 && <div className="transcript-empty">Say hello when Mira greets you.</div>}
      <AnimatePresence initial={false}>
        {turns.map((t) => (
          <motion.div
            key={t.key}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className={`turn turn--${t.role}`}
          >
            <TurnBody t={t} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function TurnBody({ t }: { t: Turn }) {
  switch (t.role) {
    case "user":
      return (
        <p className="bubble bubble--user">
          {t.text}
          {t.interim && <span className="interim"> {t.interim}</span>}
        </p>
      );
    case "agent":
      return (
        <p className="bubble bubble--agent">
          {t.segments.map((s) => (
            <span key={s.id} className="seg">
              <span>{s.spoken}</span>
              <span className={s.cut ? "unspoken cut" : "unspoken"}>{s.text.slice(s.spoken.length)}</span>{" "}
            </span>
          ))}
        </p>
      );
    case "tool": {
      const [doing, done] = TOOL_LABEL[t.name] ?? [t.name, t.name];
      return (
        <div className={`tool ${t.done ? "is-done" : ""}`}>
          {t.done ? <CheckIcon size={12} /> : <span className="spinner" />}
          <span>{t.done ? done : doing}</span>
          <code>{t.name}</code>
        </div>
      );
    }
    case "booked":
      return <Ticket a={t.appointment} />;
    case "cancelled":
      return (
        <div className="ticket ticket--void">
          <div className="ticket-kicker">Cancelled</div>
          <div className="ticket-doc">{t.appointment.doctor}</div>
          <div className="ticket-when">
            {fmtDayLong(t.appointment.date)} · {t.appointment.time}
          </div>
        </div>
      );
  }
}

function Ticket({ a }: { a: BookingSummary }) {
  return (
    <motion.div
      className="ticket"
      initial={{ rotateX: -70, opacity: 0 }}
      animate={{ rotateX: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 180, damping: 16 }}
    >
      <div className="ticket-top">
        <span className="ticket-kicker">
          <CheckIcon size={12} /> Confirmed
        </span>
        <span className="ticket-ref">#{a.appointment_id}</span>
      </div>
      <div className="ticket-when-big">
        <span>{fmtDayLong(a.date)}</span>
        <em>{a.time}</em>
      </div>
      <div className="ticket-perf" />
      <div className="ticket-grid">
        <div>
          <label>Doctor</label>
          {a.doctor}
        </div>
        <div>
          <label>Room</label>
          {a.room ?? "—"}
        </div>
        <div>
          <label>Patient</label>
          {a.patient_name}
        </div>
        <div>
          <label>Dept</label>
          {a.speciality}
        </div>
      </div>
    </motion.div>
  );
}
