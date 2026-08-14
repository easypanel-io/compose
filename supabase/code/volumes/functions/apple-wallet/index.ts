// @ts-nocheck Deno edge function, not resolvable by Node/TS tooling
// eslint-disable-next-line import/no-unresolved
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("ApplePass ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const appleToken = authHeader.slice(10).trim();

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const deviceMatch = path.match(
    /\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/,
  );

  // POST /v1/devices/{deviceId}/registrations/{passTypeIdentifier}/{serialNumber}
  if (req.method === "POST" && deviceMatch) {
    const { data: card } = await supabaseAdmin
      .from("loyalty_cards")
      .select("id")
      .eq("apple_wallet_token", appleToken)
      .maybeSingle();

    if (!card) return new Response("Unauthorized", { status: 401 });

    return new Response(null, { status: 201 });
  }

  // DELETE /v1/devices/{deviceId}/registrations/{passTypeIdentifier}/{serialNumber}
  if (req.method === "DELETE" && deviceMatch) {
    const { data: card } = await supabaseAdmin
      .from("loyalty_cards")
      .select("id")
      .eq("apple_wallet_token", appleToken)
      .maybeSingle();

    if (!card) return new Response("Unauthorized", { status: 401 });

    await supabaseAdmin
      .from("loyalty_cards")
      .update({ apple_wallet_token: null })
      .eq("id", card.id);

    return new Response(null, { status: 200 });
  }

  return new Response("Not Found", { status: 404 });
});
