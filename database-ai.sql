-- ═══════════════════════════════════════
-- 5tars AI Agent — Database Schema
-- ═══════════════════════════════════════

-- المنشآت التجارية
CREATE TABLE IF NOT EXISTS businesses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT, -- restaurant, cafe, salon, clinic, retail
  city TEXT,
  google_place_id TEXT,
  google_review_url TEXT,
  whatsapp_number TEXT,
  preferred_dialect TEXT DEFAULT 'saudi', -- saudi, gulf, formal
  subscription_plan TEXT DEFAULT 'trial',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- التقييمات
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  reviewer_name TEXT,
  reviewer_phone TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  review_date TIMESTAMPTZ DEFAULT NOW(),
  ai_suggested_reply TEXT,
  final_reply TEXT,
  replied_at TIMESTAMPTZ,
  sent_via_whatsapp BOOLEAN DEFAULT false,
  whatsapp_message_id TEXT,
  status TEXT DEFAULT 'pending' -- pending, replied, sent
);

-- رسائل واتساب
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),
  phone TEXT NOT NULL,
  template_name TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  type TEXT, -- reply, review_request, marketing
  status TEXT DEFAULT 'sent', -- sent, delivered, read, failed
  whatsapp_message_id TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ
);

-- طلبات التقييم
CREATE TABLE IF NOT EXISTS review_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service_type TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  reminder_sent BOOLEAN DEFAULT false,
  reminder_sent_at TIMESTAMPTZ,
  result TEXT DEFAULT 'pending' -- pending, reviewed, ignored
);

-- حملات التسويق
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id),
  target_city TEXT,
  target_type TEXT,
  total_sent INTEGER DEFAULT 0,
  total_opened INTEGER DEFAULT 0,
  total_replied INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'running' -- running, paused, completed
);

-- RLS
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_businesses" ON businesses FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "owner_reviews" ON reviews FOR ALL USING (
  EXISTS (SELECT 1 FROM businesses WHERE id = reviews.business_id AND owner_id = auth.uid())
);
CREATE POLICY "owner_wa_messages" ON whatsapp_messages FOR ALL USING (
  EXISTS (SELECT 1 FROM businesses WHERE id = whatsapp_messages.business_id AND owner_id = auth.uid())
);
CREATE POLICY "owner_review_requests" ON review_requests FOR ALL USING (
  EXISTS (SELECT 1 FROM businesses WHERE id = review_requests.business_id AND owner_id = auth.uid())
);
CREATE POLICY "owner_campaigns" ON marketing_campaigns FOR ALL USING (
  EXISTS (SELECT 1 FROM businesses WHERE id = marketing_campaigns.business_id AND owner_id = auth.uid())
);
