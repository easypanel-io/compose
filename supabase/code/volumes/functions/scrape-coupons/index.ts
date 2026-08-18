import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const API_BASE_URL = 'https://food-universe-api-scrap.onrender.com';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { store_id, loyalty_card } = await req.json();

    if (!store_id || !loyalty_card) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: store_id, loyalty_card' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Scraping coupons for loyalty card ${loyalty_card}`);

    const response = await fetch(
      `${API_BASE_URL}/api/scrape?store_id=${store_id}&loyalty_card=${loyalty_card}`,
      { method: "GET" }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Scrape coupons result:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error scraping coupons:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to scrape coupons',
        success: false
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
