// @ts-nocheck Deno edge function, not resolvable by Node/TS tooling
// eslint-disable-next-line import/no-unresolved
import { createClient } from "npm:@supabase/supabase-js@2";

function base64urlEncode(data: string | Uint8Array): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))),
    );
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function createSignedJWT(
  claims: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const cleanPem = privateKeyPem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const keyDer = Uint8Array.from(atob(cleanPem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const headerB64 = base64urlEncode(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  );
  const payloadB64 = base64urlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlEncode(new Uint8Array(sigBytes))}`;
}

async function getAccessToken(
  serviceAccountEmail: string,
  privateKeyPem: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await createSignedJWT(
    {
      iss: serviceAccountEmail,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    privateKeyPem,
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OAuth2 token request failed (${res.status}): ${body}`);
  }

  const { access_token } = await res.json();
  return access_token;
}

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

  const { data: card, error: cardError } = await supabase
    .from("loyalty_cards")
    .select("card_number")
    .eq("user_id", user.id)
    .maybeSingle();

  if (cardError || !card) {
    return new Response(JSON.stringify({ state: "NOT_FOUND" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID")!;
  const serviceAccountEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")!;
  const privateKeyPem = Deno.env.get("GOOGLE_PRIVATE_KEY")!;
  const projectRef = Deno.env.get("SUPABASE_URL")!.split("//")[1].split(".")[0];
  const objectSuffix = `loyalty_${projectRef}_${card.card_number.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const objectId = `${issuerId}.${objectSuffix}`;

  try {
    const accessToken = await getAccessToken(
      serviceAccountEmail,
      privateKeyPem,
    );
    const res = await fetch(
      `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (res.status === 404) {
      return new Response(JSON.stringify({ state: "NOT_FOUND" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Wallet API error (${res.status}): ${body}`);
    }

    const obj = await res.json();
    return new Response(JSON.stringify({ state: obj.state ?? "UNKNOWN" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
