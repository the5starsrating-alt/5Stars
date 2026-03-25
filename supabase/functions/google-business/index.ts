import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Google Business Profile API integration
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET env vars
// User must complete OAuth flow to connect their Google Business account

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    // Verify user auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({
        error: 'Google Business API not configured yet',
        setup_required: true,
        message: 'يرجى إعداد Google Cloud credentials أولاً'
      }), {
        status: 503, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    if (action === 'get_auth_url') {
      // Generate OAuth URL for user to connect their Google Business account
      const redirectUri = `https://www.the5starsrating.com/auth-callback.html?type=google_business`;
      const scopes = [
        'https://www.googleapis.com/auth/business.manage',
      ].join(' ');
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `access_type=offline&` +
        `state=${user.id}`;

      return new Response(JSON.stringify({ auth_url: authUrl }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    if (action === 'get_reviews') {
      // Fetch real reviews using stored access token
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const { data: profile } = await admin
        .from('profiles')
        .select('google_access_token, google_account_id')
        .eq('id', user.id)
        .single();

      if (!profile?.google_access_token) {
        return new Response(JSON.stringify({
          error: 'Google Business not connected',
          connected: false
        }), {
          status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
        });
      }

      // Fetch reviews from Google Business Profile API
      const reviewsRes = await fetch(
        `https://mybusiness.googleapis.com/v4/accounts/${profile.google_account_id}/locations/-/reviews`,
        {
          headers: { 'Authorization': 'Bearer ' + profile.google_access_token }
        }
      );
      const reviewsData = await reviewsRes.json();

      return new Response(JSON.stringify({
        connected: true,
        reviews: reviewsData.reviews || [],
        total: reviewsData.totalReviewCount || 0,
        average_rating: reviewsData.averageRating || 0
      }), {
        headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
    });
  }
});
