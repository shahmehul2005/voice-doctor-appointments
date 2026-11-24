import { motion } from "motion/react";
import type { Doctor } from "../lib/api";
import { dayKey, fmtDayShort, fmtTime } from "../lib/api";

const START_H = 9;
const END_H = 19;
const SPAN = (END_H - START_H) * 60;
const HOURS = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);

export type Flash = Record<string, "booked" | "cancelled">; // key: `${doctor_id}|${starts_at}`

type Props = {
  doctors: Doctor[];
  days: string[];
  day: string;
  onDay: (d: string) => void;
  now: string;
  spotlight: string[] | null;
  flash: Flash;
};

const pos = (startsAt: string, minutes: number) => {
  const [h, m] = fmtTime(startsAt).split(":").map(Number);
  const from = h * 60 + m - START_H * 60;
  return { left: `${(from / SPAN) * 100}%`, width: `calc(${(minutes / SPAN) * 100}% - 3px)` };
};

export function ScheduleBoard({ doctors, days, day, onDay, now, spotlight, flash }: Props) {
  const isToday = dayKey(now) === day;
  const nowPos = isToday ? pos(now, 0).left : null;

  return (
    <section className="panel board">
      <div className="panel-head">
        <h2>Schedule</h2>
        <div className="legend">
          <span><i className="lg lg--open" />Open</span>
          <span><i className="lg lg--booked" />Booked</span>
          <span><i className="lg lg--new" />Just now</span>
        </div>
      </div>

      <div className="days" role="tablist">
        {days.map((d) => {
          const { dow, day: n } = fmtDayShort(d);
          const open = doctors.reduce((acc, doc) => acc + doc.slots.filter((s) => !s.booked && dayKey(s.starts_at) === d).length, 0);
          const total = doctors.reduce((acc, doc) => acc + doc.slots.filter((s) => dayKey(s.starts_at) === d).length, 0);
          return (
            <button key={d} role="tab" aria-selected={d === day} className={`day ${d === day ? "is-active" : ""}`} onClick={() => onDay(d)}>
              <span className="day-dow">{dayKey(now) === d ? "Today" : dow}</span>
              <span className="day-n">{n}</span>
              <span className="day-meter"><span style={{ width: total ? `${(open / total) * 100}%` : 0 }} /></span>
              <span className="day-open">{open} open</span>
              {d === day && <motion.span layoutId="day-ind" className="day-ind" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            </button>
          );
        })}
      </div>

      <div className="grid-scroll">
        <div className="grid">
          <div className="grid-axis">
            <div />
            <div className="axis-track">
              {HOURS.map((h) => (
                <span key={h} style={{ left: `${((h - START_H) * 60 * 100) / SPAN}%` }}>
                  {h <= 12 ? h : h - 12}
                  <small>{h < 12 ? "am" : "pm"}</small>
                </span>
              ))}
            </div>
          </div>

          {doctors.map((doc) => {
            const slots = doc.slots.filter((s) => dayKey(s.starts_at) === day);
            const open = slots.filter((s) => !s.booked).length;
            const lit = spotlight?.includes(doc.id);
            const dim = spotlight && !lit;
            return (
              <div key={doc.id} className={`row ${lit ? "is-lit" : ""} ${dim ? "is-dim" : ""}`}>
                <div className="row-doc">
                  <div className="row-name">{doc.name}</div>
                  <div className="row-meta">
                    {doc.speciality} <span>· Rm {doc.room}</span>
                  </div>
                  {lit && (
                    <motion.div className="row-tag" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}>
                      Mira is checking
                    </motion.div>
                  )}
                </div>
                <div className="row-track">
                  {HOURS.slice(1, -1).map((h) => (
                    <i key={h} className="tick" style={{ left: `${((h - START_H) * 60 * 100) / SPAN}%` }} />
                  ))}
                  {slots.length === 0 && <span className="row-off">Off today</span>}
                  {slots.map((s) => {
                    const f = flash[`${doc.id}|${s.starts_at}`];
                    return (
                      <span
                        key={s.starts_at}
                        className={`slot ${s.booked ? "slot--booked" : "slot--open"} ${f === "booked" ? "slot--just-booked" : f === "cancelled" ? "slot--just-released" : ""}`}
                        style={pos(s.starts_at, s.minutes)}
                        data-tip={`${fmtTime(s.starts_at)} · ${s.booked ? "booked" : "open"}`}
                      />
                    );
                  })}
                  {nowPos && <i className="now-line" style={{ left: nowPos }} />}
                </div>
                <div className="row-count">
                  <b>{open}</b>
                  <span>open</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
