import { useMemo, useState } from "react";
import type { Appointment } from "../lib/api";
import { fmt12, fmtDayShort, fmtTime, initials } from "../lib/api";
import { HeadsetIcon } from "./Icons";

type Filter = "upcoming" | "cancelled" | "all";

export function AppointmentsTable({ items, now, flash }: { items: Appointment[]; now: string; flash: Record<string, "booked" | "cancelled"> }) {
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [q, setQ] = useState("");

  const counts = {
    upcoming: items.filter((a) => a.status === "booked" && a.starts_at > now).length,
    cancelled: items.filter((a) => a.status === "cancelled").length,
    all: items.length,
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items
      .filter((a) =>
        filter === "all" ? true : filter === "cancelled" ? a.status === "cancelled" : a.status === "booked" && a.starts_at > now,
      )
      .filter((a) => !needle || `${a.patient_name} ${a.doctor_name} ${a.speciality} ${a.id}`.toLowerCase().includes(needle));
  }, [items, filter, q, now]);

  return (
    <div className="table-card">
      <div className="table-toolbar">
        <div className="tabs" role="tablist">
          {(["upcoming", "cancelled", "all"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "is-active" : ""} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
              <span className="count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search patient, doctor or ID" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Booked via</th>
              <th>Ref</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const { dow, day, month } = fmtDayShort(a.starts_at.slice(0, 10));
              return (
                <tr key={a.id} className={`${a.status === "cancelled" ? "is-cancelled" : ""} ${flash[a.id] ? `flash-${flash[a.id]}` : ""}`}>
                  <td className="nowrap">
                    {dow}, {day} {month}
                  </td>
                  <td className="nowrap num">{fmt12(fmtTime(a.starts_at))}</td>
                  <td>
                    <div className="person">
                      <span className="person-avatar">{initials(a.patient_name)}</span>
                      <div>
                        <div className="person-name">{a.patient_name}</div>
                        <div className="muted num">{a.phone_masked}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div>{a.doctor_name}</div>
                    <div className="muted">{a.speciality}</div>
                  </td>
                  <td>
                    {a.source === "voice" ? (
                      <span className="source source--voice">
                        <HeadsetIcon size={12} /> Voice agent
                      </span>
                    ) : (
                      <span className="source">Front desk</span>
                    )}
                  </td>
                  <td className="num muted">{a.id}</td>
                  <td>
                    <span className={`badge badge--${a.status}`}>{a.status === "booked" ? "Confirmed" : "Cancelled"}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">No appointments match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
