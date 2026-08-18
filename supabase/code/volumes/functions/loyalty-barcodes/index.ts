import { createClient } from "npm:@supabase/supabase-js@2.47.10";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = "barcodes";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Origin",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function sanitizeFilename(name) {
  return name.replace(/[^\w.\-]/g, "_");
}
function inferMimeFromName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json({
    error: "method_not_allowed"
  }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({
      error: "missing_bearer"
    }, 401);
  }
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return json({
      error: "expected_multipart_form_data"
    }, 400);
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    let loyalty_card_id = form.get("loyalty_card_id") ? String(form.get("loyalty_card_id")).trim() : undefined;
    const event_id = form.get("event_id") ? String(form.get("event_id")) : undefined;
    const timestamp = String(form.get("timestamp") || Date.now());
    if (!(file instanceof File)) return json({
      error: "invalid_file"
    }, 400);
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({
      error: "invalid_token"
    }, 401);
    const userIdFromToken = userData.user.id;
    const origName = sanitizeFilename(file.name || "file");
    const arrayBuf = await file.arrayBuffer();
    const size = arrayBuf.byteLength;
    if (size > MAX_BYTES) return json({
      error: "file_too_large",
      max_bytes: MAX_BYTES
    }, 413);
    const mime = file.type || inferMimeFromName(origName);
    // Si falta loyalty_card_id, intentamos inferirlo del nombre del archivo
    if (!loyalty_card_id) {
      const m = origName.match(/barcode_numeric_(\d+)_/);
      if (m && m[1]) loyalty_card_id = m[1];
    }
    const key = `${userIdFromToken}/${timestamp}_${origName}`;
    const { error: uploadErr } = await supabaseUser.storage.from(BUCKET).upload(key, arrayBuf, {
      contentType: mime,
      upsert: false
    });
    if (uploadErr) return json({
      error: "upload_failed",
      message: uploadErr.message
    }, 400);
    const { data: pub } = supabaseUser.storage.from(BUCKET).getPublicUrl(key);
    const fullUrl = pub?.publicUrl ?? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`;
    if (event_id) {
      const { error: updateEventErr } = await supabaseAdmin.from("events").update({
        event_image: fullUrl
      }).eq("id", event_id);
      if (updateEventErr) console.error("DB update (events) error:", updateEventErr);
    }
    if (loyalty_card_id) {
      const { error: updateLoyaltyErr } = await supabaseAdmin.from("loyalty_cards").update({
        barcode_url: fullUrl
      }).eq("user_id", userIdFromToken).eq("card_number", loyalty_card_id);
      if (updateLoyaltyErr) console.error("DB update (loyalty_cards) error:", updateLoyaltyErr);
    }
    return json({
      url: fullUrl,
      key,
      bucket: BUCKET
    }, 201);
  } catch (e) {
    console.error("server_error", e);
    return json({
      error: "server_error",
      message: e?.message || String(e)
    }, 500);
  }
});
