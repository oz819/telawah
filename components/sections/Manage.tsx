"use client";

import { useI18n } from "@/components/LocaleProvider";

import { Fragment, useEffect, useState } from "react";
import { useApp } from "@/components/AppContext";
import Panel from "@/components/Panel";
import CircleForm from "@/components/CircleForm";
import { confirmDialog } from "@/components/ConfirmDialog";
import { adminSoftDelete } from "@/lib/adminDelete";
import { PROFILE_COLUMNS, store, useStore } from "@/lib/offline/store";
import { SECTIONS, SECTION_LABEL, effectiveFilter, filterLabel, filterOptions, teacherTitle } from "@/lib/filter";
import CenterSettings, { HonorSettings, PublicPageSettings } from "@/components/CenterSettings";
import Registrations from "@/components/Registrations";
import ExportExcel from "@/components/ExportExcel";
import CenterProfile from "@/components/center/CenterProfile";
import { TalqeenSetting } from "@/components/center/CenterTracks";
import Invites from "@/components/center/Invites";
import ImportStudents from "@/components/center/ImportStudents";

// Admin-only actions (spec §5.4). These need a connection: they write straight to Supabase
// (RLS re-checks is_admin()) and then refresh the local copy.
export default function Manage({ openLog }: { openLog: (log: "audit" | "trash") => void }) {
  const { tx } = useI18n();
  return (
    <section>
      <div className="card notice">
        {tx("صلاحيات المدير: إدارة المحفّظين والمدراء، إنشاء الحلقات وتسميتها وأرشفتها، أرشفة الطلاب، وإدارة كتب العربية. كل محفّظ مفعّل يرى جميع الطلاب ويضيف ويعدّل إدخالاتهم. هذه الإجراءات تحتاج اتصالًا بالإنترنت.")}</div>
      <div className="card">
        <h3>{tx("السجلات")}</h3>
        <p className="small muted">{tx("راجع تعديلات الفريق أو استرجع العناصر المحذوفة.")}</p>
        <div className="row-actions">
          <button type="button" className="secondary" onClick={() => openLog("audit")}>{tx("📜 سجل التعديلات")}</button>
          <button type="button" className="secondary" onClick={() => openLog("trash")}>{tx("🗑️ سجل المحذوفات")}</button>
        </div>
      </div>
      {/* Same order as the Madaya centre; what a multi-centre platform adds comes after. */}
      <Registrations />
      <Teachers />
      <Halaqat />
      <ArabicBooks />
      <CenterSettings />
      <TalqeenSetting />
      <PublicPageSettings />
      <HonorSettings />
      <ExportExcel />
      <CenterProfile />
      <Invites />
      <ImportStudents />
    </section>
  );
}

function Teachers() {
  const { tx } = useI18n();
  const s = useStore();
  const { supabase, profile, showToast } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<"TEACHER" | "ADMIN">("TEACHER");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editFilter, setEditFilter] = useState("all");
  const circles = s.all("circles").filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const filterChoices = filterOptions(circles);
  const people = s.all("profiles").sort((a, b) => a.name.localeCompare(b.name, "ar"));

  async function loadEmails() {
    try {
      const res = await fetch("/api/admin/teachers");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setEmails(data.emails ?? {});
    } catch {}
  }

  useEffect(() => {
    loadEmails();
  }, []);

  async function refresh() {
    const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS);
    if (data) await store.applyRemote("profiles", data);
  }

  async function add() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || tx("تعذّر إضافة المحفّظ"));
      setName("");
      setEmail("");
      setNewRole("TEACHER");
      await refresh();
      showToast(newRole === "ADMIN" ? tx("تمت إضافة المدير") : tx("تمت إضافة المحفّظ"));
    } catch {
      setError(tx("تحتاج اتصالًا بالإنترنت"));
    } finally {
      setBusy(false);
    }
  }

  async function update(id: string, patch: { active?: boolean; role?: string }, msg: string) {
    setError("");
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) return setError(error.message);
    await refresh();
    showToast(msg);
  }

  function startEdit(id: string, currentName: string, currentFilter: string | null) {
    setError("");
    setEditId(id);
    setEditName(currentName);
    setEditEmail(emails[id] ?? "");
    setEditFilter(effectiveFilter(currentFilter ?? "all", circles));
  }

  async function saveEdit(id: string, currentName: string, currentFilter: string | null) {
    const patch: { name?: string; email?: string; default_filter?: string | null } = {};
    if (editName.trim() !== currentName) patch.name = editName.trim();
    if (editEmail.trim() && editEmail.trim() !== (emails[id] ?? "")) patch.email = editEmail.trim();
    if (editFilter !== effectiveFilter(currentFilter ?? "all", circles)) patch.default_filter = editFilter === "all" ? null : editFilter;
    if (!patch.name && !patch.email && patch.default_filter === undefined) return setEditId(null);
    setBusy(true);
    setError("");
    try {
      // The name is a plain profiles update (RLS: admins only); only the login email needs the
      // server route, because changing it goes through the Auth Admin API.
      if (patch.name || patch.default_filter !== undefined) {
        // undefined fields are left out of the request, so only what changed is written.
        const { error } = await supabase
          .from("profiles")
          .update({ name: patch.name, default_filter: patch.default_filter })
          .eq("id", id);
        if (error) return setError(error.message);
      }
      if (patch.email) {
        const res = await fetch(`/api/admin/teachers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: patch.email }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setError(data.error || tx("تعذّر تغيير البريد"));
      }
      setEditId(null);
      await Promise.all([refresh(), loadEmails()]);
      showToast(tx("تم حفظ التعديل"));
    } catch {
      setError(tx("تحتاج اتصالًا بالإنترنت"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, personName: string) {
    const ok = await confirmDialog({
      title: tx("حذف حساب «{0}»؟", [personName]),
      body: tx("ينتقل إلى سجل المحذوفات ولن يستطيع تسجيل الدخول. يمكنك استرجاعه من هناك، وتبقى كل سجلاته."),
      ok: tx("حذف"),
      danger: true,
    });
    if (!ok) return;
    setError("");
    setBusy(true);
    const err = await adminSoftDelete(supabase, "profile", id);
    setBusy(false);
    if (err) return setError(err);
    if (editId === id) setEditId(null);
    showToast(tx("تم حذف «{0}» — تجده في سجل المحذوفات", [personName]));
  }

  return (
    <div className="card">
      <h3>{tx("👥 المحفّظون والمدراء")}</h3>
      <div className="formgrid compact">
        <input placeholder={tx("الاسم")} value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder={tx("البريد الإلكتروني")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select aria-label={tx("الصلاحية")} value={newRole} onChange={(e) => setNewRole(e.target.value === "ADMIN" ? "ADMIN" : "TEACHER")}>
          <option value="TEACHER">{tx("الصلاحية: محفّظ")}</option>
          <option value="ADMIN">{tx("الصلاحية: مدير")}</option>
        </select>
        <button onClick={add} disabled={busy}>
          {newRole === "ADMIN" ? tx("إضافة مدير") : tx("إضافة محفّظ")}
        </button>
      </div>
      <p className="small muted">{tx("يدخل المحفّظ بعدها برمز يصله على بريده. لا يستطيع أحد غير مسجّل هنا إنشاء حساب بنفسه.")}</p>
      {error && <p className="error-text">{tx(error)}</p>}
      <div style={{ overflow: "auto" }}>
        <table className="staff-table">
          <thead>
            <tr>
              <th>{tx("الاسم")}</th>
              <th>{tx("البريد")}</th>
              <th>{tx("الدور")}</th>
              <th>{tx("الحالة")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  <td>
                    {p.name}
                    {p.default_filter && effectiveFilter(p.default_filter, circles) !== "all" && (
                      <div className="small muted">{tx("يفتح على:")} {effectiveFilter(p.default_filter, circles).startsWith("c:") ? filterLabel(effectiveFilter(p.default_filter, circles), circles) : tx(filterLabel(effectiveFilter(p.default_filter, circles), circles))}</div>
                    )}
                  </td>
                  <td className="small" dir="ltr" style={{ textAlign: "start" }}>
                    {emails[p.id] ?? "—"}
                  </td>
                  <td>{p.role === "ADMIN" ? tx("مدير") : tx(teacherTitle(p.default_filter, circles))}</td>
                  <td>{p.active ? tx("مفعّل") : tx("معطّل")}</td>
                  <td className="row-actions">
                    {p.id !== profile.id && (
                      <>
                        <button
                          className="link"
                          onClick={() => update(p.id, { active: !p.active }, p.active ? tx("تم التعطيل") : tx("تم التفعيل"))}
                        >
                          {p.active ? tx("تعطيل") : tx("تفعيل")}
                        </button>
                        {p.role === "TEACHER" ? (
                          <button
                            className="link"
                            onClick={() => confirm(tx("ترقية {0} إلى مدير؟", [p.name])) && update(p.id, { role: "ADMIN" }, tx("تمت الترقية إلى مدير"))}
                          >
                            {tx("ترقية لمدير")}</button>
                        ) : (
                          <button
                            className="link"
                            onClick={() =>
                              confirm(tx("إرجاع {0} إلى محفّظ؟", [p.name])) && update(p.id, { role: "TEACHER" }, tx("تم التحويل إلى محفّظ"))
                            }
                          >
                            {tx("إلغاء الإدارة")}</button>
                        )}
                      </>
                    )}
                    <button className="link" onClick={() => startEdit(p.id, p.name, p.default_filter)}>
                      {tx("تعديل")}</button>
                    {p.id !== profile.id && (
                      <button className="link danger-link" disabled={busy} onClick={() => remove(p.id, p.name)}>
                        {tx("حذف")}</button>
                    )}
                  </td>
                </tr>
                {editId === p.id && (
                  <tr className="edit-row">
                    <td colSpan={5}>
                      <div className="formgrid compact">
                        <div>
                          <label>{tx("الاسم")}</label>
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </div>
                        <div>
                          <label>{tx("البريد الإلكتروني (للدخول)")}</label>
                          <input type="email" dir="ltr" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                        </div>
                        <div>
                          <label>{tx("يفتح التطبيق على")}</label>
                          <select value={editFilter} onChange={(e) => setEditFilter(e.target.value)}>
                            <option value="all">{tx("كل الطلاب")}</option>
                            {filterChoices.sections.map((sec) => (
                              <option key={sec} value={`s:${sec}`}>
                                {tx(SECTION_LABEL[sec])}
                              </option>
                            ))}
                            {filterChoices.circles.map((c) => (
                              <option key={c.id} value={`c:${c.id}`}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="row-actions" style={{ alignSelf: "end" }}>
                          <button disabled={busy || !editName.trim()} onClick={() => saveEdit(p.id, p.name, p.default_filter)}>
                            {tx("حفظ")}</button>
                          <button className="secondary" onClick={() => setEditId(null)}>
                            {tx("إلغاء")}</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Halaqat() {
  const { tx } = useI18n();
  const s = useStore();
  const { supabase, showToast } = useApp();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const circles = s.all("circles").sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar"));
  const count = (id: string) => s.all("students").filter((st) => st.active && st.circle_id === id).length;

  function friendly(msg: string) {
    return /circles_name_unique|duplicate/i.test(msg) ? tx("يوجد حلقة بهذا الاسم (ربما في سجل المحذوفات — استرجعها من هناك)") : msg;
  }


  async function update(id: string, patch: { name?: string; active?: boolean; section?: string | null }) {
    setError("");
    const { data, error } = await supabase
      .from("circles")
      .update({ ...patch, edited_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return setError(friendly(error.message));
    await store.applyRemote("circles", [data]);
    showToast(tx("تم الحفظ"));
  }

  // A circle's teacher = the account that opens on that circle (its «يفتح على» filter, as in «تعديل»).
  const staff = s.all("profiles").filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const teacherOf = (cid: string) => staff.find((p) => p.default_filter === `c:${cid}`)?.id ?? "";
  async function setTeacher(cid: string, pid: string) {
    setError("");
    const before = staff.filter((p) => p.default_filter === `c:${cid}` && p.id !== pid).map((p) => p.id);
    if (before.length) {
      const { error } = await supabase.from("profiles").update({ default_filter: null }).in("id", before);
      if (error) return setError(error.message);
    }
    if (pid) {
      const { error } = await supabase.from("profiles").update({ default_filter: `c:${cid}` }).eq("id", pid);
      if (error) return setError(error.message);
    }
    const { data } = await supabase.from("profiles").select(PROFILE_COLUMNS);
    if (data) await store.applyRemote("profiles", data);
    showToast(pid ? tx("تم تعيين محفّظ الحلقة") : tx("أُزيل محفّظ الحلقة"));
  }

  async function remove(id: string, circleName: string) {
    const ok = await confirmDialog({
      title: tx("حذف الحلقة «{0}»؟", [circleName]),
      body: tx("تنتقل إلى سجل المحذوفات وتختفي من كل القوائم. يمكنك استرجاعها من هناك."),
      ok: tx("حذف"),
      danger: true,
    });
    if (!ok) return;
    setError("");
    const err = await adminSoftDelete(supabase, "circle", id);
    if (err) return setError(err);
    showToast(tx("تم حذف «{0}»", [circleName]));
  }

  return (
    <div className="card">
      <h3>{tx("🏫 الحلقات")}</h3>
      <p className="small muted">
        {tx("اسم الحلقة نص حر، مثل «ذكور – الشيخ أحمد» أو «إناث 10–12». حدّد قسم كل حلقة (الذكور / الإناث)، فيظهر القسم في فرز الطلاب ويجمع كل حلقاته.")}</p>
      {adding ? (
        <Panel title={tx("🏫 حلقة جديدة مع طلابها")} onClose={() => setAdding(false)} className="panel-inset">
          <CircleForm
            supabase={supabase}
            onCreated={async (c) => {
              await store.sync();
              setAdding(false);
              showToast(c.students ? tx("تم إنشاء «{0}» مع {1} طالبًا", [c.name, c.students]) : tx("تم إنشاء «{0}»", [c.name]));
            }}
            secondary={
              <button type="button" className="secondary" onClick={() => setAdding(false)}>
                {tx("إلغاء")}
              </button>
            }
          />
        </Panel>
      ) : (
        <div className="row-actions" style={{ margin: "8px 0 12px" }}>
          <button onClick={() => setAdding(true)}>{tx("+ حلقة جديدة")}</button>
        </div>
      )}
      {error && <p className="error-text">{tx(error)}</p>}
      <div style={{ overflow: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>{tx("الحلقة")}</th>
            <th>{tx("القسم")}</th>
            <th>{tx("المحفّظ")}</th>
            <th>{tx("الطلاب")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {circles.map((c) => (
            <tr key={c.id} className={c.active ? "" : "muted"}>
              <td>
                {c.name} {!c.active && <span className="badge">{tx("مؤرشفة")}</span>}
              </td>
              <td>
                <select
                  className="cell-select"
                  value={c.section ?? ""}
                  onChange={(e) => update(c.id, { section: e.target.value || null })}
                  aria-label={tx("قسم {0}", [c.name])}
                >
                  <option value="">—</option>
                  {SECTIONS.map((sec) => (
                    <option key={sec} value={sec}>
                      {tx(SECTION_LABEL[sec])}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select className="cell-select" value={teacherOf(c.id)} onChange={(e) => setTeacher(c.id, e.target.value)} aria-label={tx("محفّظ {0}", [c.name])}>
                  <option value="">—</option>
                  {staff.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>{count(c.id)}</td>
              <td className="row-actions">
                <button
                  className="link"
                  onClick={() => {
                    const n = prompt(tx("الاسم الجديد للحلقة:"), c.name);
                    if (n && n.trim() && n.trim() !== c.name) update(c.id, { name: n.trim() });
                  }}
                >
                  {tx("إعادة تسمية")}</button>
                <button className="link" onClick={() => update(c.id, { active: !c.active })}>
                  {c.active ? tx("أرشفة") : tx("استعادة")}
                </button>
                <button className="link danger-link" onClick={() => remove(c.id, c.name)}>
                  {tx("حذف")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function ArabicBooks() {
  const { tx } = useI18n();
  const s = useStore();
  const { supabase, showToast } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState("");
  const [error, setError] = useState("");
  const books = s.all("arabic_books").sort((a, b) => Number(b.active) - Number(a.active) || a.title.localeCompare(b.title, "ar"));

  function reset() {
    setEditingId(null);
    setTitle("");
    setPages("");
    setError("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const total = Number(pages);
    if (!title.trim() || !Number.isInteger(total) || total < 1) return setError(tx("أدخل العنوان وعدد الصفحات"));
    setBusy(true);
    try {
      if (editingId) {
        const { data, error } = await supabase.from("arabic_entries").select("to_page")
          .eq("book_id", editingId).order("to_page", { ascending: false }).limit(1);
        if (error) return setError(error.message);
        if (data?.[0] && total < data[0].to_page) return setError(tx("يوجد درس مسجّل حتى الصفحة {0}؛ لا يمكن تقليل عدد الصفحات عن ذلك.", [data[0].to_page]));
      }
      const values = { title: title.trim(), total_pages: total };
      const query = editingId
        ? supabase.from("arabic_books").update({ ...values, edited_at: new Date().toISOString() }).eq("id", editingId)
        : supabase.from("arabic_books").insert(values);
      const { data, error } = await query.select().single();
      if (error) return setError(/unique|duplicate/i.test(error.message) ? tx("يوجد كتاب بهذا العنوان (ربما في سجل المحذوفات)") : error.message);
      await store.applyRemote("arabic_books", [data]);
      showToast(editingId ? tx("تم تعديل الكتاب") : tx("تمت إضافة الكتاب"));
      reset();
    } catch {
      setError(tx("تعذّر حفظ الكتاب. تحقق من الاتصال وحاول مرة أخرى."));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, active: boolean) {
    const { data, error } = await supabase
      .from("arabic_books")
      .update({ active, edited_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return setError(error.message);
    await store.applyRemote("arabic_books", [data]);
  }

  async function remove(id: string, bookTitle: string) {
    const ok = await confirmDialog({
      title: tx("حذف الكتاب «{0}»؟", [bookTitle]),
      body: tx("ينتقل إلى سجل المحذوفات ويختفي من القوائم. دروس الطلاب السابقة فيه تبقى."),
      ok: tx("حذف"),
      danger: true,
    });
    if (!ok) return;
    setError("");
    const err = await adminSoftDelete(supabase, "arabic_book", id);
    if (err) return setError(err);
    showToast(tx("تم حذف «{0}»", [bookTitle]));
  }

  return (
    <div className="card">
      <h3>{tx("📘 كتب العربية")}</h3>
      <p className="small muted">
        {tx("كل كتاب تضيفه هنا يظهر خيارًا عند إضافة طالب وفي قسم «العربية» داخل بطاقة الطالب. عدد الصفحات هو عدد صفحات النسخة المستخدمة في المركز، ومنه يُحسب تقدّم الطالب.")}</p>
      <p className="small muted">{tx("اختر عنوانًا مقترحًا أو اكتب عنوانك، ثم أدخل عدد صفحات طبعتك. يمكنك تعديل العنوان والصفحات لاحقًا؛ هذه قائمة متابعة وليست ملفات الكتب.")}</p>
      <form onSubmit={save}>
        <div className="formgrid compact">
          <input aria-label={tx("عنوان الكتاب")} list="arabic-book-suggestions" placeholder={tx("عنوان الكتاب (مثال: الرشيدي)")} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <datalist id="arabic-book-suggestions">
            <option value="الرشيدي" />
            <option value="القاعدة النورانية" />
            <option value="العربية بين يديك — كتاب الطالب الأول، الجزء الأول" />
          </datalist>
          <input
            aria-label={tx("عدد صفحات الكتاب")}
            placeholder={tx("عدد صفحات طبعتك")}
            required
            type="number"
            inputMode="numeric"
            min={1}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
          />
          <button type="submit" disabled={busy}>{busy ? tx("جارٍ الحفظ…") : editingId ? tx("حفظ تعديل الكتاب") : tx("إضافة كتاب")}</button>
          {editingId && <button type="button" className="secondary" onClick={reset} disabled={busy}>{tx("إلغاء التعديل")}</button>}
        </div>
      </form>
      {error && <p className="error-text">{tx(error)}</p>}
      {books.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{tx("الكتاب")}</th>
              <th>{tx("الصفحات")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id} className={b.active ? "" : "muted"}>
                <td>{b.title}</td>
                <td>{b.total_pages}</td>
                <td className="row-actions">
                  <button type="button" className="link" disabled={busy} onClick={() => { setEditingId(b.id); setTitle(b.title); setPages(String(b.total_pages)); setError(""); }}>{tx("تعديل")}</button>
                  <button className="link" onClick={() => toggle(b.id, !b.active)}>
                    {b.active ? tx("أرشفة") : tx("استعادة")}
                  </button>
                  <button className="link danger-link" onClick={() => remove(b.id, b.title)}>
                    {tx("حذف")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
