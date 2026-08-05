// Setup type definitions for built-in Supabase Runtime APIs
// Edge Function para enviar notificaciones personalizadas vía Expo en Supabase

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

// Configuración y variables de entorno
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EVENTS_FUNCTION_API_KEY = Deno.env.get("EVENTS_FUNCTION_API_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "X-Api-Key, Content-Type, Accept, Origin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// Utilidad para enviar notificaciones a través de Expo
async function sendExpoNotification(
  pushTokens: string[],
  notif: { title: string; body: string; data: any },
) {
  if (!pushTokens || pushTokens.length === 0) return;

  // Filtrar tokens válidos (deben comenzar con ExponentPushToken o ExpoPushToken)
  const validTokens = pushTokens.filter(
    (token) =>
      typeof token === "string" &&
      (token.startsWith("ExponentPushToken") ||
        token.startsWith("ExpoPushToken")),
  );
  if (validTokens.length === 0) return;

  // Construir los mensajes
  const messages = validTokens.map((token) => ({
    to: token,
    sound: "default",
    title: notif.title || "🔔 Notificación personalizada",
    body: notif.body || "",
    data: notif.data || {},
  }));

  // Enviar notificaciones en chunks recomendados
  const chunkSize = 100;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Nota: siempre usa un token de servidor seguro. Evita hardcodear; usa secretos si es necesario.
          Authorization: `Bearer ${Deno.env.get("EXPO_ACCESS_TOKEN") ?? ""}`,
        },
        body: JSON.stringify(chunk),
      });
      const text = await res.text();
      try {
        const json = text ? JSON.parse(text) : null;
        if (!res.ok) {
          console.error("❌ Expo API error", res.status, json);
        }
      } catch (parseErr) {
        console.error("❌ Error parsing Expo response:", parseErr, "raw:", text);
      }
    } catch (err) {
      console.error("❌ Error al enviar notificación:", err);
    }
  }
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Solo permitir POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  // Validación API Key
  const apiKey = (req.headers.get("X-Api-Key") || "").trim();
  if (!apiKey || apiKey !== (EVENTS_FUNCTION_API_KEY || "").trim()) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", message: "Invalid or missing X-Api-Key" }),
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  try {
    // Esperar un body { message: string, data: object, title?: string }
    const { message, data, title } = await req.json();

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid message" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Obtener todos los push tokens desde profiles.push_token (no nulos, no vacíos)
    const { data: users, error: usersErr } = await supabase
      .from("profiles")
      .select("push_token")
      .not("push_token", "is", null)
      .neq("push_token", "");
    if (usersErr) throw usersErr;

    const pushTokens = (users ?? []).map((u: any) => u.push_token).filter(Boolean);

    // Enviar notificaciones
    await sendExpoNotification(pushTokens, {
      title: title || "🔔 Notificación personalizada",
      body: message,
      data: data || {},
    });

    return new Response(
      JSON.stringify({ success: true, notified_count: pushTokens.length }),
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (err: any) {
    console.error("❌ Error interno:", err);
    return new Response(
      JSON.stringify({ error: "Internal Server Error", message: err?.message ?? String(err) }),
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
});
