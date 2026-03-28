import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = [
  'https://www.the5starsrating.com',
  'https://the5starsrating.com',
  'https://5stars-theta.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
];

function getCorsHeaders(req: Request) {
  const origin  = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function json(data: unknown, status = 200, corsHeaders: Record<string,string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  const cors = getCorsHeaders(req);

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ownerEmail     = Deno.env.get('OWNER_EMAIL') || '';

  try {
    // ── 1. Verify JWT ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Invalid token' }, 401, cors);

    // ── 2. Owner-only gate ──
    if (!ownerEmail || user.email !== ownerEmail) {
      return json({ error: 'Forbidden' }, 403, cors);
    }

    // ── 3. Service-role client (bypasses RLS) ──
    const admin = createClient(supabaseUrl, serviceKey);

    // ══════════════════════════════════
    //  POST actions
    // ══════════════════════════════════
    if (req.method === 'POST') {
      const body = await req.json();

      // ── update_plan ──
      if (body.action === 'update_plan') {
        const { userId, plan } = body;
        if (!userId || !plan) return json({ error: 'userId and plan required' }, 400, cors);
        const validPlans = ['trial', 'lifetime', 'lifetime_friend', 'suspended'];
        if (!validPlans.includes(plan)) return json({ error: 'Invalid plan' }, 400, cors);
        const { error } = await admin.from('profiles').update({ plan, updated_at: new Date().toISOString() }).eq('id', userId);
        if (error) throw error;
        return json({ success: true }, 200, cors);
      }

      // ── extend_trial ──
      if (body.action === 'extend_trial') {
        const { userId, trial_ends } = body;
        if (!userId || !trial_ends) return json({ error: 'userId and trial_ends required' }, 400, cors);
        const { error } = await admin
          .from('profiles')
          .update({ trial_ends, plan: 'trial', updated_at: new Date().toISOString() })
          .eq('id', userId);
        if (error) throw error;
        return json({ success: true }, 200, cors);
      }

      // ── suspend_user ──
      if (body.action === 'suspend_user') {
        const { userId } = body;
        if (!userId) return json({ error: 'userId required' }, 400, cors);
        const { error } = await admin.from('profiles').update({ plan: 'suspended', updated_at: new Date().toISOString() }).eq('id', userId);
        if (error) throw error;
        return json({ success: true }, 200, cors);
      }

      // ── save_settings ──
      if (body.action === 'save_settings') {
        const { settings } = body;
        if (!settings || typeof settings !== 'object') return json({ error: 'settings object required' }, 400, cors);
        const now = new Date().toISOString();
        const upserts = Object.entries(settings).map(([key, value]) => ({
          key,
          value: String(value),
          updated_at: now,
          updated_by: user.email || 'owner',
        }));
        const { error } = await admin
          .from('site_settings')
          .upsert(upserts, { onConflict: 'key' });
        if (error) throw error;
        return json({ success: true }, 200, cors);
      }

      // ── create_coupon ──
      if (body.action === 'create_coupon') {
        const { code, plan, max_uses, expires_at } = body;
        if (!code || !plan) return json({ error: 'code and plan required' }, 400, cors);
        const { error } = await admin.from('coupons').insert({
          code: code.toUpperCase(),
          plan,
          max_uses: max_uses || 1,
          expires_at: expires_at || null,
          is_active: true,
          created_by: user.email || 'owner',
        });
        if (error) throw error;
        return json({ success: true }, 200, cors);
      }

      // ── delete_coupon ──
      if (body.action === 'delete_coupon') {
        const { couponId } = body;
        if (!couponId) return json({ error: 'couponId required' }, 400, cors);
        const { error } = await admin.from('coupons').delete().eq('id', couponId);
        if (error) throw error;
        return json({ success: true }, 200, cors);
      }

      return json({ error: 'Unknown action' }, 400, cors);
    }

    // ══════════════════════════════════
    //  GET — load all admin data
    // ══════════════════════════════════

    // 4. Fetch all profiles
    const { data: profiles, error: profilesErr } = await admin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (profilesErr) throw profilesErr;

    // 5. Enrich with auth.users data (last_sign_in, email_confirmed)
    const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const authMap: Record<string, { last_sign_in_at: string; email_confirmed_at: string }> = {};
    for (const u of (authData?.users || [])) {
      authMap[u.id] = {
        last_sign_in_at:    u.last_sign_in_at    || '',
        email_confirmed_at: u.email_confirmed_at || '',
      };
    }
    const enriched = (profiles || []).map(p => ({
      ...p,
      last_sign_in_at:    authMap[p.id]?.last_sign_in_at    || null,
      email_confirmed_at: authMap[p.id]?.email_confirmed_at || null,
    }));

    // 6. API usage costs (current month)
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const dailyCosts: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      dailyCosts[d.toISOString().slice(0, 10)] = 0;
    }
    let api_costs = {
      monthly_usd: '0.0000', monthly_sar: '0.00',
      monthly_tokens: 0, monthly_calls: 0,
      cost_last_7_days: Object.entries(dailyCosts).map(([date, cost]) => ({ date, cost_usd: cost })),
    };
    try {
      const { data: usage } = await admin
        .from('api_usage_logs')
        .select('cost_usd, created_at, input_tokens, output_tokens')
        .gte('created_at', monthStart);
      const totalCost   = (usage||[]).reduce((s, r) => s + (Number(r.cost_usd)||0), 0);
      const totalTokens = (usage||[]).reduce((s, r) => s + (r.input_tokens||0) + (r.output_tokens||0), 0);
      for (const r of (usage||[])) {
        const day = (r.created_at||'').slice(0,10);
        if (day in dailyCosts) dailyCosts[day] += Number(r.cost_usd)||0;
      }
      api_costs = {
        monthly_usd: totalCost.toFixed(4),
        monthly_sar: (totalCost * 3.75).toFixed(2),
        monthly_tokens: totalTokens,
        monthly_calls: (usage||[]).length,
        cost_last_7_days: Object.entries(dailyCosts).map(([date, cost]) => ({ date, cost_usd: Number(cost.toFixed(6)) })),
      };
    } catch (_) { /* api_usage_logs might not exist yet */ }

    // 7. Compute stats
    const sevenDaysFromNow = new Date(now.getTime() + 7  * 86400000);
    const monthAgo         = new Date(now.getTime() - 30 * 86400000);
    const twoMonthsAgo     = new Date(now.getTime() - 60 * 86400000);
    const lifetimeCount    = enriched.filter(p => p.plan === 'lifetime').length;
    const friendCount      = enriched.filter(p => p.plan === 'lifetime_friend').length;
    const newThisMonth     = enriched.filter(p => p.created_at && new Date(p.created_at) > monthAgo).length;
    const newLastMonth     = enriched.filter(p => p.created_at && new Date(p.created_at) > twoMonthsAgo && new Date(p.created_at) <= monthAgo).length;
    const stats = {
      total:               enriched.length,
      trial_active:        enriched.filter(p => p.plan === 'trial' && p.trial_ends && new Date(p.trial_ends) > now).length,
      trial_expired:       enriched.filter(p => p.plan === 'trial' && p.trial_ends && new Date(p.trial_ends) <= now).length,
      lifetime:            lifetimeCount,
      lifetime_friend:     friendCount,
      new_this_month:      newThisMonth,
      new_this_week:       enriched.filter(p => p.created_at && new Date(p.created_at) > new Date(now.getTime()-7*86400000)).length,
      active_today:        enriched.filter(p => p.last_sign_in_at && new Date(p.last_sign_in_at).toDateString() === now.toDateString()).length,
      google_connected:    enriched.filter(p => !!p.google_maps_url).length,
      paid_lifetime:       lifetimeCount,
      paid_friend:         friendCount,
      monthly_revenue_est: lifetimeCount * 997,
      trial_expiring_soon: enriched.filter(p => p.plan==='trial' && p.trial_ends && new Date(p.trial_ends)>now && new Date(p.trial_ends)<=sevenDaysFromNow).length,
      growth_rate:         newLastMonth > 0 ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : 0,
    };

    // 8. Site settings
    const { data: settingsRows } = await admin.from('site_settings').select('key, value');
    const site_settings: Record<string, string> = {};
    for (const row of (settingsRows || [])) {
      site_settings[row.key] = row.value;
    }

    // 9. Coupons
    const { data: coupons } = await admin
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });

    return json({ profiles: enriched, stats, api_costs, site_settings, coupons: coupons || [] }, 200, cors);

  } catch (e) {
    return json({ error: (e as Error).message }, 500, cors);
  }
});
