import { motion } from "motion/react";
import type { Appointment, Doctor } from "../lib/api";
import { dayKey, fmt12, fmtTime, initials, shortDoctor } from "../lib/api";
import { HeadsetIcon } from "./Icons";

const START_H = 9;
const END_H = 19;
const HOUR_PX = 64;
const HOURS = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);

export type Flash = Record<string, "booked" | "cancelled">; // key: `${doctor_id}|${starts_at}`

type Props = {
  doctors: Doctor[];
  appointments: Appointment[];
  day: string;
  now: string;
  spotlight: string[] | null;
  flash: Flash;
};

const minutesFromStart = (startsAt: string) => {
  const [h, m] = fmtTime(startsAt).split(":").map(Number);
  return h * 60 + m - START_H * 60;
};
const top = (startsAt: string) => (minutesFromStart(startsAt) / 60) * HOUR_PX;
const height = (minutes: number) => (minutes / 60) * HOUR_PX;

/** Resource-column day view: one column per doctor, like a clinic appointment book. */
export function DayCalendar({ doctors, appointments, day, now, spotlight, flash }: Props) {
  const isToday = dayKey(now) === day;
  const nowOffset = isToday ? minutesFromStart(now) : -1;
  const showNow = nowOffset >= 0 && nowOffset <= (END_H - START_H) * 60;
  const booked = new Map(
    appointments
      .filter((a) => a.status === "booked" && dayKey(a.starts_at) === day)
      .map((a) => [`${a.doctor_id}|${a.starts_at}`, a]),
  );

  return (
    <div className="cal" style={{ ["--cols" as string]: doctors.length }}>
      <div className="cal-head">
        <div className="cal-gutter" />
        {doctors.map((d) => {
          const slots = d.slots.filter((s) => dayKey(s.starts_at) === day);
          const open = slots.filter((s) => !s.booked).length;
          const lit = spotlight?.includes(d.id);
          return (
            <div key={d.id} className={`cal-doc ${lit ? "is-lit" : ""}`}>
              <span className="doc-avatar">{initials(d.name)}</span>
              <div className="cal-doc-text">
                <div className="cal-doc-name" title={d.name}>{shortDoctor(d.name)}</div>
                <div className="cal-doc-meta">
                  {d.speciality} · {slots.length ? `${open} open` : "Off"}
                </div>
              </div>
              {lit && <span className="cal-doc-tag">Agent</span>}
            </div>
          );
        })}
      </div>

      <div className="cal-body">
        <div className="cal-gutter cal-times">
          {HOURS.map((h) => (
            <div key={h} className="cal-time" style={{ height: HOUR_PX }}>
              <span>{fmt12(`${String(h).padStart(2, "0")}:00`).replace(":00", "")}</span>
            </div>
          ))}
        </div>

        {doctors.map((d) => {
          const slots = d.slots.filter((s) => dayKey(s.starts_at) === day);
          const lit = spotlight?.includes(d.id);
          const dim = spotlight && !lit;
          return (
            <div key={d.id} className={`cal-col ${lit ? "is-lit" : ""} ${dim ? "is-dim" : ""}`} style={{ height: HOUR_PX * HOURS.length }}>
              {HOURS.map((h) => (
                <div key={h} className="cal-hour" style={{ top: (h - START_H) * HOUR_PX, height: HOUR_PX }} />
              ))}
              {slots.map((s) => {
                const key = `${d.id}|${s.starts_at}`;
                const appt = booked.get(key);
                const f = flash[key];
                const style = { top: top(s.starts_at) + 1, height: height(s.minutes) - 2 };
                if (s.booked && appt) {
                  const compact = s.minutes < 30;
                  return (
                    <motion.div
                      key={key}
                      layout
                      className={`appt-block ${appt.source === "voice" ? "is-voice" : ""} ${f === "booked" ? "is-new" : ""} ${compact ? "is-compact" : ""}`}
                      style={style}
                      title={`${fmt12(fmtTime(s.starts_at))} · ${appt.patient_name} · ${d.name}`}
                    >
                      <span className="appt-block-name">
                        {appt.source === "voice" && <HeadsetIcon size={11} />}
                        {appt.patient_name}
                      </span>
                      {!compact && <span className="appt-block-time">{fmt12(fmtTime(s.starts_at))}</span>}
                    </motion.div>
                  );
                }
                return (
                  <div key={key} className={`slot-open ${f === "cancelled" ? "is-freed" : ""}`} style={style}>
                    <span>{fmt12(fmtTime(s.starts_at))}</span>
                  </div>
                );
              })}
            </div>
          );
        })}

        {showNow && (
          <div className="cal-now" style={{ top: (nowOffset / 60) * HOUR_PX }}>
            <span>{fmt12(fmtTime(now))}</span>
          </div>
        )}
      </div>
    </div>
  );
}
