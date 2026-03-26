# إعداد WhatsApp (UltraMsg)

بعد الحصول على Instance ID و Token من app.ultramsg.com:

curl -X POST "https://api.supabase.com/v1/projects/xdmbwtnpadjeinclmffh/secrets" \
  -H "Authorization: Bearer sbp_85f1b83b1aeaab33cdbcd843a90d3ba126476a82" \
  -H "Content-Type: application/json" \
  -d '[
    {"name":"ULTRAMSG_INSTANCE_ID","value":"YOUR_INSTANCE_ID"},
    {"name":"ULTRAMSG_TOKEN","value":"YOUR_TOKEN"}
  ]'
