import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Support dept from query string (QR scan) or from JSON body
    const url = new URL(req.url);
    let dept: string | null = url.searchParams.get("dept");
    let device_fingerprint: string | null = null;
    let user_id: string | null = null;
    let user_name: string | null = null;
    let user_email: string | null = null;
    let user_phone: string | null = null;
    // Also support legacy session_id
    let session_id: string | null = url.searchParams.get("session_id");

    if (req.method === "POST") {
      const body = await req.json();
      dept = dept || body.dept || null;
      session_id = session_id || body.session_id || null;
      device_fingerprint = body.device_fingerprint || null;
      user_id = body.user_id || null;
      user_name = body.user_name || null;
      user_email = body.user_email || null;
      user_phone = body.user_phone || null;
    }

    if (!device_fingerprint) {
      return new Response(
        JSON.stringify({ success: false, error: "missing_params", message: "device_fingerprint is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!dept && !session_id) {
      return new Response(
        JSON.stringify({ success: false, error: "missing_params", message: "dept or session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to bypass RLS for the atomic function
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let data, error;

    if (dept) {
      // New flow: by department code
      ({ data, error } = await supabase.rpc("take_turn_by_dept", {
        p_department_code: dept,
        p_device_fingerprint: device_fingerprint,
        p_user_id: user_id || null,
        p_user_name: user_name || "Anonymous",
        p_user_email: user_email || null,
        p_user_phone: user_phone || null,
      }));
    } else {
      // Legacy flow: by session_id
      ({ data, error } = await supabase.rpc("take_turn", {
        p_session_id: session_id,
        p_device_fingerprint: device_fingerprint,
        p_user_id: user_id || null,
        p_user_name: user_name || "Anonymous",
        p_user_email: user_email || null,
        p_user_phone: user_phone || null,
      }));
    }

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: "rpc_error", message: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: "server_error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
