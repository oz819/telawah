"use client";

import { useI18n } from "@/components/LocaleProvider";

import { useMemo, useState } from "react";
import { useApp } from "@/components/AppContext";
import { useScope } from "@/components/FilterBar";
import LessonCard from "@/components/LessonCard";
import Panel from "@/components/Panel";
import ScreenHead from "@/components/ScreenHead";
import FilterBar from "@/components/FilterBar";
import AbsenceAlerts from "@/components/AbsenceAlerts";
import ReadyForExam from "@/components/ReadyForExam";
import { usePersistentState } from "@/lib/usePersistentState";
import { store, useStore } from "@/lib/offline/store";
import { entryRange, type Mushaf, type QuranRange } from "@/lib/quran";
import { ATTENDANCE_LABEL, todayStr, type AttendanceStatus, type Circle, type QuranEntry, type Student } from "@/lib/types";

// التسميع اليومي: the teacher's day in one screen — the halaqa's roll call (the screen's one main
// button), today's lesson, and who has / hasn't been heard today. Tapping a student opens their card.
export default function Daily({ onOpen }: { onOpen: (id: string) => void }) {
  const { tx } = useI18n();
  const s = useStore();
  const { showToast } = useApp();
  const { inScope, scopedCircles } = useScope();
  const [show, setShow] = usePersistentState<"all" | "noAtt" | "noRec">("daily.show", "all");
  const [rollCall, setRollCall] = useState(false);
  const today = todayStr();
  const quranBy = s.byStudent("quran_entries");

  const active = s
    .all("students")
    .filter((st) => st.active && inScope(st.circle_id))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const statusOf = (id: string) => {
    const a = s.get("attendance", `${id}|${today}`);
    return a && !a.deleted_at ? (a.status as AttendanceStatus) : null;
  };
  const heard = (id: string) => (quranBy.get(id) ?? []).some((e) => e.entry_date === today && !e.deleted_at);
  const present = active.filter((st) => statusOf(st.id) === "PRESENT" || statusOf(st.id) === "LATE").length;
  const recorded = active.filter((st) => heard(st.id)).length;
  const list = active.filter((st) => (show === "noAtt" ? !statusOf(st.id) : show === "noRec" ? !heard(st.id) : true));

  return (
    <section>
      <ScreenHead
        title={tx("التسميع اليومي")}
        text={tx("سجّل حضور حلقتك ودرس اليوم، وتابع من سمّع اليوم ومن لم يسمّع.")}
        action={
          active.length > 0 && (
            <button className={rollCall ? "on" : ""} aria-pressed={rollCall} onClick={() => setRollCall(true)}>
              {tx("تحضير الحلقة")}
            </button>
          )
        }
      />

      <FilterBar />

      {rollCall && <RollCall circles={scopedCircles} onClose={() => setRollCall(false)} onDone={(n) => showToast(tx("تم تحضير {0} طالب", [n]))} />}

      <LessonCard circles={scopedCircles} />

      <div className="card">
        <div className="title">
          <h3>{tx("طلاب اليوم")}</h3>
          <span className="muted small">
            {tx("حضر")} {present}  {tx("· سمّع")} {recorded}  {tx("من")} {active.length}
          </span>
        </div>
        <div className="recent">
          {(
            [
              ["all", tx("الكل")],
              ["noAtt", tx("لم يسجل حضورهم")],
              ["noRec", tx("لم يسمّعوا")],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`chip ${show === id ? "on" : ""}`} onClick={() => setShow(id)}>
              {tx(label)}
            </button>
          ))}
        </div>
        {list.length ? (
          <ul className="student-list">
            {list.map((st) => {
              const status = statusOf(st.id);
              return (
                <li key={st.id} onClick={() => onOpen(st.id)}>
                  <div>
                    <b>{st.name}</b>
                    <div className="small muted">{s.get("circles", st.circle_id)?.name ?? "—"}</div>
                  </div>
                  <span className="day-badges">
                    {status && (
                      <span className={`badge ${status === "ABSENT" ? "redo" : status === "EXCUSED" ? "warn" : "excellent"}`}>{tx(ATTENDANCE_LABEL[status])}</span>
                    )}
                    {heard(st.id) ? <span className="badge excellent">{tx("✓ سمّع")}</span> : <span className="badge">{tx("لم يسمّع")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{active.length ? tx("لا يوجد طلاب في هذا العرض.") : tx("لا يوجد طلاب بعد. أضفهم من صفحة «الطلاب».")}</p>
        )}
      </div>

      <Insights students={active} open={onOpen} />
    </section>
  );
}

const ROLL_STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "EXCUSED", "ABSENT"];

// Mark today's attendance for a whole circle on one screen instead of opening each student card.
// Offers the halaqat the shared filter covers.
function RollCall({ circles, onClose, onDone }: { circles: Circle[]; onClose: () => void; onDone: (n: number) => void }) {
  const { tx } = useI18n();
  const s = useStore();
  const today = todayStr();
  const [savedCid, setCid] = useState(circles[0]?.id ?? "");
  const cid = circles.some((c) => c.id === savedCid) ? savedCid : (circles[0]?.id ?? "");
  const roster = s
    .all("students")
    .filter((st) => st.active && st.circle_id === cid)
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const statusOf = (id: string) => {
    const a = s.get("attendance", `${id}|${today}`);
    return a && !a.deleted_at ? (a.status as AttendanceStatus) : null;
  };
  const unmarked = roster.filter((st) => !statusOf(st.id));

  async function allPresent() {
    for (const st of unmarked) await store.setAttendance(st.id, today, "PRESENT");
    onDone(unmarked.length);
  }

  return (
    <Panel title={tx("📋 تحضير اليوم")} onClose={onClose} className="rollcall">
      <div className="formgrid compact">
        <div>
          <label>{tx("الحلقة")}</label>
          <select value={cid} onChange={(e) => setCid(e.target.value)}>
            {circles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ alignSelf: "end" }}>
          <button onClick={allPresent} disabled={!unmarked.length}>
            {tx("✅ الباقون حاضرون (")}{unmarked.length})
          </button>
        </div>
      </div>
      {roster.length ? (
        <ul className="roster">
          {roster.map((st) => {
            const cur = statusOf(st.id);
            return (
              <li key={st.id}>
                <b>{st.name}</b>
                <div className="att-row" style={{ margin: 0 }}>
                  {ROLL_STATUSES.map((stt) => (
                    <button
                      key={stt}
                      className={`chip ${cur === stt ? `on ${stt.toLowerCase()}` : ""}`}
                      onClick={() => store.setAttendance(st.id, today, cur === stt ? null : stt)}
                    >
                      {tx(ATTENDANCE_LABEL[stt])}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{tx("لا يوجد طلاب في هذه الحلقة.")}</p>
      )}
    </Panel>
  );
}

// Two on-device insights from the locally synced window: students absent on their last few
// recorded days (تنبيه الغياب, with a message to the family), and this month's top memorizers.
function Insights({ students, open }: { students: Student[]; open: (id: string) => void }) {
  const { tx } = useI18n();
  const s = useStore();
  const { mushaf, tracks } = useApp();
  const quranBy = s.byStudent("quran_entries");
  const month = todayStr().slice(0, 7);

  const stars = useMemo(
    () =>
      students
        .map((st) => ({ st, ...monthHifz(mushaf, quranBy.get(st.id), month) }))
        .filter((x) => x.ayahs > 0)
        .sort((a, b) => b.ayahs - a.ayahs)
        .slice(0, 5),
    [students, quranBy, mushaf, month]
  );
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="insights">
      <AbsenceAlerts students={students} open={open} />
      {tracks.has("EXAMS") && <ReadyForExam students={students} open={open} />}
      {stars.length > 0 && (
        <div className="card insight star-card">
          <h3>{tx("🏆 نجوم الحفظ هذا الشهر")}</h3>
          <p className="muted">{tx("بما حفظوه هذا الشهر")}</p>
          <ul className="insight-list">
            {stars.map(({ st, text }, i) => (
              <li key={st.id} onClick={() => open(st.id)}>
                <span>
                  <span className="medal">{medals[i] ?? `${i + 1}.`}</span> {st.name}
                </span>
                <span className="badge excellent">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function monthHifz(mushaf: Mushaf, entries: QuranEntry[] | undefined, month: string): { ayahs: number; text: string } {
  const ranges = (entries ?? [])
    .filter((e) => e.track === "HIFZ" && e.entry_date.startsWith(month))
    .map(entryRange)
    .filter((r): r is QuranRange => !!r);
  // Ranked by ayahs, shown in surahs (ملاحظة 7).
  return ranges.length ? { ayahs: mushaf.coverage(ranges), text: mushaf.describeSurahs(ranges) } : { ayahs: 0, text: "" };
}

