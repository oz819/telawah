"use client";

import { useI18n } from "@/components/LocaleProvider";

import { useState } from "react";
import { useApp } from "@/components/AppContext";
import { confirmDialog } from "@/components/ConfirmDialog";
import Panel from "@/components/Panel";
import { adminSoftDelete } from "@/lib/adminDelete";
import QuranTrackSection from "@/components/card/QuranTrackSection";
import ArabicSection from "@/components/card/ArabicSection";
import TarbiyaSection from "@/components/card/TarbiyaSection";
import GuardianBox from "@/components/card/GuardianBox";
import MemorizationMap, { ReviewSuggestions } from "@/components/card/MemorizationMap";
import ExamsSection from "@/components/card/ExamsSection";
import { takeCardIntent } from "@/lib/cardIntent";
import SlidingIndicator from "@/components/SlidingIndicator";
import { store, useStore } from "@/lib/offline/store";
import { byNewest, studentProgress } from "@/lib/progress";
import { normalizePhone } from "@/lib/guardian";
import { entryRange, type QuranRange } from "@/lib/quran";
import { ATTENDANCE_LABEL, QUALITIES, todayStr, type AttendanceStatus, type QuranEntry } from "@/lib/types";

type Section = "HIFZ" | "TILAWA" | "MURAJAA" | "TALQEEN" | "ARABIC" | "TARBIYA" | "MAP" | "EXAMS";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "HIFZ", label: "الحفظ" },
  { id: "TILAWA", label: "التلاوة" },
  { id: "MURAJAA", label: "المراجعة" },
  { id: "TALQEEN", label: "التلقين" },
  { id: "ARABIC", label: "العربية" },
  { id: "TARBIYA", label: "التربية" },
  { id: "MAP", label: "🗺️ الخريطة" },
  { id: "EXAMS", label: "📝 الاختبارات" },
];

const STATUSES: AttendanceStatus[] = ["PRESENT", "LATE", "EXCUSED", "ABSENT"];

export default function StudentCard({ studentId, onClose, onTalqeen }: { studentId: string; onClose: () => void; onTalqeen: () => void }) {
  const { tx, date: formatDate, locale } = useI18n();
  const s = useStore();
  const { mushaf, profile, showToast, tracks } = useApp();
  // Opened from «جاهزون للاختبار»: straight to the exams tab on that juz'.
  const [intent] = useState(() => takeCardIntent(studentId));
  const [section, setSection] = useState<Section>(intent?.tab ?? "HIFZ");
  const [editing, setEditing] = useState(false);
  // ولي الأمر is sent once, not every day: a «👪 ولي الأمر» button beside «تعديل الطالب» opens it, with a dot until the family opens their page.
  const [showGuardian, setShowGuardian] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // A suggested review chosen from the map: opens the review form on that range.
  const [prefill, setPrefill] = useState<{ range: QuranRange; n: number } | null>(null);

  const student = s.get("students", studentId);
  if (!student) {
    return (
      <div className="card">
        <p className="muted">{tx("الطالب غير موجود على هذا الجهاز.")}</p>
        <button className="secondary" onClick={onClose}>
          {tx("رجوع")}</button>
      </div>
    );
  }

  const today = todayStr();
  const guardianLink = s.get("guardian_links", studentId);
  const guardianUnopened = !!guardianLink && !guardianLink.last_opened_at;
  // التلقين is optional per centre (الإدارة ← قسم التلقين), and named the way the centre calls it.
  const talqeenOn = tracks.has("TALQEEN");
  const sections = SECTIONS.filter((sec) => sec.id !== "TALQEEN" || talqeenOn).map((sec) =>
    sec.id === "TALQEEN" ? { ...sec, label: tracks.label("TALQEEN") } : { ...sec, label: tx(sec.label) }
  );
  const quran = s.byStudent("quran_entries").get(studentId) ?? [];
  const arabic = s.byStudent("arabic_entries").get(studentId) ?? [];
  const edu = s.byStudent("edu_notes").get(studentId) ?? [];
  const enrollments = s.byStudent("student_arabic_enrollments").get(studentId) ?? [];
  const att = s.get("attendance", `${studentId}|${today}`);
  const books = s.lookup("arabic_books");
  const lastFinished = enrollments
    .filter((e) => !e.deleted_at && e.finished_on)
    .sort((a, b) => b.finished_on!.localeCompare(a.finished_on!))
    .map((e) => books.get(e.book_id)?.title)[0];
  const p = studentProgress({ mushaf, quran, arabic, enrollments, books, edu, attendanceToday: att });
  const unsynced = s.unsyncedStudents().has(studentId);
  const circle = s.get("circles", student.circle_id);
  const moves = s
    .all("student_transfers")
    .filter((t) => t.student_id === studentId && !t.deleted_at)
    .sort((a, b) => b.transfer_date.localeCompare(a.transfer_date));
  const status = att && !att.deleted_at ? (att.status as AttendanceStatus) : null;

  function review(range: QuranRange) {
    setPrefill({ range, n: (prefill?.n ?? 0) + 1 });
    setSection("MURAJAA");
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      await store.fetchStudentHistory(studentId);
      showToast(tx("تم تحميل السجل الكامل"));
    } catch {
      showToast(tx("تعذّر التحميل — تحتاج اتصالًا بالإنترنت"));
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <section>
      <div className="card student-head">
        <div className="title">
          <div>
            <button className="link" onClick={onClose}>
              {tx("→ كل الطلاب")}</button>
            <h2 style={{ margin: "4px 0" }}>
              {student.name} {!student.active && <span className="badge redo">{tx("مؤرشف")}</span>}
            </h2>
            <span className="muted">{circle?.name ?? "—"}</span>
            {moves.length > 0 && (
              <details className="moves small">
                <summary>{tx("سجل الحلقات (")}{moves.length})</summary>
                <ul>
                  {moves.map((t) => (
                    <li key={t.id}>
                      {formatDate(t.transfer_date ?? "")}{tx(": من «")}{s.get("circles", t.from_circle_id ?? "")?.name ?? "—"}{tx("» إلى «")}{s.get("circles", t.to_circle_id ?? "")?.name ?? "—"}»
                    </li>
                  ))}
                </ul>
                <span className="muted">{tx("سجلاته قبل كل نقل تبقى محسوبة على حلقته القديمة.")}</span>
              </details>
            )}
            {unsynced && <span className="badge warn" style={{ marginInlineStart: 8 }}>{tx("لم يُحفظ في الحساب بعد")}</span>}
          </div>
          <div className="head-actions">
            <button
              type="button"
              className={`secondary guardian-btn${showGuardian ? " on" : ""}`}
              aria-expanded={showGuardian}
              onClick={() => setShowGuardian((v) => !v)}
              title={tx("ولي الأمر ورابط المتابعة")}
            >
              {tx("👪 ولي الأمر")}
              {guardianUnopened && <span className="dot" title={tx("لم يفتح ولي الأمر صفحة المتابعة بعد")} />}
            </button>
            <button className={`secondary${editing ? " on" : ""}`} aria-pressed={editing} onClick={() => setEditing(true)}>
              {tx("✏️ تعديل الطالب")}</button>
          </div>
        </div>

        {editing && (
          <Panel title={tx("✏️ تعديل بيانات الطالب")} onClose={() => setEditing(false)} className="panel-inset">
            <EditStudent studentId={studentId} isAdmin={profile.role === "ADMIN"} onDone={() => setEditing(false)} onDeleted={onClose} />
          </Panel>
        )}

        <div className="att-row">
          <span className="muted">{tx("حضور اليوم:")}</span>
          {STATUSES.map((st) => (
            <button
              key={st}
              className={status === st ? `chip on ${st.toLowerCase()}` : "chip"}
              onClick={() => store.setAttendance(studentId, today, status === st ? null : st)}
            >
              {tx(ATTENDANCE_LABEL[st])}
            </button>
          ))}
        </div>

        <div className="positions">
          <Pos label={tx("الحفظ")} value={p.hifz ? mushaf.formatRange(p.hifz.range, locale) : null} extra={p.hifz?.percent != null ? tx("{0}% محفوظ", [p.hifz.percent]) : undefined} date={p.hifz?.entry.entry_date} />
          <Pos label={tx("التلاوة")} value={p.tilawa ? mushaf.formatRange(p.tilawa.range, locale) : null} extra={p.tilawa?.percent != null ? `${p.tilawa.percent}%` : undefined} date={p.tilawa?.entry.entry_date} />
          <Pos label={tx("المراجعة")} value={p.murajaa ? mushaf.formatRange(p.murajaa.range, locale) : null} date={p.murajaa?.entry.entry_date} />
          {talqeenOn && <Pos label={tracks.label("TALQEEN")} value={p.talqeen ? mushaf.formatRange(p.talqeen.range, locale) : null} date={p.talqeen?.entry.entry_date} />}
          <Pos
            label={tx("العربية")}
            value={p.arabic ? tx("{0} — ص {1}", [p.arabic.book.title, p.arabic.page]) : lastFinished ? tx("✅ أنهى {0}", [lastFinished]) : null}
            extra={p.arabic ? `${p.arabic.percent}%` : undefined}
          />
          <Pos label={tx("آخر ملاحظة تربوية")} value={p.lastTarbiya ?? null} />
        </div>

        {showGuardian && <GuardianBox studentId={studentId} onEdit={() => setEditing(true)} />}
      </div>

      <div className="tabs sliding">
        <SlidingIndicator active={section} />
        {sections.map((sec) => (
          <button
            key={sec.id}
            className={section === sec.id ? "active" : ""}
            onClick={() => {
              setPrefill(null);
              setSection(sec.id);
            }}
          >
            {sec.label}
          </button>
        ))}
      </div>

      <div className="card">
        {section === "MURAJAA" && !prefill && (
          <details className="review-box">
            <summary>{tx("🔁 مراجعة اليوم المقترحة")}</summary>
            <ReviewSuggestions entries={quran} onReview={review} />
          </details>
        )}
        {(section === "HIFZ" || section === "TILAWA" || section === "MURAJAA") && (
          <QuranTrackSection
            key={`${studentId}-${section}-${section === "MURAJAA" ? (prefill?.n ?? 0) : 0}`}
            studentId={studentId}
            track={section}
            entries={quran}
            prefill={section === "MURAJAA" ? prefill?.range : null}
          />
        )}
        {section === "MAP" && <MemorizationMap studentId={studentId} entries={quran} onReview={review} />}
        {section === "EXAMS" && (
          <ExamsSection key={studentId} studentId={studentId} exams={s.byStudent("exams").get(studentId) ?? []} initialJuz={intent?.juz} />
        )}
        {section === "TALQEEN" && talqeenOn && <TalqeenList entries={quran.filter((e) => e.track === "TALQEEN")} onCreate={onTalqeen} />}
        {section === "ARABIC" && <ArabicSection key={studentId} studentId={studentId} enrollments={enrollments} entries={arabic} />}
        {section === "TARBIYA" && <TarbiyaSection key={studentId} studentId={studentId} notes={edu} />}
        <div style={{ marginTop: 12 }}>
          <button className="link" onClick={loadHistory} disabled={loadingHistory}>
            {loadingHistory ? tx("جارٍ التحميل...") : tx("تحميل السجل الأقدم من الخادم")}
          </button>
        </div>
      </div>
    </section>
  );
}

function Pos({ label, value, extra, date }: { label: string; value: string | null; extra?: string; date?: string }) {
  const { date: formatDate } = useI18n();
  return (
    <div className="pos-tile">
      <span className="muted">{label}</span>
      <b>{value ?? "—"}</b>
      {(extra || date) && (
        <span className="small muted">
          {extra}
          {extra && date ? " · " : ""}
          {date ? formatDate(date) : ""}
        </span>
      )}
    </div>
  );
}

function TalqeenList({ entries, onCreate }: { entries: QuranEntry[]; onCreate: () => void }) {
  const { tx, locale, date: formatDate } = useI18n();
  const { mushaf, showToast, tracks } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quality, setQuality] = useState("");
  const [notes, setNotes] = useState("");
  const list = [...entries].sort(byNewest((e) => e.entry_date));

  if (!list.length) return (
      <div>
        <p className="muted">{tx("لم تُسجَّل جلسات {0} لهذا الطالب بعد. سجّل جلسة للحلقة وحدّد الطلاب المشاركين ليظهر سجلّهم هنا.", [tracks.label("TALQEEN")])}</p>
        <button type="button" onClick={onCreate}>{tx("تسجيل جلسة {0}", [tracks.label("TALQEEN")])}</button>
      </div>
    );

  return (
    <ul className="history">
      {list.map((e) => (
        <li key={e.id} className={editingId === e.id ? "editing" : ""}>
          <div style={{ flex: 1 }}>
            <b>{mushaf.formatRange(entryRange(e), locale)}</b>
            <span className="muted"> · {formatDate(e.entry_date ?? "")}</span>
            {e.quality && <span className="badge">{tx(e.quality)}</span>}
            {e.notes && <div className="small muted">{e.notes}</div>}
            {editingId === e.id && (
              <div className="formgrid compact" style={{ marginTop: 8 }}>
                <select value={quality} onChange={(ev) => setQuality(ev.target.value)}>
                  <option value="">—</option>
                  {QUALITIES.map((q) => (
                    <option key={q} value={q}>{tx(q)}</option>
                  ))}
                </select>
                <input value={notes} placeholder={tx("ملاحظة")} onChange={(ev) => setNotes(ev.target.value)} />
                <button
                  onClick={async () => {
                    await store.save("quran_entries", { ...e, quality: quality || null, notes: notes.trim() || null }, "تعديل تلقين");
                    setEditingId(null);
                    showToast(tx("تم التعديل"));
                  }}
                >
                  {tx("حفظ")}</button>
              </div>
            )}
          </div>
          <div className="row-actions">
            <button
              className="link"
              onClick={() => {
                setEditingId(e.id);
                setQuality(e.quality ?? "");
                setNotes(e.notes ?? "");
              }}
            >
              {tx("تعديل")}</button>
            <button
              className="link danger-link"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: tx("حذف التلقين «{0}»؟", [store.get("students", e.student_id)?.name ?? ""]),
                  body: `${e.entry_date} · ${mushaf.formatRange(entryRange(e), locale)}\n` + tx("ينتقل إلى سجل المحذوفات، ويستطيع المدير استرجاعه من هناك."),
                  ok: tx("حذف"),
                  danger: true,
                });
                if (ok) await store.softDelete("quran_entries", e.id, "حذف تلقين");
              }}
            >
              {tx("حذف")}</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EditStudent({
  studentId,
  isAdmin,
  onDone,
  onDeleted,
}: {
  studentId: string;
  isAdmin: boolean;
  onDone: () => void;
  onDeleted: () => void;
}) {
  const { tx } = useI18n();
  const s = useStore();
  const { supabase, showToast } = useApp();
  const student = s.get("students", studentId)!;
  const [name, setName] = useState(student.name);
  const [circleId, setCircleId] = useState(student.circle_id);
  const [guardianName, setGuardianName] = useState(student.guardian_name ?? "");
  const [phone, setPhone] = useState(student.guardian_phone ?? "");
  const [error, setError] = useState("");
  const circles = s.all("circles").filter((c) => c.active || c.id === student.circle_id);

  async function save() {
    if (!name.trim()) return;
    const guardianPhone = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !guardianPhone) return setError(tx("رقم ولي الأمر غير صحيح — اكتبه مثل 0912345678 أو ‎+963912345678"));
    await store.save(
      "students",
      { ...student, name: name.trim(), circle_id: circleId, guardian_name: guardianName.trim() || null, guardian_phone: guardianPhone },
      "تعديل بيانات طالب"
    );
    showToast(tx("تم حفظ بيانات الطالب"));
    onDone();
  }

  async function toggleArchive() {
    if (!confirm(student.active ? tx("أرشفة هذا الطالب؟") : tx("إلغاء أرشفة الطالب؟"))) return;
    await store.save("students", { ...student, active: !student.active }, student.active ? "أرشفة طالب" : "إلغاء أرشفة طالب");
    onDone();
  }

  async function remove() {
    const ok = await confirmDialog({
      title: tx("حذف الطالب «{0}»؟", [student.name]),
      body: tx("ينتقل إلى سجل المحذوفات ويختفي من كل القوائم والتقارير. تبقى سجلاته كاملة، ويمكن استرجاعه من سجل المحذوفات."),
      ok: tx("حذف"),
      danger: true,
    });
    if (!ok) return;
    const err = await adminSoftDelete(supabase, "student", student.id);
    if (err) return showToast(err);
    showToast(tx("تم حذف «{0}» — تجده في سجل المحذوفات", [student.name]));
    onDeleted();
  }

  return (
    <div className="formgrid compact" style={{ margin: "10px 0" }}>
      <div>
        <label>{tx("الاسم")}</label>
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
        {circleId !== student.circle_id && (
          <p className="small muted">{tx("نقل من اليوم: سجلاته السابقة تبقى محسوبة على حلقته الحالية في الترتيب والتقارير.")}</p>
        )}
      </div>
      <div>
        <label>{tx("اسم ولي الأمر")}</label>
        <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder={tx("اختياري")} />
      </div>
      <div>
        <label>{tx("رقم واتساب ولي الأمر")}</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" dir="ltr" inputMode="tel" placeholder="0912345678" />
      </div>
      <div className="row-actions" style={{ alignSelf: "end" }}>
        <button onClick={save}>{tx("حفظ")}</button>
        <button className="secondary" onClick={onDone}>
          {tx("إلغاء التعديل")}</button>
        {isAdmin && (
          <button className="secondary" onClick={toggleArchive}>
            {student.active ? tx("أرشفة") : tx("إلغاء الأرشفة")}
          </button>
        )}
        {isAdmin && (
          <button className="danger" onClick={remove}>
            {tx("حذف")}</button>
        )}
      </div>
      {error && <p className="error-text">{tx(error)}</p>}
    </div>
  );
}
