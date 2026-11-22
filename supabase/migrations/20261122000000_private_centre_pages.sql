-- A centre's public page (/{slug}, its registration form and honour board) is private until the
-- admin turns it on. While private, public_center gives out nothing but that the link is taken
-- (signup checks it), and the registration form refuses requests as if the centre didn't exist.

alter table public.centers add column public_page boolean not null default false;
grant update (public_page) on table public.centers to authenticated;

CREATE OR REPLACE FUNCTION public.public_center(p_slug text DEFAULT NULL::text, p_domain text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select case when not c.public_page then jsonb_build_object('slug', c.slug, 'public_page', false) else jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'country', c.country, 'city', c.city,
    'logo_url', c.logo_url, 'palette', c.palette, 'primary_color', c.primary_color, 'about', c.about,
    'contact_phone', c.contact_phone, 'contact_email', c.contact_email, 'whatsapp', c.whatsapp,
    'instagram', c.instagram, 'facebook', c.facebook, 'address', c.address, 'locale', c.locale, 'extra_notes', c.extra_notes,
    'registrations_open', c.registrations_open,
    'honor_enabled', coalesce((select r.honor_enabled from public.ranking_settings r where r.center_id = c.id), false),
    'public_page', true) end
  from public.centers c
  where c.status <> 'SUSPENDED'
    and ((p_slug is not null and c.slug = lower(p_slug)) or (p_slug is null and p_domain is not null and c.domain = lower(p_domain)))
  limit 1
$$;

CREATE OR REPLACE FUNCTION public.submit_registration(p_student_name text, p_age integer, p_section text, p_guardian_name text, p_guardian_phone text, p_memorized text, p_trap text DEFAULT NULL::text, p_center text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_name text := private.clean_text(p_student_name);
  v_guardian text := private.clean_text(p_guardian_name);
  v_memorized text := private.clean_text(p_memorized);
  v_phone text := private.normalize_phone(p_guardian_phone);
  v_center public.centers;
begin
  -- A program that filled the hidden field: say "received" so it learns nothing.
  if coalesce(p_trap, '') <> '' then
    return true;
  end if;
  select * into v_center from public.centers
  where slug = lower(btrim(coalesce(p_center, ''))) and status <> 'SUSPENDED';
  if v_center.id is null then
    raise exception 'المركز غير موجود';
  end if;
  if not v_center.public_page then
    raise exception 'المركز غير موجود';
  end if;
  if not v_center.registrations_open then
    raise exception 'التسجيل مغلق حاليًا في هذا المركز. تواصلوا مع الإدارة';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'اكتبوا اسم الطالب (من حرفين إلى 100 حرف)';
  end if;
  if v_name ~ '[0-9٠-٩@/\\{}\[\]|$%^*=]' or v_name ~* '(https?|www\.)' then
    raise exception 'اسم الطالب: حروف فقط';
  end if;
  if p_age is not null and (p_age < 3 or p_age > 80) then
    raise exception 'العمر غير صحيح';
  end if;
  if p_section is null or p_section not in ('MALE', 'FEMALE') then
    raise exception 'اختاروا القسم';
  end if;
  if v_phone is null then
    raise exception 'رقم ولي الأمر غير صحيح';
  end if;
  if char_length(coalesce(v_guardian, '')) > 100 or char_length(coalesce(v_memorized, '')) > 300 then
    raise exception 'النص طويل جدًا';
  end if;
  if v_memorized ~* '(https?://|www\.)' or v_guardian ~* '(https?://|www\.)' then
    raise exception 'لا تضعوا روابط في الطلب';
  end if;

  -- The same child sent twice (a double tap, or sent again later): keep the first, say "received".
  if exists (select 1 from public.registration_requests
             where center_id = v_center.id and status = 'PENDING' and guardian_phone = v_phone
               and lower(student_name) = lower(v_name)) then
    return true;
  end if;
  -- Floods: a few requests per number a day, a cap per centre per hour and on the whole platform.
  if (select count(*) from public.registration_requests
      where guardian_phone = v_phone and created_at > now() - interval '1 day') >= 5 then
    raise exception 'وصلتنا طلبات كثيرة من هذا الرقم اليوم. سنتواصل معكم قريبًا إن شاء الله';
  end if;
  if (select count(*) from public.registration_requests where center_id = v_center.id and created_at > now() - interval '1 hour') >= 60
     or (select count(*) from public.registration_requests where created_at > now() - interval '1 hour') >= 600 then
    raise exception 'الخدمة مشغولة الآن، حاولوا بعد قليل';
  end if;

  insert into public.registration_requests (student_name, age, section, guardian_name, guardian_phone, memorized, center_id)
  values (v_name, p_age, p_section, v_guardian, v_phone, v_memorized, v_center.id);
  return true;
end $_$;
