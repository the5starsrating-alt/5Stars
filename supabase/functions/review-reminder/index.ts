import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Find requests sent 24h ago with no reminder yet
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: pending } = await sb
    .from('review_requests')
    .select('*, businesses(name, whatsapp_number)')
    .eq('result', 'pending')
    .eq('reminder_sent', false)
    .lt('sent_at', cutoff)

  let sent = 0
  for (const req of (pending || [])) {
    // Send reminder via WhatsApp (would call send-whatsapp internally)
    await sb.from('review_requests').update({
      reminder_sent: true,
      reminder_sent_at: new Date().toISOString()
    }).eq('id', req.id)
    sent++
  }

  return new Response(JSON.stringify({ reminders_sent: sent }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
