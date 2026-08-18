import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const supabaseClient = (await import("jsr:@supabase/supabase-js@2")) as any;

    // Create a client with the JWT so RLS applies to this user
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    // Client with user JWT for RLS deletes on public tables
    const { createClient } = supabaseClient;
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    // Service client for deleting auth user
    const serviceClient = createClient(url, service);

    // Identify current user
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: userErr?.message || "No user" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const userId = userRes.user.id;

    // Delete dependent data first
    await Promise.allSettled([
      userClient.from("user_coupon_clipping").delete().eq("user_id", userId),
      userClient.from("loyalty_cards").delete().eq("user_id", userId),
    ]);

    // Delete profile row
    const { error: profileDeleteError } = await userClient
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileDeleteError) {
      return new Response(JSON.stringify({ error: profileDeleteError.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Delete auth user (requires service role)
    const { error: adminDeleteErr } = await serviceClient.auth.admin.deleteUser(userId);
    if (adminDeleteErr) {
      return new Response(JSON.stringify({ error: adminDeleteErr.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
