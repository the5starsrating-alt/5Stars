# 5tars ⭐ — منصة إدارة تقييمات Google للأعمال السعودية

## نظرة عامة
منصة ويب لإدارة تقييمات Google Business للأعمال السعودية مع دعم الذكاء الاصطناعي للرد على التقييمات.

## التقنيات المستخدمة
- **Frontend**: HTML + CSS + Vanilla JS (بدون framework)
- **Backend**: Supabase (Auth + Database)
- **Hosting**: Vercel
- **Auth**: Supabase Auth + Google OAuth

## الصفحات
| الصفحة | الوظيفة |
|--------|---------|
| `index.html` | الصفحة الرئيسية (Landing Page) |
| `signup.html` | تسجيل الدخول / إنشاء حساب |
| `auth-callback.html` | معالجة Google OAuth callback |
| `dashboard.html` | لوحة التحكم الرئيسية |
| `reset-password.html` | إعادة تعيين كلمة المرور |

## Supabase Schema

```sql
-- profiles table
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text,
  email text,
  phone text,
  business_type text,   -- restaurant/cafe/salon/clinic/retail/other
  business_name text,   -- اسم Google Business
  plan text DEFAULT 'trial',
  trial_ends timestamptz,
  google_maps_url text,
  google_review_url text,
  created_at timestamptz DEFAULT now()
);

-- RLS Policy
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own profile"
  ON public.profiles FOR ALL USING (auth.uid() = id);
```

## الإعداد

1. أنشئ مشروع على [Supabase](https://supabase.com)
2. شغّل SQL Schema أعلاه
3. فعّل Google OAuth في Supabase Auth
4. أضف Redirect URL: `https://your-domain.vercel.app/auth-callback.html`
5. انشر على Vercel

## Vercel URL
https://5-stars-psi.vercel.app
