import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Weekly Report Function
// Triggered weekly via cron — sends WhatsApp reports to all active users via UltraMsg

const ALLOWED_ORIGINS = [
  'https://www.the5starsrating.com',
  'https://the5starsrating.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function buildReportMessage(profile: {
  full_name?: string;
  new_reviews?: number;
  avg_rating?: number;
  auto_replies?: number;
  prev_new_reviews?: number;
}): string {
  const bizName = profile.full_name || 'مشروعك';
  const newReviews = profile.new_reviews ?? 0;
  const avgRating = (profile.avg_rating ?? 0).toFixed(1);
  const autoReplies = profile.auto_replies ?? 0;
  const prevNewReviews = profile.prev_new_reviews ?? 0;

  let changePct = 0;
  if (prevNewReviews > 0) {
    changePct = Math.round(((newReviews - prevNewReviews) / prevNewReviews) * 100);
  } else if (newReviews > 0) {
    changePct = 100;
  }

  const changeStr = changePct >= 0 ? `+${changePct}%` : `${changePct}%`;

  return `📊 تقريرك الأسبوعي — 5tars

🏢 ${bizName}

هذا الأسبوع:
✅ تقييمات جديدة: ${newReviews}
⭐ متوسط التقييم: ${avgRating}
💬 ردود تلقائية: ${autoReplies}

📈 مقارنة بالأسبوع الماضي: ${changeStr}

🔗 لوحة التحكم: https://www.the5starsrating.com/dashboard.html
─────────────────
5tars — منصة التقييمات الذكية`;
}

async function sendWhatsApp(instanceId: string, token: string, to: string, message: string): Promise<{ success: boolean; id?: string; error?: string }> {
  // Format phone number
  let phone = to.replace(/\D/g, '');
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
    return { success: true, id: result.id };
  }
  return { success: false, error: result.error || 'Failed to send' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const instanceId = Deno.env.get('ULTRAMSG_INSTANCE_ID') || '';
  const token = Deno.env.get('ULTRAMSG_TOKEN') || '';

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Fetch all active users (plan != 'suspended')
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, full_name, phone, plan, google_maps_url')
      .neq('plan', 'suspended')
      .not('phone', 'is', null);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError.message);
      return new Response(JSON.stringify({ error: profilesError.message }), {
        status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    const reports: Array<{
      userId: string;
      bizName: string;
      phone: string;
      message: string;
      sent: boolean;
      sendError?: string;
    }> = [];

    const ultraMsgReady = !!(instanceId && token);

    for (const profile of (profiles || [])) {
      if (!profile.phone) continue;

      // In a real implementation, query actual review stats from DB
      // For now, use placeholder values — real data comes from Google Business API
      const reportData = {
        full_name: profile.full_name,
        new_reviews: 0,        // TODO: fetch from reviews table
        avg_rating: 0,          // TODO: calculate from reviews
        auto_replies: 0,        // TODO: count from replies table
        prev_new_reviews: 0     // TODO: last week's count
      };

      const message = buildReportMessage(reportData);

      console.log(`[weekly-report] Preparing report for user ${profile.id} (${profile.full_name})`);

      let sent = false;
      let sendError: string | undefined;

      if (ultraMsgReady) {
        try {
          const sendResult = await sendWhatsApp(instanceId, token, profile.phone, message);
          sent = sendResult.success;
          if (!sendResult.success) {
            sendError = sendResult.error;
            console.error(`[weekly-report] Failed to send to ${profile.id}: ${sendError}`);
          }
        } catch (sendErr) {
          sendError = (sendErr as Error).message;
          console.error(`[weekly-report] Error sending to ${profile.id}: ${sendError}`);
        }
      } else {
        console.log(`[weekly-report] UltraMsg not configured — skipping send for ${profile.id}`);
        console.log(`[weekly-report] Message:\n${message}`);
      }

      reports.push({
        userId: profile.id,
        bizName: profile.full_name || 'N/A',
        phone: profile.phone,
        message,
        sent,
        ...(sendError ? { sendError } : {})
      });
    }

    console.log(`[weekly-report] Processed ${reports.length} reports, sent ${reports.filter(r => r.sent).length}`);

    return new Response(JSON.stringify({
      success: true,
      processed: reports.length,
      sent: reports.filter(r => r.sent).length,
      ultramsg_configured: ultraMsgReady,
      reports: reports.map(r => ({
        userId: r.userId,
        bizName: r.bizName,
        sent: r.sent,
        ...(r.sendError ? { error: r.sendError } : {})
      }))
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('[weekly-report] Error:', (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});
