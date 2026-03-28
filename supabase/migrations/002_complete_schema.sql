-- ═══════════════════════════════════════════════════════════
--  5tars — المخطط الكامل للقاعدة
--  شغّل في: Supabase Dashboard → SQL Editor
--  آمن للتشغيل مرات متعددة (IF NOT EXISTS / ON CONFLICT)
-- ═══════════════════════════════════════════════════════════

-- ══ 1. جدول الملفات الشخصية (profiles) ══
-- تأكد من وجوده بأعمدة كافية
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS phone          text,
  ADD COLUMN IF NOT EXISTS business_type  text,
  ADD COLUMN IF NOT EXISTS plan           text DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_ends     timestamptz,
  ADD COLUMN IF NOT EXISTS google_maps_url text,
  ADD COLUMN IF NOT EXISTS email          text,
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now();

-- ══ 2. جدول الاشتراكات ══
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan        text        NOT NULL CHECK (plan IN ('free','trial','basic','pro','advanced','lifetime','lifetime_friend','suspended')),
  status      text        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','expired','cancelled','paused')),
  start_date  timestamptz DEFAULT now() NOT NULL,
  end_date    timestamptz,                            -- NULL = لا تنتهي (lifetime)
  granted_by  text        DEFAULT 'system',           -- 'owner' | 'system' | 'coupon' | email
  note        text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ══ 3. جدول التجارب المجانية الممنوحة يدوياً ══
CREATE TABLE IF NOT EXISTS public.free_trials (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  granted_by  text        NOT NULL DEFAULT 'owner',
  granted_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  plan        text        NOT NULL DEFAULT 'trial',
  note        text,
  created_at  timestamptz DEFAULT now()
);

-- ══ 4. جدول الكوبونات ══
CREATE TABLE IF NOT EXISTS public.coupons (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  code          text        UNIQUE NOT NULL,
  plan          text        NOT NULL CHECK (plan IN ('trial','trial_30','lifetime','lifetime_friend')),
  max_uses      integer     NOT NULL DEFAULT 1,
  used_count    integer     NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    text        DEFAULT 'owner',
  created_at    timestamptz DEFAULT now()
);

-- ══ 5. جدول إعدادات الموقع ══
CREATE TABLE IF NOT EXISTS public.site_settings (
  key         text PRIMARY KEY,
  value       text,
  updated_at  timestamptz DEFAULT now(),
  updated_by  text DEFAULT 'owner'
);

-- إعدادات افتراضية
INSERT INTO public.site_settings (key, value) VALUES
  ('maintenance_mode',   'false'),
  ('signup_enabled',     'true'),
  ('ai_enabled',         'true'),
  ('whatsapp_enabled',   'true'),
  ('trial_enabled',      'true'),
  ('trial_days',         '14'),
  ('announcement_text',  ''),
  ('announcement_color', 'blue')
ON CONFLICT (key) DO NOTHING;

-- ══ 6. سجلات تكلفة API ══
CREATE TABLE IF NOT EXISTS public.api_usage_logs (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  model         text,
  input_tokens  integer     DEFAULT 0,
  output_tokens integer     DEFAULT 0,
  cost_usd      numeric(10,6) DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

-- ══ 7. فهارس الأداء ══
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id  ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status   ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_end_date ON public.subscriptions(end_date);
CREATE INDEX IF NOT EXISTS idx_free_trials_user_id    ON public.free_trials(user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code           ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active         ON public.coupons(is_active);
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id       ON public.api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at    ON public.api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_plan          ON public.profiles(plan);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at    ON public.profiles(created_at);

-- ══ 8. RLS Policies ══

-- profiles: المستخدم يقرأ ويعدّل ملفه فقط
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_select_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "user_update_own_profile"  ON public.profiles;
CREATE POLICY "user_select_own_profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "user_update_own_profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- subscriptions: المستخدم يرى اشتراكاته فقط
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_select_own_subscription" ON public.subscriptions;
CREATE POLICY "user_select_own_subscription" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- free_trials
ALTER TABLE public.free_trials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_select_own_trial" ON public.free_trials;
CREATE POLICY "user_select_own_trial" ON public.free_trials
  FOR SELECT USING (auth.uid() = user_id);

-- coupons: الكل يقرأ النشط فقط (للتحقق عند الاستخدام)
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_read_active_coupons" ON public.coupons;
CREATE POLICY "user_read_active_coupons" ON public.coupons
  FOR SELECT USING (is_active = true);

-- site_settings: الكل يقرأ، لا أحد يكتب مباشرةً (عبر service_role فقط)
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_settings" ON public.site_settings;
CREATE POLICY "public_read_settings" ON public.site_settings
  FOR SELECT USING (true);

-- api_usage_logs: المستخدم يرى سجلاته فقط
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_select_own_logs" ON public.api_usage_logs;
CREATE POLICY "user_select_own_logs" ON public.api_usage_logs
  FOR SELECT USING (auth.uid() = user_id);

-- ══ 9. Grants للـ service_role ══
GRANT ALL ON public.subscriptions   TO service_role;
GRANT ALL ON public.free_trials     TO service_role;
GRANT ALL ON public.coupons         TO service_role;
GRANT ALL ON public.site_settings   TO service_role;
GRANT ALL ON public.api_usage_logs  TO service_role;
GRANT ALL ON public.profiles        TO service_role;

-- ══ 10. دالة check_subscription ══
CREATE OR REPLACE FUNCTION public.check_subscription(p_user_id uuid)
RETURNS TABLE (plan text, status text, end_date timestamptz, days_left integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.plan,
    CASE WHEN s.end_date IS NULL OR s.end_date > now() THEN 'active' ELSE 'expired' END::text,
    s.end_date,
    CASE WHEN s.end_date IS NULL THEN NULL::integer
         ELSE GREATEST(0, EXTRACT(DAY FROM (s.end_date - now()))::integer) END
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id AND s.status = 'active'
  ORDER BY s.created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      COALESCE(p.plan, 'trial')::text,
      CASE WHEN p.plan IN ('lifetime','lifetime_friend') THEN 'active'
           WHEN p.trial_ends IS NULL                     THEN 'expired'
           WHEN p.trial_ends > now()                     THEN 'active'
           ELSE 'expired' END::text,
      p.trial_ends,
      CASE WHEN p.plan IN ('lifetime','lifetime_friend') THEN NULL::integer
           WHEN p.trial_ends IS NULL                     THEN 0
           ELSE GREATEST(0, EXTRACT(DAY FROM (p.trial_ends - now()))::integer) END
    FROM public.profiles p WHERE p.id = p_user_id LIMIT 1;
  END IF;
END;
$$;

-- ══ 11. دالة use_coupon ══
CREATE OR REPLACE FUNCTION public.use_coupon(p_code text, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_coupon public.coupons%ROWTYPE;
  v_plan   text;
BEGIN
  SELECT * INTO v_coupon FROM public.coupons
  WHERE code = UPPER(p_code) AND is_active = true FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الكوبون غير موجود أو غير نشط');
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'انتهت صلاحية الكوبون');
  END IF;
  IF v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'تم استنفاد هذا الكوبون');
  END IF;

  v_plan := CASE v_coupon.plan WHEN 'trial_30' THEN 'trial' ELSE v_coupon.plan END;

  UPDATE public.coupons
  SET used_count = used_count + 1,
      is_active  = CASE WHEN used_count + 1 >= max_uses THEN false ELSE true END
  WHERE id = v_coupon.id;

  IF v_coupon.plan = 'trial_30' THEN
    UPDATE public.profiles
    SET plan = 'trial', trial_ends = GREATEST(COALESCE(trial_ends, now()), now()) + INTERVAL '30 days',
        updated_at = now()
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET plan = v_plan, trial_ends = NULL, updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'plan', v_plan, 'coupon', v_coupon.code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_subscription TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.use_coupon         TO authenticated, service_role;

-- ══ 12. Trigger: auto-update updated_at ══
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at    ON public.profiles;
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
