import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGIN = 'https://www.the5starsrating.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth: require valid Supabase JWT ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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
    // ─────────────────────────────────────

    const { to, message } = await req.json();

    if (!to || !message) {
      return new Response(JSON.stringify({ error: 'to and message are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Enforce message length limit
    if (message.length > 1600) {
      return new Response(JSON.stringify({ error: 'message too long' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // UltraMsg API
    const instanceId = Deno.env.get('ULTRAMSG_INSTANCE_ID') || '';
    const token = Deno.env.get('ULTRAMSG_TOKEN') || '';

    if (!instanceId || !token) {
      console.error('UltraMsg credentials not configured');
      return new Response(JSON.stringify({ error: 'WhatsApp not configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Format phone number (ensure it starts with country code)
    let phone = to.replace(/\D/g, '');
    if (phone.startsWith('05')) phone = '966' + phone.slice(1);
    if (!phone.startsWith('966') && !phone.startsWith('+')) phone = '966' + phone;
    phone = phone.replace('+', '');

    const formData = new URLSearchParams();
    formData.append('token', token);
    formData.append('to', phone);
    formData.append('body', message);

    const response = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });

    const result = await response.json();
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
