"use client";

import { useI18n } from "@/components/LocaleProvider";

import { useEffect, useState } from "react";
import { useApp } from "@/components/AppContext";
import { rankingSettings, useRankingSettings } from "@/lib/rankingSettings";
import { DEFAULT_ABSENCE_MESSAGE, absenceMessage } from "@/lib/familyMessages";
import type { RankingSettings } from "@/lib/ranking";

// Admin settings that aren't about the ranking: تنبيه الغياب (after how many absences, and the
// message to the family). Stored on the same settings row.
export default function CenterSettings() {
  const { tx } = useI18n();
  const { supabase, showToast } = useApp();
  const settings = useRankingSettings(supabase);
  const [draft, setDraft] = useState<RankingSettings | null>(null);
  const [error, setError] = useState("");
  const v = draft ?? settings;
  const example = absenceMessage(v.absenceMessage ?? "", { name: "أحمد" } as never, v.absenceThreshold);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(v.absenceThreshold);
    if (!Number.isInteger(n) || n < 1 || n > 30) return setError(tx("عدد أيام الغياب يجب أن يكون بين 1 و30"));
    const msg = v.absenceMessage?.trim() || null;
    const err = await rankingSettings.save(supabase, { ...v, absenceThreshold: n, absenceMessage: msg === DEFAULT_ABSENCE_MESSAGE ? null : msg });
    if (err) return setError(err);
    setError("");
    setDraft(null);
    showToast(tx("تم حفظ الإعدادات"));
  }

  return (
    <form className="card" onSubmit={save} noValidate>
      <h3>{tx("🔔 تنبيه الغياب")}</h3>
      <div className="formgrid compact">
        <div>
          <label>{tx("ينبّه بعد غياب متتالٍ لمدة (أيام)")}</label>
          <input
            type="number"
            min={1}
            max={30}
            inputMode="numeric"
            value={Number.isFinite(v.absenceThreshold) ? v.absenceThreshold : ""}
            onChange={(e) => setDraft({ ...v, absenceThreshold: e.target.value === "" ? NaN : Number(e.target.value) })}
          />
        </div>
        <div className="wide">
          <label>{tx("رسالة الأهل")}</label>
          <textarea
            rows={5}
            value={v.absenceMessage ?? DEFAULT_ABSENCE_MESSAGE}
            onChange={(e) => setDraft({ ...v, absenceMessage: e.target.value })}
          />
          <p className="small muted">
            {tx("اكتب")} {tx("{الاسم}")}  {tx("مكان اسم الطالب و")}{tx("{العدد}")}  {tx("مكان عدد الأيام.")} {tx("{يكون}")}  {tx("و")}{tx("{ه}")}  {tx("تتغيّر تلقائيًا للطالبات (تكون، ـها).")}</p>
        </div>
      </div>
      <details>
        <summary className="small">{tx("مثال على الرسالة")}</summary>
        <pre className="msg-preview">{example}</pre>
      </details>
      <div className="row-actions" style={{ marginTop: 10 }}>
        <button type="submit" disabled={!draft}>
          {tx("حفظ")}</button>
        {draft && (
          <button type="button" className="secondary" onClick={() => setDraft(null)}>
            {tx("تراجع")}</button>
        )}
        <button type="button" className="link" onClick={() => setDraft({ ...v, absenceMessage: null })}>
          {tx("الرسالة الافتراضية")}</button>
      </div>
      {error && <p className="error-text">{tx(error)}</p>}
    </form>
  );
}

// لوحة الشرف العامة: off by default. When on, /honor shows the week's top students (first name and
// the family name's initial) and new juz' certificates, for the parents' group or the centre's page.
export function HonorSettings() {
  const { tx } = useI18n();
  const { supabase, showToast, center } = useApp();
  const settings = useRankingSettings(supabase);
  const [error, setError] = useState("");
  // Shown at once while saving; back to the saved value if it fails.
  const [pending, setPending] = useState<boolean | null>(null);
  const on = pending ?? settings.honorEnabled;
  const link = typeof location === "undefined" ? "" : `${location.origin}/${center.slug}/honor`;

  async function toggle(on: boolean) {
    setPending(on);
    const err = await rankingSettings.save(supabase, { ...settings, honorEnabled: on });
    setPending(null);
    setError(err);
    if (!err) showToast(on ? tx("لوحة الشرف ظاهرة للجميع الآن") : tx("تم إخفاء لوحة الشرف"));
  }

  return (
    <div className="card honor-settings">
      <h3>{tx("🏅 لوحة الشرف العامة")}</h3>
      <p className="small muted">
        {tx("صفحة عامة بلا تسجيل دخول فيها متفوقو الأسبوع في كل قسم والشهادات الجديدة. تظهر الأسماء مختصرة (الاسم الأول وأول حرف من الكنية) حفاظًا على الخصوصية.")}</p>
      <label className="switch-row">
        <input type="checkbox" checked={on} disabled={pending !== null} onChange={(e) => toggle(e.target.checked)} />
        {on ? tx("ظاهرة للجميع") : tx("مخفية")}
      </label>
      {on && (
        <p className="small">
          {tx("الرابط:")} <span dir="ltr">{link}</span>{" "}
          <button type="button" className="link" onClick={() => navigator.clipboard?.writeText(link).then(() => showToast(tx("تم نسخ الرابط")), () => {})}>
            {tx("نسخ")}</button>{" "}
          <a href={`/${center.slug}/honor`} target="_blank" rel="noreferrer">
            {tx("فتح")}</a>
        </p>
      )}
      {error && <p className="error-text">{tx(error)}</p>}
    </div>
  );
}

// صفحة المركز العامة: off by default. While off, /{slug}, its registration form and honour board all
// send visitors to the platform's home page and nothing about the centre is shown.
export function PublicPageSettings() {
  const { tx } = useI18n();
  const { supabase, showToast, center } = useApp();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const link = typeof location === "undefined" ? "" : `${location.origin}/${center.slug}`;

  useEffect(() => {
    let stale = false;
    supabase
      .from("centers")
      .select("public_page")
      .eq("id", center.id)
      .maybeSingle()
      .then(({ data }) => !stale && setOn((v) => v ?? data?.public_page ?? false));
    return () => {
      stale = true;
    };
  }, [supabase, center.id]);

  async function toggle(v: boolean) {
    setError("");
    setOn(v);
    setSaving(true);
    const { error } = await supabase.from("centers").update({ public_page: v }).eq("id", center.id);
    setSaving(false);
    if (error) {
      setOn(!v);
      return setError(error.message);
    }
    showToast(v ? tx("صفحة المركز ظاهرة للجميع الآن") : tx("تم إخفاء صفحة المركز"));
  }

  return (
    <div className="card">
      <h3>{tx("🌐 صفحة المركز العامة")}</h3>
      <p className="small muted">
        {tx("صفحة بلا تسجيل دخول فيها اسم المركز وشعاره ونبذة عنه وطرق التواصل، ومنها يصل الأهل إلى نموذج التسجيل ولوحة الشرف. ما دامت مخفية يُحوَّل من يفتح رابطها إلى الصفحة الرئيسية للمنصة ولا تظهر أي معلومة عن المركز.")}</p>
      {on !== null && (
        <label className="switch-row">
          <input type="checkbox" checked={on} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
          {on ? tx("ظاهرة للجميع") : tx("مخفية")}
        </label>
      )}
      {on && (
        <p className="small">
          {tx("الرابط:")} <span dir="ltr">{link}</span>{" "}
          <a href={`/${center.slug}`} target="_blank" rel="noreferrer">
            {tx("فتح")}</a>
        </p>
      )}
      {error && <p className="error-text">{tx(error)}</p>}
    </div>
  );
}
