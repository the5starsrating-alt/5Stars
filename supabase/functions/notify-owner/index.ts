import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { event, data } = await req.json();

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
    const from       = Deno.env.get('TWILIO_FROM') || '';
    const ownerPhone = Deno.env.get('OWNER_PHONE') || '';

    if (!ownerPhone) {
      return new Response(JSON.stringify({ error: 'OWNER_PHONE not set in environment' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });

    let message = '';

    if (event === 'new_user') {
      const { name, email, business_type, phone } = data;
      const biz: Record<string, string> = {
        restaurant: 'مطعم', cafe: 'كافيه', salon: 'صالون',
        clinic: 'عيادة', retail: 'متجر تجزئة', other: 'أخرى'
      };
      message =
        `🎉 *مستخدم جديد في 5tars!*\n\n` +
        `👤 الاسم: ${name || 'غير محدد'}\n` +
        `📧 البريد: ${email || 'غير محدد'}\n` +
        `🏢 النشاط: ${biz[business_type] || business_type || 'غير محدد'}\n` +
        `📱 الواتساب: ${phone || 'لم يُدخل'}\n\n` +
        `⏰ ${now}`;
    } else if (event === 'plan_upgrade') {
      const { name, email, plan } = data;
      const planAr: Record<string, string> = {
        lifetime: 'مدى الحياة', lifetime_friend: 'صديق — مدى الحياة',
        trial: 'تجريبي'
      };
      message =
        `💳 *ترقية اشتراك!*\n\n` +
        `👤 ${name || 'مجهول'}\n` +
        `📧 ${email || ''}\n` +
        `📦 الخطة الجديدة: ${planAr[plan] || plan}\n\n` +
        `⏰ ${now}`;
    } else if (event === 'new_complaint') {
      const { business, rating, message: msg, phone: cPhone } = data;
      message =
        `⚠️ *شكوى جديدة عبر 5tars!*\n\n` +
        `🏢 المشروع: ${business || 'غير معروف'}\n` +
        `⭐ التقييم: ${rating || '?'} نجوم\n` +
        `💬 الرسالة: ${msg || 'لا توجد رسالة'}\n` +
        `📱 هاتف العميل: ${cPhone || 'لم يُشارك'}\n\n` +
        `⏰ ${now}`;
    } else if (event === 'system_alert') {
      const { service, issue, details } = data;
      message =
        `🚨 *تنبيه نظام 5tars*\n\n` +
        `⚠️ الخدمة: ${service || 'غير محدد'}\n` +
        `❌ المشكلة: ${issue || 'غير محدد'}\n` +
        `📝 التفاصيل: ${details || '—'}\n\n` +
        `⏰ ${now}\n` +
        `🔗 تحقق: https://supabase.com/dashboard/project/xdmbwtnpadjeinclmffh`;
    } else {
      return new Response(JSON.stringify({ error: `Unknown event: ${event}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Format Saudi phone
    let phone = ownerPhone.replace(/[^0-9+]/g, '');
    if (phone.startsWith('00')) phone = '+' + phone.slice(2);
    else if (phone.startsWith('0')) phone = '+966' + phone.slice(1);
    else if (!phone.startsWith('+')) phone = '+966' + phone;

    const body = new URLSearchParams({
      To:   'whatsapp:' + phone,
      From: from,
      Body: message
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(accountSid + ':' + authToken),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      }
    );

    const result = await res.json();
    return new Response(
      JSON.stringify(result.sid ? { success: true, sid: result.sid } : { success: false, error: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
