import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Weekly Report Function
// Triggered weekly via cron (UltraMsg integration to be configured)
// Prepares weekly summaries for all active users and logs them
// When UltraMsg is connected, will send WhatsApp messages automatically

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    }> = [];

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
      console.log(`[weekly-report] Phone: ${profile.phone}`);
      console.log(`[weekly-report] Message:\n${message}`);

      // TODO: Send via UltraMsg when configured
      // const ultraMsgToken = Deno.env.get('ULTRAMSG_TOKEN');
      // const ultraMsgInstance = Deno.env.get('ULTRAMSG_INSTANCE');
      // if (ultraMsgToken && ultraMsgInstance) {
      //   const res = await fetch(`https://api.ultramsg.com/${ultraMsgInstance}/messages/chat`, {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      //     body: new URLSearchParams({
      //       token: ultraMsgToken,
      //       to: profile.phone,
      //       body: message
      //     })
      //   });
      //   const data = await res.json();
      //   sent = data.sent === 'true';
      // }

      reports.push({
        userId: profile.id,
        bizName: profile.full_name || 'N/A',
        phone: profile.phone,
        message,
        sent: false // will be true when UltraMsg is connected
      });
    }

    console.log(`[weekly-report] Processed ${reports.length} reports`);

    return new Response(JSON.stringify({
      success: true,
      processed: reports.length,
      reports: reports.map(r => ({
        userId: r.userId,
        bizName: r.bizName,
        sent: r.sent
      }))
    }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('[weekly-report] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});
