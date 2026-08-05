import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const API_BASE_URL = 'https://xcirculars-coupons-api.7panny.easypanel.host';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, phone_number } = await req.json();

    if (!store_id || !phone_number) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: store_id, phone_number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Clipping all coupons: store_id=${store_id}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 110000);

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/clip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id, phone_number }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { error: text, success: false };
    }

    console.log('clip-all response:', JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      status: response.ok ? 200 : response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    console.error('Error clipping all coupons:', error);
    return new Response(
      JSON.stringify({
        error: isTimeout
          ? 'External API timeout — service may be starting up, try again'
          : (error.message || 'Failed to clip all coupons'),
        success: false,
      }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
