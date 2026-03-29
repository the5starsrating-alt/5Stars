import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { phone, templateName, variables, businessId, type } = await req.json()

    const waToken = Deno.env.get('WHATSAPP_TOKEN')
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_ID')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const sb = createClient(supabaseUrl, supabaseKey)

    // Build components from variables array
    const components = variables.length > 0 ? [{
      type: 'body',
      parameters: variables.map((v: string) => ({ type: 'text', text: v }))
    }] : []

    let waResult = { success: false, messageId: null as string | null }

    if (waToken && phoneNumberId) {
      const waResponse = await fetch(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${waToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone.replace(/\D/g, ''),
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'ar' },
              components
            }
          })
        }
      )
      const waData = await waResponse.json()
      waResult = {
        success: waResponse.ok,
        messageId: waData.messages?.[0]?.id || null
      }
    } else {
      // Simulation mode if no WA credentials
      waResult = { success: true, messageId: 'sim_' + Date.now() }
    }

    // Log to Supabase
    if (businessId) {
      await sb.from('whatsapp_messages').insert({
        business_id: businessId,
        phone,
        template_name: templateName,
        variables,
        type,
        status: waResult.success ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
        whatsapp_message_id: waResult.messageId
      })
    }

    return new Response(
      JSON.stringify(waResult),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
