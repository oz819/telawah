"use client";

import { staffText, type Locale } from "@/lib/i18n";
import { useI18n } from "@/components/LocaleProvider";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import StudentCard from "@/components/StudentCard";
import { useScope } from "@/components/FilterBar";
import LessonCard from "@/components/LessonCard";
import Talqeen from "@/components/sections/Talqeen";
import SendReports from "@/components/SendReports";
import Panel from "@/components/Panel";
import AbsenceAlerts from "@/components/AbsenceAlerts";
import ReadyForExam from "@/components/ReadyForExam";
import { matchesName } from "@/lib/arabic";
import { normalizePhone } from "@/lib/guardian";
import { usePersistentState } from "@/lib/usePersistentState";
import { store, newId, useStore } from "@/lib/offline/store";
import { latestOfTrack } from "@/lib/progress";
import { entryRange, type Mushaf, type QuranRange } from "@/lib/quran";
import { ATTENDANCE_LABEL, todayStr, type ArabicEnrollment, type AttendanceStatus, type Circle, type QuranEntry, type Student } from "@/lib/types";

const RECENT_KEY = "recentStudents";

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// The teacher's main screen (spec §5.1): call up whichever student is sitting in front of them.
export default function Students({
  openId,
  onOpen,
  onClose,
  onShowList,
}: {
  openId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onShowList: () => void;
}) {
  const { tx, locale } = useI18n();
  const s = useStore();
  const { mushaf, showToast, profile, tracks } = useApp();
  const [query, setQuery] = useState("");
  // Typing stays responsive on long lists: the filtered list re-renders at lower priority.
  const deferredQuery = useDeferredValue(query);
  // The section/halaqa filter is shared by every page and remembered (lib/filter.ts).
  const { inScope, scopedCircles } = useScope();
  const [showArchived, setShowArchived] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [talqeenOpen, setTalqeenOpen] = useState(false);
  const [rollCall, setRollCall] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = usePersistentState<"all" | "noAtt" | "noRec">("students.pending", "all");
  const listScroll = useRef(0);
  const scrollToTalqeen = useRef(false);

  useEffect(() => setRecent(readRecent()), []);

  // Back from a student card: return to the same place in the list.
  useEffect(() => {
    if (!openId && listScroll.current) window.scrollTo({ top: listScroll.current });
  }, [openId]);

  useEffect(() => {
    if (!openId && scrollToTalqeen.current) {
      scrollToTalqeen.current = false;
      document.getElementById("talqeen-session")?.scrollIntoView({ block: "start" });
    }
  }, [openId, talqeenOpen]);

  function open(id: string) {
    listScroll.current = window.scrollY;
    onOpen(id);
    const next = [id, ...recent.filter((r) => r !== id)].slice(0, 6);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
    window.scrollTo({ top: 0 });
  }

  if (openId) return <StudentCard studentId={openId} onClose={onClose} onTalqeen={() => { scrollToTalqeen.current = true; setTalqeenOpen(true); onShowList(); }} />;

  const today = todayStr();
  const attendedToday = (id: string) => {
    const a = s.get("attendance", `${id}|${today}`);
    return !!a && !a.deleted_at;
  };
  const quranBy = s.byStudent("quran_entries");
  const enrollBy = s.byStudent("student_arabic_enrollments");
  const books = s.all("arabic_books").filter((b) => b.active).sort((a, b) => a.title.localeCompare(b.title, "ar"));
  const unsynced = s.unsyncedStudents();
  const students = s
    .all("students")
    .filter((st) => (showArchived ? !st.active : st.active))
    .filter((st) => inScope(st.circle_id))
    .filter((st) => matchesName(st.name, deferredQuery))
    .filter((st) =>
      pending === "noAtt"
        ? !attendedToday(st.id)
        : pending === "noRec"
          ? !(quranBy.get(st.id) ?? []).some((e) => e.entry_date === today && !e.deleted_at)
          : true
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  const active = s.all("students").filter((st) => st.active && inScope(st.circle_id));
  const presentToday = active.filter((st) => {
    const a = s.get("attendance", `${st.id}|${today}`);
    return a && !a.deleted_at && (a.status === "PRESENT" || a.status === "LATE");
  }).length;
  const recordedToday = active.filter((st) => (quranBy.get(st.id) ?? []).some((e) => e.entry_date === today)).length;
  const recentStudents = recent.map((id) => s.get("students", id)).filter((st) => st && st.active);

  return (
    <section>
      <div className="grid">
        <StatTile icon="👥" label={tx("الطلاب")} value={active.length} />
        <StatTile icon="✅" label={tx("حاضرون اليوم")} value={presentToday} of={active.length} />
        <StatTile icon="📖" label={tx("سُجّل لهم اليوم")} value={recordedToday} of={active.length} />
      </div>

      <LessonCard circles={scopedCircles} />

      {tracks.has("TALQEEN") && <TalqeenCard open={talqeenOpen} setOpen={setTalqeenOpen} />}

      <Insights students={active} open={open} />

      {sending && <SendReports onClose={() => setSending(false)} />}

      {adding && (
        <Panel title={tx("➕ إضافة طالب")} onClose={() => setAdding(false)}>
          <AddStudent
            defaultCircleId={scopedCircles[0]?.id ?? ""}
            onCancel={() => setAdding(false)}
            onAdded={(id) => {
              setAdding(false);
              showToast(tx("تمت إضافة الطالب"));
              open(id);
            }}
          />
        </Panel>
      )}

      {rollCall && (
        <RollCall
          circles={scopedCircles}
          onClose={() => setRollCall(false)}
          onDone={(n) => showToast(tx("تم تحضير {0} طالب", [n]))}
        />
      )}

      <div className="card">
        <div className="title">
          <h3>{tx("👨‍🎓 الطلاب")}</h3>
          <div className="row-actions">
            <button className={`secondary${rollCall ? " on" : ""}`} aria-pressed={rollCall} onClick={() => setRollCall(true)}>
              {tx("📋 تحضير سريع")}</button>
            <button className={`secondary${sending ? " on" : ""}`} aria-pressed={sending} onClick={() => setSending(true)}>
              {tx("📤 إرسال التقارير")}</button>
            <button className={adding ? "on" : ""} aria-pressed={adding} onClick={() => setAdding(true)}>
              {tx("+ إضافة طالب")}</button>
          </div>
        </div>
        <div className="search-row" style={{ gridTemplateColumns: "1fr" }}>
          <input type="search" placeholder={tx("ابحث باسم الطالب...")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="recent">
          <span className="muted">{tx("عرض:")}</span>
          {(
            [
              ["all", tx("الكل")],
              ["noAtt", tx("لم يسجل حضورهم اليوم")],
              ["noRec", tx("لم يُسمِّعوا اليوم")],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={`chip ${pending === id ? "on" : ""}`} onClick={() => setPending(id)}>
              {tx(label)}
            </button>
          ))}
        </div>
        {profile.role === "ADMIN" && (
          <label className="inline">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />  {tx("عرض المؤرشفين")}</label>
        )}

        {!query && recentStudents.length > 0 && (
          <div className="recent">
            <span className="muted">{tx("فُتحوا مؤخرًا:")}</span>
            {recentStudents.map((st) => (
              <button key={st!.id} className="chip" onClick={() => open(st!.id)}>
                {st!.name}
              </button>
            ))}
          </div>
        )}

        {!s.status.initialSyncDone && !students.length ? (
          <p className="muted">{tx("جارٍ تنزيل البيانات لأول مرة... (يحتاج اتصالًا بالإنترنت)")}</p>
        ) : students.length ? (
          <ul className="student-list">
            {students.map((st) => {
              const hifz = latestOfTrack(quranBy.get(st.id), "HIFZ");
              const bookLine = arabicStatus(locale, enrollBy.get(st.id), (id) => s.get("arabic_books", id)?.title);
              const att = s.get("attendance", `${st.id}|${today}`);
              const status = att && !att.deleted_at ? (att.status as AttendanceStatus) : null;
              return (
                <li key={st.id} onClick={() => open(st.id)}>
                  <div>
                    <b>{st.name}</b>
                    {unsynced.has(st.id) && <span className="dot" title={tx("محفوظ على الجهاز، سيُحفظ في الحساب عند الاتصال")} />}
                    <div className="small muted">
                      {s.get("circles", st.circle_id)?.name ?? "—"}
                      {hifz && tx(" · حفظ: {0}", [mushaf.formatRange(entryRange(hifz), locale)])}
                      {bookLine && ` · ${bookLine}`}
                    </div>
                    {/* Quick way to set the book a student is studying, without opening the card. */}
                    <select
                      aria-label={tx("الكتاب الذي يدرسه")}
                      className="book-select"
                      style={{ marginTop: 6, padding: "6px 8px", fontSize: "0.9em" }}
                      value={(enrollBy.get(st.id) ?? []).find((e) => !e.deleted_at && !e.finished_on)?.book_id ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        setStudyingBook(st.id, e.target.value, enrollBy.get(st.id) ?? []);
                      }}
                    >
                      <option value="">{tx("— اختر الكتاب —")}</option>
                      {books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  {status && (
                    <span className={`badge ${status === "ABSENT" ? "redo" : status === "EXCUSED" ? "warn" : "excellent"}`}>
                      {tx(ATTENDANCE_LABEL[status])}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">{tx("لا يوجد طلاب مطابقون.")}</p>
        )}
      </div>
    </section>
  );
}

function AddStudent({
  defaultCircleId,
  onAdded,
  onCancel,
}: {
  defaultCircleId: string;
  onAdded: (id: string) => void;
  onCancel: () => void;
}) {
  const { tx } = useI18n();
  const s = useStore();
  const circles = s.all("circles").filter((c) => c.active);
  const books = s.all("arabic_books").filter((b) => b.active);
  const [name, setName] = useState("");
  // Starts on the circle the list is filtered to, if any.
  const [circleId, setCircleId] = useState(circles.some((c) => c.id === defaultCircleId) ? defaultCircleId : (circles[0]?.id ?? ""));
  const [bookId, setBookId] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  async function add() {
    if (!name.trim() || !circleId) return setError(tx("أدخل الاسم واختر الحلقة"));
    const guardianPhone = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !guardianPhone) return setError(tx("رقم ولي الأمر غير صحيح — اكتبه مثل 0912345678"));
    const id = newId();
    await store.save(
      "students",
      { id, name: name.trim(), circle_id: circleId, active: true, guardian_phone: guardianPhone },
      `إضافة طالب: ${name.trim()}`
    );
    if (bookId) {
      await store.save(
        "student_arabic_enrollments",
        { id: newId(), student_id: id, book_id: bookId, started_on: todayStr(), finished_on: null, deleted_at: null },
        "تسجيل في كتاب عربية"
      );
    }
    onAdded(id);
  }

  if (!circles.length) return <p className="notice">{tx("لا توجد حلقات بعد. يُنشئها المدير من شاشة الإدارة.")}</p>;

  return (
    <form
      className="formgrid compact"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      noValidate
    >
      <div>
        <label>{tx("اسم الطالب")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label>{tx("الحلقة")}</label>
        <select value={circleId} onChange={(e) => setCircleId(e.target.value)}>
          {circles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label>{tx("كتاب العربية (اختياري)")}</label>
        <select value={bookId} onChange={(e) => setBookId(e.target.value)}>
          <option value="">{tx("بدون")}</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label>{tx("رقم واتساب ولي الأمر (اختياري)")}</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" dir="ltr" inputMode="tel" placeholder="0912345678" />
      </div>
      <div className="row-actions" style={{ alignSelf: "end" }}>
        <button type="submit">{tx("حفظ الطالب")}</button>
        <button type="button" className="secondary" onClick={onCancel}>
          {tx("إلغاء")}</button>
      </div>
      {error && <p className="error-text">{tx(error)}</p>}
    </form>
  );
}

function StatTile({ icon, label, value, of }: { icon: string; label: string; value: number; of?: number }) {
  const { tx, number } = useI18n();
  const pct = of ? Math.round((value / of) * 100) : null;
  return (
    <div className="card stat stat-tile">
      <span className="stat-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <span className="muted">{tx(label)}</span>
        <b>
          {number(value)}
          {of !== undefined && <small> / {number(of)}</small>}
        </b>
        {pct !== null && (
          <div className="progress">
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
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
// جلسة التلقين (من آية إلى آية) for a whole halaqa, folded until the teacher opens it.
function TalqeenCard({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const { tx } = useI18n();
  const { tracks } = useApp();
  return (
    <div className="card talqeen-fold" id="talqeen-session">
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h3>{tx("🎙️ جلسة")} {tracks.label("TALQEEN")}</h3>
        <span className="muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && <Talqeen embedded />}
    </div>
  );
}

function Insights({ students, open }: { students: Student[]; open: (id: string) => void }) {
  const { tx } = useI18n();
  const s = useStore();
  const { mushaf } = useApp();
  const quranBy = s.byStudent("quran_entries");
  const month = todayStr().slice(0, 7);

  const stars = useMemo(
    () =>
      students
        .map((st) => ({ st, ayahs: monthHifz(mushaf, quranBy.get(st.id), month) }))
        .filter((x) => x.ayahs > 0)
        .sort((a, b) => b.ayahs - a.ayahs)
        .slice(0, 5),
    [students, quranBy, mushaf, month]
  );
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="insights">
      <AbsenceAlerts students={students} open={open} />
      <ReadyForExam students={students} open={open} />
      {stars.length > 0 && (
        <div className="card insight star-card">
          <h3>{tx("🏆 نجوم الحفظ هذا الشهر")}</h3>
          <p className="muted">{tx("بعدد الآيات المحفوظة")}</p>
          <ul className="insight-list">
            {stars.map(({ st, ayahs }, i) => (
              <li key={st.id} onClick={() => open(st.id)}>
                <span>
                  <span className="medal">{medals[i] ?? `${i + 1}.`}</span> {st.name}
                </span>
                <span className="badge excellent">{ayahs}  {tx("آية")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function monthHifz(mushaf: Mushaf, entries: QuranEntry[] | undefined, month: string): number {
  const ranges = (entries ?? [])
    .filter((e) => e.track === "HIFZ" && e.entry_date.startsWith(month))
    .map(entryRange)
    .filter((r): r is QuranRange => !!r);
  return ranges.length ? mushaf.coverage(ranges) : 0;
}

// Sets the book a student is studying now. Reuses the existing enrollment row for that book
// (reopening it if it had been marked finished), so the same book is never listed twice.
async function setStudyingBook(studentId: string, bookId: string, enrollments: ArabicEnrollment[]) {
  if (!bookId) return;
  const existing = enrollments.find((e) => e.book_id === bookId);
  await store.save(
    "student_arabic_enrollments",
    {
      id: existing?.id ?? newId(),
      student_id: studentId,
      book_id: bookId,
      started_on: existing?.started_on ?? todayStr(),
      finished_on: null,
      deleted_at: null,
    },
    "تحديد الكتاب الذي يدرسه"
  );
}

// e.g. "📖 الرشيدي" while studying it, or "✅ أنهى الرشيدي" once every book is finished.
function arabicStatus(locale: Locale, enrollments: ArabicEnrollment[] | undefined, title: (bookId: string) => string | undefined): string {
  const tx = (source: string, values?: readonly (string | number | null | undefined)[]) => staffText(locale, source, values);
  const mine = (enrollments ?? []).filter((e) => !e.deleted_at);
  const studying = mine.filter((e) => !e.finished_on).map((e) => title(e.book_id)).filter(Boolean);
  if (studying.length) return `📖 ${studying.join("، ")}`;
  const last = mine.filter((e) => e.finished_on).sort((a, b) => b.finished_on!.localeCompare(a.finished_on!))[0];
  const t = last && title(last.book_id);
  return t ? tx("✅ أنهى {0}", [t]) : "";
}
