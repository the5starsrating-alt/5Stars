import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// All calls come from the same production domain
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://www.the5starsrating.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth: require Supabase JWT (user session OR anon key for public diagnosis) ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Decode JWT payload (base64) to check role without full verification
    let isAnonKey = false;
    try {
      const payload = JSON.parse(atob(authHeader.split(' ')[1].split('.')[1]));
      isAnonKey = payload.role === 'anon';
    } catch (_) { /* invalid JWT — will fail getUser below */ }

    // For user sessions: verify via getUser()
    if (!isAnonKey) {
      const supabaseUrl     = Deno.env.get('SUPABASE_URL')!;
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const userClient      = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const body = await req.json();
    const { prompt, model = 'claude-haiku-4-5-20251001', max_tokens = 400, type, email, url: diagUrl } = body;

    // ── DIAGNOSIS RATE LIMITING ──
    if (type === 'diagnosis' && email) {
      const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supabaseUrl, serviceRoleKey);

      // Check if this email has used diagnosis in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await admin
        .from('diagnosis_logs')
        .select('id, created_at')
        .eq('email', email.toLowerCase().trim())
        .gte('created_at', thirtyDaysAgo)
        .limit(1);

      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({
          error: 'لقد استخدمت أداة التشخيص مؤخراً. يمكنك إعادة استخدامها بعد 30 يوماً من تاريخ آخر استخدام.',
          rate_limited: true
        }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Will log after successful call (see below)
    }

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Anon (public diagnosis): stricter limits
    const promptLimit  = isAnonKey ? 2000 : 4000;
    const tokensLimit  = isAnonKey ? 250  : max_tokens;

    if (prompt.length > promptLimit) {
      return new Response(JSON.stringify({ error: 'prompt too long' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: tokensLimit,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const text = data.content?.[0]?.text ?? '';

    // ── LOG API TOKEN USAGE (fire and forget) ──
    {
      const inputTokens = data.usage?.input_tokens || 0;
      const outputTokens = data.usage?.output_tokens || 0;
      // Claude Haiku 4.5: $0.80/M input, $4/M output
      const costUsd = (inputTokens * 0.80 / 1_000_000) + (outputTokens * 4.0 / 1_000_000);

      // Extract userId from JWT if available (non-anon sessions)
      let userId: string | null = null;
      if (!isAnonKey) {
        try {
          const payload = JSON.parse(atob(authHeader.split(' ')[1].split('.')[1]));
          userId = payload.sub || null;
        } catch (_) {}
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      fetch(`${supabaseUrl}/rest/v1/api_usage_logs`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userId,
          model,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: costUsd,
          type: body.type || 'chat'
        })
      }).catch(() => {}); // fire and forget
    }

    // ── LOG DIAGNOSIS USAGE after successful call ──
    if (type === 'diagnosis' && email) {
      const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
      await admin.from('diagnosis_logs').insert({
        email: email.toLowerCase().trim(),
        ip,
        url: diagUrl || ''
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
