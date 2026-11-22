"use client";

import { staffText, type Locale } from "@/lib/i18n";
import { useI18n } from "@/components/LocaleProvider";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppContext";
import { useScope } from "@/components/FilterBar";
import AbsenceAlerts from "@/components/AbsenceAlerts";
import BackupStatus from "@/components/BackupStatus";
import { usePendingRegistrations } from "@/components/Registrations";
import { useHistoryScope } from "@/components/ranking/useHistoryScope";
import { useStore } from "@/lib/offline/store";
import { useRankingSettings } from "@/lib/rankingSettings";
import { periodRange } from "@/lib/ranking";
import { SECTION_LABEL, type Section } from "@/lib/filter";
import { entryRange, type QuranRange } from "@/lib/quran";
import { formatMeasure, measure, type ProgressUnit } from "@/lib/pages";
import { addDays, todayStr, type Attendance, type Circle } from "@/lib/types";

// 📈 اللوحة (admin): the centre at a glance, within the fixed filter. Everything is computed on
// the device from the synced window (the last 60 days), so it also opens offline.
export default function Dashboard({ openStudent, openManage }: { openStudent: (id: string) => void; openManage: () => void }) {
  const { tx, locale } = useI18n();
  const s = useStore();
  const { supabase, mushaf, isPlatformAdmin } = useApp();
  const settings = useRankingSettings(supabase);
  const { scopedCircles, inScope } = useScope();
  const pendingRegs = usePendingRegistrations();
  const today = todayStr();
  const week = periodRange("week", today, settings, { from: today, to: today });
  const month = periodRange("month", today, settings, { from: today, to: today });

  const students = s.all("students").filter((st) => st.active && inScope(st.circle_id));
  const quranBy = s.byStudent("quran_entries");
  const attBy = s.byStudent("attendance");
  const lessons = s.all("circle_lessons");
  // Records count towards the halaqa the student was in on their day (نقل الطلاب).
  const { circleOn } = useHistoryScope();
  const everyone = s.all("students").filter((st) => st.active);
  const [unit, setUnit] = useState<ProgressUnit>("PAGES");
  useEffect(() => setUnit(readUnit()), []);

  const perCircle = useMemo(() => {
    return scopedCircles
      .map((c) => {
        const mine = students.filter((st) => st.circle_id === c.id);
        const done: Record<ProgressUnit, number> = { PAGES: 0, SURAHS: 0, JUZ: 0, AYAHS: 0 };
        const att: Attendance[] = [];
        for (const st of everyone) {
          const ranges = (quranBy.get(st.id) ?? [])
            .filter((e) => e.track === "HIFZ" && !e.deleted_at && e.entry_date >= month.from && e.entry_date <= today && circleOn(st.id, e.entry_date) === c.id)
            .map(entryRange)
            .filter((r): r is QuranRange => !!r);
          if (ranges.length) for (const u of UNITS) done[u] += measure(mushaf, ranges, u);
          for (const a of attBy.get(st.id) ?? []) if (circleOn(st.id, a.att_date) === c.id) att.push(a);
        }
        return { circle: c, count: mine.length, done, week: rate(att, week.from, today), month: rate(att, month.from, today) };
      })
      .filter((x) => x.count > 0 || x.done.AYAHS > 0);
  }, [scopedCircles, students, everyone, circleOn, quranBy, attBy, mushaf, month.from, week.from, today]);

  const all = everyone.flatMap((st) => (attBy.get(st.id) ?? []).filter((a) => inScope(circleOn(st.id, a.att_date) ?? "")));
  const weekRate = rate(all, week.from, today);
  const monthRate = rate(all, month.from, today);
  const bySection = (["MALE", "FEMALE"] as Section[])
    .map((sec) => ({ sec, n: perCircle.filter((x) => x.circle.section === sec).reduce((a, x) => a + x.count, 0) }))
    .filter((x) => x.n > 0);
  const noSection = perCircle.filter((x) => !x.circle.section).reduce((a, x) => a + x.count, 0);
  const byDone = [...perCircle].sort((a, b) => b.done[unit] - a.done[unit]);
  const quiet = perCircle.filter((x) => !recordedToday(x.circle));

  // A halaqa "recorded today" when it has attendance, a hifz/recitation entry or the day's lesson.
  function recordedToday(c: Circle): boolean {
    const ids = students.filter((st) => st.circle_id === c.id).map((st) => st.id);
    return (
      ids.some((id) => {
        const a = s.get("attendance", `${id}|${today}`);
        return (a && !a.deleted_at) || (quranBy.get(id) ?? []).some((e) => e.entry_date === today && !e.deleted_at);
      }) || lessons.some((l) => l.circle_id === c.id && l.lesson_date === today && !l.deleted_at)
    );
  }

  // Who recorded in the halaqa last, and when: the teacher to call.
  function lastRecord(c: Circle): { teacher: string; date: string } | null {
    let best: { teacher_id: string | null; date: string } | null = null;
    for (const st of students.filter((x) => x.circle_id === c.id)) {
      for (const r of [...(attBy.get(st.id) ?? []).map((a) => ({ teacher_id: a.teacher_id, date: a.att_date, del: a.deleted_at })),
        ...(quranBy.get(st.id) ?? []).map((e) => ({ teacher_id: e.teacher_id, date: e.entry_date, del: e.deleted_at }))]) {
        if (!r.del && r.date < today && (!best || r.date > best.date)) best = r;
      }
    }
    if (!best) return null;
    return { teacher: (best.teacher_id && s.get("profiles", best.teacher_id)?.name) || "—", date: best.date };
  }

  return (
    <section className="dashboard">
      <div className="grid dash-tiles">
        <Tile icon="👨‍🎓" label={tx("الطلاب")} value={String(students.length)}>
          <span className="muted">
            {bySection.map((x) => `${tx(SECTION_LABEL[x.sec])} ${x.n}`).join(" · ")}
            {noSection ? tx("{0}بلا قسم {1}", [bySection.length ? " · " : "", noSection]) : ""}
          </span>
        </Tile>
        <Tile icon="📅" label={tx("الحضور هذا الأسبوع")} value={pct(weekRate)} progress={weekRate} />
        <Tile icon="🗓️" label={tx("الحضور هذا الشهر")} value={pct(monthRate)} progress={monthRate} />
        {pendingRegs !== null && (
          <button className="card stat stat-tile tile-button" onClick={openManage}>
            <span className="stat-icon" aria-hidden="true">
              📝
            </span>
            <div>
              <span className="muted">{tx("طلبات تسجيل جديدة")}</span>
              <b>{pendingRegs}</b>
            </div>
          </button>
        )}
      </div>

      {quiet.length > 0 && (
        <div className="card insight warn-card quiet-card">
          <h3>{tx("⏳ لم تُسجَّل تقارير اليوم")}</h3>
          <p className="muted">{tx("حلقات بلا حضور ولا تسميع ولا درس اليوم، ومعها آخر من سجّل فيها")}</p>
          <ul className="insight-list">
            {quiet.map(({ circle }) => {
              const last = lastRecord(circle);
              return (
                <li key={circle.id}>
                  <b>{circle.name}</b>
                  <span className="muted">{last ? tx("آخر تسجيل: {0} · {1}", [last.teacher, dayAgo(locale, last.date, today)]) : tx("لا تسجيلات بعد")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AbsenceAlerts students={students} open={openStudent} />

      {/* The nightly backup covers the whole platform's database: ours to watch, not each centre's. */}
      {isPlatformAdmin && <BackupStatus />}

      <div className="card">
        <h3>{tx("🏫 الحلقات")}</h3>
        <p className="muted">{tx("مرتّبة بما حُفظ هذا الشهر، محسوبًا بـ:")}</p>
        <div className="recent">
          {UNITS.map((u) => (
            <button key={u} className={`chip ${unit === u ? "on" : ""}`} onClick={() => setUnit(saveUnit(u))}>
              {tx(UNIT_LABEL[u])}
            </button>
          ))}
        </div>
        <div className="table-scroll">
          <table className="dash-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{tx("الحلقة")}</th>
                <th>{tx("الطلاب")}</th>
                <th>{tx(UNIT_COLUMN[unit])}</th>
                <th>{tx("حضور الأسبوع")}</th>
                <th>{tx("حضور الشهر")}</th>
              </tr>
            </thead>
            <tbody>
              {byDone.map((x, i) => (
                <tr key={x.circle.id}>
                  <td>{x.done[unit] > 0 ? ["🥇", "🥈", "🥉"][i] ?? i + 1 : "—"}</td>
                  <td>
                    {x.circle.name}
                    {x.circle.section && <span className="muted"> · {tx(SECTION_LABEL[x.circle.section as Section])}</span>}
                  </td>
                  <td>{x.count}</td>
                  <td>{formatMeasure(x.done[unit], unit)}</td>
                  <td>{pct(x.week)}</td>
                  <td>{pct(x.month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!byDone.length && <p className="muted">{tx("لا توجد حلقات فيها طلاب ضمن هذا الفرز.")}</p>}
      </div>
    </section>
  );
}

function Tile({ icon, label, value, progress, children }: { icon: string; label: string; value: string; progress?: number | null; children?: React.ReactNode }) {
  const { tx } = useI18n();
  return (
    <div className="card stat stat-tile">
      <span className="stat-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <span className="muted">{tx(label)}</span>
        <b>{value}</b>
        {progress != null && (
          <div className="progress">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Present or late out of the recorded days (excused days don't count), or null with none. */
const UNITS: ProgressUnit[] = ["PAGES", "SURAHS", "JUZ", "AYAHS"];
const UNIT_LABEL: Record<ProgressUnit, string> = { PAGES: "الصفحات", SURAHS: "السور", JUZ: "الأجزاء", AYAHS: "الآيات" };
const UNIT_COLUMN: Record<ProgressUnit, string> = { PAGES: "صفحات الشهر", SURAHS: "سور الشهر", JUZ: "أجزاء الشهر", AYAHS: "آيات الشهر" };

// The chosen unit is remembered per device, like the appearance settings.
const UNIT_KEY = "dashboardUnit";
function readUnit(): ProgressUnit {
  try {
    const v = localStorage.getItem(UNIT_KEY) as ProgressUnit | null;
    return v && UNITS.includes(v) ? v : "PAGES";
  } catch {
    return "PAGES";
  }
}
function saveUnit(u: ProgressUnit): ProgressUnit {
  try { localStorage.setItem(UNIT_KEY, u); } catch { /* Private browsing may block storage. */ }
  return u;
}

function rate(rows: Attendance[], from: string, to: string): number | null {
  let yes = 0;
  let n = 0;
  for (const r of rows) {
    if (r.deleted_at || r.att_date < from || r.att_date > to || r.status === "EXCUSED") continue;
    n++;
    if (r.status === "PRESENT" || r.status === "LATE") yes++;
  }
  return n ? yes / n : null;
}

function pct(r: number | null): string {
  return r === null ? "—" : `${Math.round(r * 100)}%`;
}

function dayAgo(locale: Locale, date: string, today: string): string {
  const tx = (source: string, values?: readonly (string | number | null | undefined)[]) => staffText(locale, source, values);
  if (date === addDays(today, -1)) return tx("أمس");
  if (date === addDays(today, -2)) return tx("قبل يومين");
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SY" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
}
