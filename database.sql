-- ═══════════════════════════════════════════════
-- 5tars Database Schema
-- نفّذ هذا الكود في Supabase SQL Editor
-- ═══════════════════════════════════════════════

-- 1. تعديل جدول profiles (يجب أن يكون موجوداً مسبقاً)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_connected BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_place_id TEXT;

-- 2. جدول الاشتراكات
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','basic','pro','advanced')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  start_date TIMESTAMPTZ DEFAULT NOW(),
  end_date TIMESTAMPTZ,
  granted_by UUID REFERENCES auth.users(id),
  amount_paid NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. جدول التجارب المجانية الممنوحة
CREATE TABLE IF NOT EXISTS free_trials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  notes TEXT
);

-- 4. جدول الكوبونات
CREATE TABLE IF NOT EXISTS coupons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_percent INTEGER NOT NULL CHECK (discount_percent > 0 AND discount_percent <= 100),
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. جدول إعدادات الموقع
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. دالة check_subscription
CREATE OR REPLACE FUNCTION check_subscription(p_user_id UUID)
RETURNS TABLE (plan TEXT, status TEXT, end_date TIMESTAMPTZ, is_trial BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT s.plan, s.status, s.end_date, (s.granted_by IS NOT NULL)
  FROM subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status = 'active'
    AND (s.end_date IS NULL OR s.end_date > NOW())
  ORDER BY s.created_at DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'free'::TEXT, 'active'::TEXT, NULL::TIMESTAMPTZ, false;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. تفعيل RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_trials ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

-- Policies: subscriptions
DROP POLICY IF EXISTS "user_own_subscription" ON subscriptions;
CREATE POLICY "user_own_subscription" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all_subscriptions" ON subscriptions;
CREATE POLICY "owner_all_subscriptions" ON subscriptions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );

-- Policies: free_trials
DROP POLICY IF EXISTS "user_own_trial" ON free_trials;
CREATE POLICY "user_own_trial" ON free_trials
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all_trials" ON free_trials;
CREATE POLICY "owner_all_trials" ON free_trials
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );

-- Policies: coupons
DROP POLICY IF EXISTS "owner_coupons" ON coupons;
CREATE POLICY "owner_coupons" ON coupons
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );

-- Policies: site_settings
DROP POLICY IF EXISTS "anyone_read_settings" ON site_settings;
CREATE POLICY "anyone_read_settings" ON site_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "owner_write_settings" ON site_settings;
CREATE POLICY "owner_write_settings" ON site_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );

-- 8. إعدادات افتراضية
INSERT INTO site_settings (key, value) VALUES
  ('maintenance_mode', 'false'),
  ('ai_replies_enabled', 'true'),
  ('whatsapp_notifications_enabled', 'true'),
  ('new_registrations_enabled', 'true'),
  ('announcement_message', ''),
  ('announcement_active', 'false')
ON CONFLICT (key) DO NOTHING;

-- 9. تعيين أول مستخدم كـ owner (غيّر الإيميل)
-- UPDATE profiles SET role = 'owner' WHERE id = (
--   SELECT id FROM auth.users WHERE email = 'your-email@example.com'
-- );
