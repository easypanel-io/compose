import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let session_id: string | null = null;
    let device_fingerprint: string | null = null;

    if (req.method === "GET") {
      session_id = url.searchParams.get("session_id");
      device_fingerprint = url.searchParams.get("device_fingerprint");
    } else {
      const body = await req.json();
      session_id = body.session_id;
      device_fingerprint = body.device_fingerprint;
    }

    if (!session_id) {
      return new Response(
        JSON.stringify({ success: false, error: "missing_params", message: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get session info
    const { data: session, error: sessionError } = await supabase
      .from("queue_sessions")
      .select("*")
      .eq("id", session_id)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ success: false, error: "session_not_found", message: "Queue session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all turns for this session
    const { data: turns, error: turnsError } = await supabase
      .from("queue_turns")
      .select("*")
      .eq("session_id", session_id)
      .order("turn_number", { ascending: true });

    if (turnsError) {
      return new Response(
        JSON.stringify({ success: false, error: "turns_error", message: turnsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If device_fingerprint provided, find the specific turn
    let myTurn = null;
    if (device_fingerprint) {
      myTurn = (turns || []).find((t: any) => t.device_fingerprint === device_fingerprint) || null;
    }

    // Current serving turn
    const servingTurn = (turns || []).find((t: any) => t.status === "serving") || null;
    const waitingTurns = (turns || []).filter((t: any) => t.status === "waiting");

    return new Response(
      JSON.stringify({
        success: true,
        session: {
          id: session.id,
          title: session.title,
          description: session.description,
          is_active: session.is_active,
          current_turn: session.current_turn,
          created_at: session.created_at,
        },
        turns: turns || [],
        my_turn: myTurn,
        currently_serving: servingTurn,
        waiting_count: waitingTurns.length,
        total_turns: (turns || []).length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: "server_error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
