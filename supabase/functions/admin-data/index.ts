import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const supabaseUrl      = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey  = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ownerEmail       = Deno.env.get('OWNER_EMAIL') || '';

  try {
    // 1. Verify caller JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // 2. Identify caller via their JWT
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // 3. Owner-only gate
    if (!ownerEmail || user.email !== ownerEmail) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    // 4. Service-role client bypasses RLS
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Handle plan update action
    if (req.method === 'POST') {
      const body = await req.json();
      if (body.action === 'update_plan') {
        const { userId, plan } = body;
        if (!userId || !plan) {
          return new Response(JSON.stringify({ error: 'userId and plan required' }), {
            status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
          });
        }
        const validPlans = ['trial', 'lifetime', 'lifetime_friend', 'suspended'];
        if (!validPlans.includes(plan)) {
          return new Response(JSON.stringify({ error: 'Invalid plan' }), {
            status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
          });
        }
        const { error: updateError } = await admin
          .from('profiles')
          .update({ plan })
          .eq('id', userId);
        if (updateError) throw updateError;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
        });
      }
    }

    // 5. Fetch all profiles
    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (profilesError) throw profilesError;

    // 6. Fetch auth users (for last sign-in data)
    const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const authMap: Record<string, { last_sign_in_at: string; email_confirmed_at: string }> = {};
    for (const u of (authData?.users || [])) {
      authMap[u.id] = {
        last_sign_in_at: u.last_sign_in_at || '',
        email_confirmed_at: u.email_confirmed_at || '',
      };
    }

    // Merge last_sign_in and confirmed status into profiles
    const enriched = (profiles || []).map(p => ({
      ...p,
      last_sign_in_at: authMap[p.id]?.last_sign_in_at || null,
      email_confirmed_at: authMap[p.id]?.email_confirmed_at || null,
    }));

    // 7. Fetch API usage stats for current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: usageData } = await admin
      .from('api_usage_logs')
      .select('cost_usd, created_at, input_tokens, output_tokens')
      .gte('created_at', monthStart);

    const monthlyCost   = (usageData || []).reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
    const monthlyTokens = (usageData || []).reduce((sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0);

    // Cost per day — last 7 days
    const dailyCosts: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dailyCosts[d.toISOString().slice(0, 10)] = 0;
    }
    for (const r of (usageData || [])) {
      const day = (r.created_at || '').slice(0, 10);
      if (day in dailyCosts) dailyCosts[day] += Number(r.cost_usd) || 0;
    }
    const costLast7Days = Object.entries(dailyCosts).map(([date, cost]) => ({ date, cost_usd: Number(cost.toFixed(6)) }));

    // 8. Compute summary stats
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const lifetimeCount = enriched.filter(p => p.plan === 'lifetime').length;
    const friendCount   = enriched.filter(p => p.plan === 'lifetime_friend').length;
    const newThisMonth  = enriched.filter(p => p.created_at && new Date(p.created_at) > monthAgo).length;
    const newLastMonth  = enriched.filter(p => p.created_at && new Date(p.created_at) > twoMonthsAgo && new Date(p.created_at) <= monthAgo).length;
    const growthRate    = newLastMonth > 0 ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : 0;

    const stats = {
      total: enriched.length,
      trial_active: enriched.filter(p => p.plan === 'trial' && p.trial_ends && new Date(p.trial_ends) > now).length,
      trial_expired: enriched.filter(p => p.plan === 'trial' && p.trial_ends && new Date(p.trial_ends) <= now).length,
      lifetime: lifetimeCount,
      lifetime_friend: friendCount,
      new_this_month: newThisMonth,
      google_connected: enriched.filter(p => !!p.google_maps_url).length,
      // Revenue stats
      paid_lifetime: lifetimeCount,
      paid_friend: friendCount,
      monthly_revenue_est: lifetimeCount * 997,
      trial_expiring_soon: enriched.filter(p => p.plan === 'trial' && p.trial_ends && new Date(p.trial_ends) > now && new Date(p.trial_ends) <= sevenDaysFromNow).length,
      growth_rate: growthRate,
    };

    const api_costs = {
      monthly_usd: monthlyCost.toFixed(4),
      monthly_sar: (monthlyCost * 3.75).toFixed(2),
      monthly_tokens: monthlyTokens,
      monthly_calls: (usageData || []).length,
      cost_last_7_days: costLast7Days,
    };

    return new Response(JSON.stringify({ profiles: enriched, stats, api_costs }), {
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});
