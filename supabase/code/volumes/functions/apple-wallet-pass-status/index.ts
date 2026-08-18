// @ts-nocheck Deno edge function, not resolvable by Node/TS tooling
// eslint-disable-next-line import/no-unresolved
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = authHeader.slice(7);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: card } = await supabase
    .from("loyalty_cards")
    .select("apple_wallet_token")
    .eq("user_id", user.id)
    .maybeSingle();

  const active = !!card?.apple_wallet_token;

  return new Response(JSON.stringify({ active }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
