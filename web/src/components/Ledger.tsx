import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Appointment } from "../lib/api";
import { dayKey, fmtDayLong, fmtTime } from "../lib/api";

type Filter = "upcoming" | "cancelled" | "all";

export function Ledger({ items, now, flash }: { items: Appointment[]; now: string; flash: Record<string, "booked" | "cancelled"> }) {
  const [filter, setFilter] = useState<Filter>("upcoming");

  const counts = {
    upcoming: items.filter((a) => a.status === "booked" && a.starts_at > now).length,
    cancelled: items.filter((a) => a.status === "cancelled").length,
    all: items.length,
  };
  const shown = items.filter((a) =>
    filter === "all" ? true : filter === "cancelled" ? a.status === "cancelled" : a.status === "booked" && a.starts_at > now,
  );

  const groups: [string, Appointment[]][] = [];
  for (const a of shown) {
    const k = dayKey(a.starts_at);
    const g = groups.find(([d]) => d === k);
    if (g) g[1].push(a);
    else groups.push([k, [a]]);
  }

  return (
    <section className="panel ledger">
      <div className="panel-head">
        <h2>Appointments</h2>
        <div className="seg-ctl" role="tablist">
          {(["upcoming", "cancelled", "all"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "is-active" : ""} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} <span>{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <div className="empty">Nothing here yet.</div>}

      <div className="ledger-body">
        <AnimatePresence initial={false}>
          {groups.map(([d, rows]) => (
            <motion.div key={d} layout="position" className="ledger-group" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="ledger-day">{fmtDayLong(d)}</div>
              <AnimatePresence initial={false}>
                {rows.map((a) => (
                  <motion.div
                    key={a.id}
                    layout="position"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
                    className={`appt ${a.status === "cancelled" ? "is-cancelled" : ""} ${flash[a.id] ? `flash--${flash[a.id]}` : ""}`}
                  >
                    <div className="appt-time">{fmtTime(a.starts_at)}</div>
                    <div className="appt-who">
                      <div className="appt-name">
                        {a.patient_name}
                        {a.source === "voice" && <span className="via" title="Booked by voice">via Mira</span>}
                      </div>
                      <div className="appt-phone">{a.phone_masked}</div>
                    </div>
                    <div className="appt-doc">
                      <div>{a.doctor_name}</div>
                      <div className="appt-spec">{a.speciality}</div>
                    </div>
                    <div className={`pill pill--${a.status}`}>{a.status === "booked" ? "Booked" : "Cancelled"}</div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
