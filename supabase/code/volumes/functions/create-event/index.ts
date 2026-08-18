import { createClient } from "npm:@supabase/supabase-js@2.47.10";
// ✅ Variables de entorno
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EVENTS_FUNCTION_API_KEY = Deno.env.get("EVENTS_FUNCTION_API_KEY");
// ✅ Cliente admin
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// ✅ CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "X-Api-Key, Content-Type, Accept, Origin",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// ✅ Enviar notificación a Expo usando fetch en vez del SDK
async function sendExpoNotification(event, pushTokens) {
  if (!pushTokens || pushTokens.length === 0) return;
  // Validar tokens (Expo tokens suelen empezar con ExponentPushToken o ExpoPushToken)
  const validTokens = pushTokens.filter((token)=>typeof token === "string" && (token.startsWith("ExponentPushToken") || token.startsWith("ExpoPushToken")));
  if (validTokens.length === 0) return;
  const messages = validTokens.map((token)=>({
      to: token,
      sound: "default",
      title: "🎉 New Event Alert!",
      body: `${event.event_name} is coming up on ${new Date(event.event_date).toLocaleDateString()}. Don’t miss out — tap to see details!`,
      data: {
        event_id: event.id,
        event_image: event.event_image,
        screen: "events"
      }
    }));
  const chunkSize = 100; // Expo recomienda enviar hasta 100 mensajes por petición
  const tickets = [];
  for(let i = 0; i < messages.length; i += chunkSize){
    const chunk = messages.slice(i, i + chunkSize);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer dcI8i3Hjor9dmwSU_RKIwGNMZf0Ow6ljQVWtkUKU"
        },
        body: JSON.stringify(chunk)
      });
      const text = await res.text();
      try {
        const json = text ? JSON.parse(text) : null;
        if (json) {
          if (Array.isArray(json)) tickets.push(...json);
          else tickets.push(json);
        } else {
          console.warn("⚠️ Expo response could not be parsed as JSON:", text);
        }
      } catch (parseErr) {
        console.error("❌ Error parsing Expo response:", parseErr, "raw:", text);
      }
      if (!res.ok) {
        console.error("❌ Expo API returned non-OK status:", res.status);
      }
    } catch (err) {
      console.error("❌ Error al enviar notificación:", err);
    }
  }
  console.log("🎫 Tickets generados:", tickets);
}
// ✅ Edge function principal
Deno.serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  // Solo POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // Validación API Key
  const apiKey = (req.headers.get("X-Api-Key") || "").trim();
  console.info("🔑 X-Api-Key recibida:", apiKey);
  console.info("🔐 EVENTS_FUNCTION_API_KEY esperada:", (EVENTS_FUNCTION_API_KEY || "").trim());
  if (!apiKey || apiKey !== (EVENTS_FUNCTION_API_KEY || "").trim()) {
    return new Response(JSON.stringify({
      error: "Unauthorized",
      message: "Invalid or missing X-Api-Key"
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    // Parsear body
    const { id } = await req.json();
    if (!id) {
      return new Response(JSON.stringify({
        error: "Missing event id"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Buscar información del evento
    const { data: event, error: eventErr } = await supabase.from("events").select("*").eq("id", id).single();
    if (eventErr || !event) {
      return new Response(JSON.stringify({
        error: "Event not found",
        details: eventErr?.message
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Obtener push tokens de usuarios
    const { data: users, error: usersErr } = await supabase.from("profiles").select("push_token").not("push_token", "is", null).neq("push_token", "");
    if (usersErr) throw usersErr;
    const pushTokens = users.map((u)=>u.push_token).filter(Boolean);
    // Enviar notificación
    await sendExpoNotification(event, pushTokens);
    return new Response(JSON.stringify({
      success: true,
      event_id: id,
      notified_users: pushTokens.length
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("❌ Error interno:", err);
    return new Response(JSON.stringify({
      error: "Internal Server Error",
      message: err.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
