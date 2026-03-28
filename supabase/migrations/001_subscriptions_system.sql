-- ═══════════════════════════════════════════════════════════
--  5tars — نظام الاشتراكات الكامل
--  شغّل هذا في Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ══ 1. جدول الاشتراكات ══
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan        text NOT NULL CHECK (plan IN ('trial','lifetime','lifetime_friend','suspended')),
  start_date  timestamptz DEFAULT now() NOT NULL,
  end_date    timestamptz,                            -- NULL = لا تنتهي (lifetime)
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','expired','cancelled')),
  granted_by  text DEFAULT 'system',                 -- 'owner' | 'system' | 'coupon'
  note        text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ══ 2. جدول التجارب المجانية الممنوحة يدوياً ══
CREATE TABLE IF NOT EXISTS public.free_trials (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  granted_by  text NOT NULL DEFAULT 'owner',
  granted_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  plan        text NOT NULL DEFAULT 'trial',
  note        text,
  created_at  timestamptz DEFAULT now()
);

-- ══ 3. جدول الكوبونات ══
CREATE TABLE IF NOT EXISTS public.coupons (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code          text UNIQUE NOT NULL,
  plan          text NOT NULL CHECK (plan IN ('trial','trial_30','lifetime','lifetime_friend')),
  max_uses      integer NOT NULL DEFAULT 1,
  used_count    integer NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    text DEFAULT 'owner',
  created_at    timestamptz DEFAULT now()
);

-- ══ 4. جدول إعدادات الموقع ══
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
  ('announcement_text',  ''),
  ('announcement_color', 'blue')
ON CONFLICT (key) DO NOTHING;

-- ══ 5. فهارس للأداء ══
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status  ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_free_trials_user_id   ON public.free_trials(user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code          ON public.coupons(code);

-- ══ 6. دالة check_subscription ══
-- ترجع الخطة الحالية الفعّالة للمستخدم
CREATE OR REPLACE FUNCTION public.check_subscription(p_user_id uuid)
RETURNS TABLE (
  plan        text,
  status      text,
  end_date    timestamptz,
  days_left   integer
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- أولاً: تحقق من جدول subscriptions
  RETURN QUERY
  SELECT
    s.plan,
    CASE
      WHEN s.end_date IS NULL     THEN 'active'
      WHEN s.end_date > now()     THEN 'active'
      ELSE 'expired'
    END::text,
    s.end_date,
    CASE
      WHEN s.end_date IS NULL THEN NULL::integer
      ELSE GREATEST(0, EXTRACT(DAY FROM (s.end_date - now()))::integer)
    END
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
  ORDER BY s.created_at DESC
  LIMIT 1;

  -- إذا لا يوجد سجل، تحقق من profiles.plan
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      COALESCE(p.plan, 'trial')::text,
      CASE
        WHEN p.plan IN ('lifetime','lifetime_friend') THEN 'active'
        WHEN p.trial_ends IS NULL                     THEN 'expired'
        WHEN p.trial_ends > now()                     THEN 'active'
        ELSE 'expired'
      END::text,
      p.trial_ends,
      CASE
        WHEN p.plan IN ('lifetime','lifetime_friend') THEN NULL::integer
        WHEN p.trial_ends IS NULL                     THEN 0
        ELSE GREATEST(0, EXTRACT(DAY FROM (p.trial_ends - now()))::integer)
      END
    FROM public.profiles p
    WHERE p.id = p_user_id
    LIMIT 1;
  END IF;
END;
$$;

-- ══ 7. دالة use_coupon ══
-- يستخدم المستخدم كوبوناً ويتحقق من صلاحيته
CREATE OR REPLACE FUNCTION public.use_coupon(
  p_code    text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_coupon  public.coupons%ROWTYPE;
  v_plan    text;
BEGIN
  -- جلب الكوبون
  SELECT * INTO v_coupon
  FROM public.coupons
  WHERE code = UPPER(p_code)
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'الكوبون غير موجود أو غير نشط');
  END IF;

  -- التحقق من الانتهاء
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'انتهت صلاحية الكوبون');
  END IF;

  -- التحقق من عدد الاستخدامات
  IF v_coupon.used_count >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'تم استنفاد هذا الكوبون');
  END IF;

  -- تحديد الخطة
  v_plan := CASE v_coupon.plan WHEN 'trial_30' THEN 'trial' ELSE v_coupon.plan END;

  -- تحديث عداد الاستخدام
  UPDATE public.coupons
  SET used_count = used_count + 1,
      is_active  = CASE WHEN used_count + 1 >= max_uses THEN false ELSE true END
  WHERE id = v_coupon.id;

  -- تحديث بيانات المستخدم
  IF v_coupon.plan = 'trial_30' THEN
    UPDATE public.profiles
    SET plan       = 'trial',
        trial_ends = GREATEST(COALESCE(trial_ends, now()), now()) + INTERVAL '30 days',
        updated_at = now()
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET plan       = v_plan,
        trial_ends = NULL,
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'plan', v_plan, 'coupon', v_coupon.code);
END;
$$;

-- ══ 8. RLS Policies ══

-- subscriptions: المستخدم يرى اشتراكه فقط
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_select_own_subscription" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- service_role يرى الكل (لا تحتاج policy — service_role يتجاوز RLS)

-- free_trials
ALTER TABLE public.free_trials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_select_own_trial" ON public.free_trials
  FOR SELECT USING (auth.uid() = user_id);

-- coupons: للقراءة فقط من المستخدمين (للتحقق عند الاستخدام)
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_read_active_coupons" ON public.coupons
  FOR SELECT USING (is_active = true);

-- site_settings: كل المستخدمين يقرؤون، لا أحد يكتب مباشرةً (الكتابة عبر service_role فقط)
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_settings" ON public.site_settings
  FOR SELECT USING (true);

-- ══ 9. Grant للـ service_role ══
-- (Supabase Edge Functions تستخدم service_role لتجاوز RLS)
GRANT ALL ON public.subscriptions  TO service_role;
GRANT ALL ON public.free_trials    TO service_role;
GRANT ALL ON public.coupons        TO service_role;
GRANT ALL ON public.site_settings  TO service_role;
GRANT EXECUTE ON FUNCTION public.check_subscription TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.use_coupon         TO authenticated, service_role;
