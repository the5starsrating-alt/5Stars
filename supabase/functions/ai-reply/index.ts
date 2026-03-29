import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { businessName, businessType, rating, reviewText, dialect } = await req.json()

    const claudeKey = Deno.env.get('CLAUDE_API_KEY')
    if (!claudeKey) throw new Error('CLAUDE_API_KEY not set')

    const dialectMap: Record<string, string> = {
      saudi: 'سعودية خليجية',
      gulf: 'خليجية رسمية',
      formal: 'عربية فصحى مبسطة'
    }

    const systemPrompt = `أنت مساعد متخصص في إدارة سمعة المنشآت التجارية السعودية.
مهمتك كتابة ردود احترافية على تقييمات Google ورسائل واتساب.

قواعدك الثابتة:
- الردود مختصرة دائماً: 3-4 أسطر فقط
- شخصية وودية، تعكس هوية المحل
- تفهم اللهجة السعودية والخليجية والمصرية
- للتقييم الإيجابي: شكر + دعوة للعودة
- للتقييم السلبي: اعتذار + حل + دعوة للتواصل المباشر
- لا تبدأ بـ "عزيزي" أو كلام رسمي مبالغ
- لا تستخدم كلمة "بالطبع" أو "بكل سرور"
- اكتب بطريقة تبدو بشرية وصادقة`

    const userContent = `المحل: ${businessName}
النوع: ${businessType}
التقييم: ${rating} نجوم
التعليق: ${reviewText || 'بدون تعليق'}
اللهجة المطلوبة: ${dialectMap[dialect] || 'سعودية'}

اكتب رداً احترافياً مختصراً (3-4 أسطر فقط)`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    })

    const data = await response.json()
    
    if (!response.ok) throw new Error(data.error?.message || 'Claude API error')

    return new Response(
      JSON.stringify({ reply: data.content[0].text }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
