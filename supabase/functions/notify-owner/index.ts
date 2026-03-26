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

    const instanceId = Deno.env.get('ULTRAMSG_INSTANCE_ID') || '';
    const token      = Deno.env.get('ULTRAMSG_TOKEN') || '';
    const ownerPhone = Deno.env.get('OWNER_PHONE') || '';

    if (!ownerPhone) {
      return new Response(JSON.stringify({ error: 'OWNER_PHONE not set in environment' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const now = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });

    let message = '';

    if (event === 'new_user' || event === 'new_subscriber') {
      const { name, email, business_type, phone, plan } = data;
      const biz: Record<string, string> = {
        restaurant: 'مطعم', cafe: 'كافيه', salon: 'صالون',
        clinic: 'عيادة', retail: 'متجر تجزئة', other: 'أخرى'
      };
      message =
        `🎉 مشترك جديد!\n` +
        `👤 الاسم: ${name || 'غير محدد'}\n` +
        `📧 الإيميل: ${email || 'غير محدد'}\n` +
        `📦 الباقة: ${plan || business_type ? (biz[business_type] || business_type || 'trial') : 'trial'}\n` +
        (phone ? `📱 الواتساب: ${phone}\n` : '') +
        `\n⏰ ${now}`;
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
    } else if (event === 'new_complaint' || event === 'new_review') {
      const { business, rating, message: msg, phone: cPhone } = data;
      message =
        `⭐ تقييم جديد!\n` +
        `🏢 المشروع: ${business || 'غير معروف'}\n` +
        `⭐ النجوم: ${rating || '?'}\n` +
        `💬 التعليق: ${msg || 'لا توجد رسالة'}\n` +
        (cPhone ? `📱 هاتف العميل: ${cPhone}\n` : '') +
        `\n⏰ ${now}`;
    } else if (event === 'system_error' || event === 'system_alert') {
      const { service, issue, details, key, error: errMsg } = data;
      message =
        `⚠️ خطأ في النظام!\n` +
        `🔑 المفتاح: ${key || service || 'غير محدد'}\n` +
        `❌ الخطأ: ${errMsg || issue || 'غير محدد'}\n` +
        (details ? `📝 التفاصيل: ${details}\n` : '') +
        `\n⏰ ${now}\n` +
        `🔗 تحقق: https://supabase.com/dashboard/project/xdmbwtnpadjeinclmffh`;
    } else {
      return new Response(JSON.stringify({ error: `Unknown event: ${event}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!instanceId || !token) {
      console.error('UltraMsg credentials not configured');
      // Log the message but don't fail hard — owner should still get notified once configured
      console.log('[notify-owner] Message would have been sent:', message);
      return new Response(JSON.stringify({ error: 'WhatsApp not configured', message }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Format Saudi phone
    let phone = ownerPhone.replace(/\D/g, '');
    if (phone.startsWith('05')) phone = '966' + phone.slice(1);
    if (!phone.startsWith('966') && !phone.startsWith('+')) phone = '966' + phone;
    phone = phone.replace('+', '');

    const formData = new URLSearchParams();
    formData.append('token', token);
    formData.append('to', phone);
    formData.append('body', message);

    const res = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    const result = await res.json();
    if (result.sent === true || result.id) {
      return new Response(JSON.stringify({ success: true, id: result.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else {
      throw new Error(result.error || 'Failed to send message');
    }

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
