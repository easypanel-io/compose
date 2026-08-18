import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

/**
 * Send Expo push notifications to a list of push tokens.
 */
async function sendExpoNotification(
  pushTokens: string[],
  notif: { title: string; body: string; data: Record<string, unknown> },
) {
  const validTokens = pushTokens.filter(
    (token) =>
      typeof token === "string" &&
      (token.startsWith("ExponentPushToken") || token.startsWith("ExpoPushToken")),
  );
  if (validTokens.length === 0) return;

  const messages = validTokens.map((token) => ({
    to: token,
    sound: "default",
    title: notif.title,
    body: notif.body,
    data: notif.data,
  }));

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("EXPO_ACCESS_TOKEN") ?? ""}`,
      },
      body: JSON.stringify(messages),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("Expo API error", res.status, text);
    } else {
      console.log("Expo push sent successfully to", validTokens.length, "tokens");
    }
  } catch (err) {
    console.error("Error sending Expo push:", err);
  }
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ error: "Missing session_id" }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Get all waiting turns for this session, ordered by turn_number
    const { data: waitingTurns, error: turnsErr } = await supabase
      .from("queue_turns")
      .select("id, turn_number, user_id, user_name, device_fingerprint")
      .eq("session_id", session_id)
      .eq("status", "waiting")
      .order("turn_number", { ascending: true });

    if (turnsErr) {
      console.error("Error fetching waiting turns:", turnsErr);
      return new Response(
        JSON.stringify({ error: "Database error", message: turnsErr.message }),
        { status: 500, headers: corsHeaders },
      );
    }

    // Position 3 = index 2 (2 people ahead)
    // We notify the person at index 2 (third in line)
    const NOTIFY_POSITION_INDEX = 2;

    if (!waitingTurns || waitingTurns.length <= NOTIFY_POSITION_INDEX) {
      // Not enough people in the queue to notify position 3
      return new Response(
        JSON.stringify({ success: true, notified: false, reason: "queue_too_short" }),
        { status: 200, headers: corsHeaders },
      );
    }

    const turnToNotify = waitingTurns[NOTIFY_POSITION_INDEX];

    // Only send push notification if the user is registered (has user_id)
    if (!turnToNotify.user_id) {
      return new Response(
        JSON.stringify({ success: true, notified: false, reason: "anonymous_user" }),
        { status: 200, headers: corsHeaders },
      );
    }

    // Look up the push token
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("push_token, prefered_language")
      .eq("id", turnToNotify.user_id)
      .single();

    if (profileErr || !profile?.push_token) {
      return new Response(
        JSON.stringify({ success: true, notified: false, reason: "no_push_token" }),
        { status: 200, headers: corsHeaders },
      );
    }

    // Send the notification
    const isSpanish = profile.prefered_language === "es";
    const title = isSpanish
      ? "¡Tu turno se acerca!"
      : "Your turn is coming up!";
    const body = isSpanish
      ? `Solo quedan 2 personas delante de ti. Tu turno es #${turnToNotify.turn_number}.`
      : `Only 2 people ahead of you. Your turn is #${turnToNotify.turn_number}.`;

    await sendExpoNotification([profile.push_token], {
      title,
      body,
      data: {
        screen: "queue",
        turn_id: turnToNotify.id,
        turn_number: String(turnToNotify.turn_number),
        type: "queue_position",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        notified: true,
        turn_number: turnToNotify.turn_number,
        user_name: turnToNotify.user_name,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (err: any) {
    console.error("Internal error:", err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error", message: err?.message ?? String(err) }),
      { status: 500, headers: corsHeaders },
    );
  }
});
