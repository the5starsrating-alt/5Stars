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
    const { to, message } = await req.json();
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
    const from       = Deno.env.get('TWILIO_FROM') || '';
    let phone = to.replace(/[^0-9+]/g, '');
    if (phone.startsWith('0')) phone = '+966' + phone.slice(1);
    if (!phone.startsWith('+')) phone = '+966' + phone;
    const body = new URLSearchParams({ To: 'whatsapp:' + phone, From: from, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa(accountSid + ':' + authToken), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await res.json();
    return new Response(JSON.stringify(data.sid ? { success: true, sid: data.sid } : { success: false, error: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
