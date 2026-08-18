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
    const { store_id, offer_id, phone_number, job_id, otp_code, first_name, last_name, email } = await req.json();

    if (!store_id || !offer_id || !job_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: store_id, offer_id, job_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!phone_number) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: phone_number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Clipping coupon: offer_id=${offer_id}, store_id=${store_id}, job_id=${job_id}, has_otp=${!!otp_code}`);

    const payload: Record<string, string> = { store_id, offer_id, phone_number, job_id };
    if (otp_code) {
      payload.otp_code = otp_code;
      if (first_name) payload.first_name = first_name;
      if (last_name)  payload.last_name  = last_name;
      if (email)      payload.email      = email;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 110000);

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/clip-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

    console.log('clip-single response:', JSON.stringify(result));

    const status = result.auth_required ? 200 : (response.ok ? 200 : response.status);

    return new Response(JSON.stringify({ job_id, ...result }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    console.error('Error clipping coupon:', error);
    return new Response(
      JSON.stringify({
        error: isTimeout
          ? 'External API timeout — service may be starting up, try again'
          : (error.message || 'Failed to clip coupon'),
        success: false,
      }),
      { status: isTimeout ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
