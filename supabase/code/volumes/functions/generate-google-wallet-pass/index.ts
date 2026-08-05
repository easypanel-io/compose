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

// Gets an OAuth2 access token using the service account credentials
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

// Creates the loyalty class via REST API if it doesn't exist yet
async function ensureLoyaltyClass(
  accessToken: string,
  issuerId: string,
  classSuffix: string,
  logoUrl: string,
): Promise<void> {
  const classId = `${issuerId}.${classSuffix}`;
  const apiBase = "https://walletobjects.googleapis.com/walletobjects/v1";

  const checkRes = await fetch(
    `${apiBase}/loyaltyClass/${encodeURIComponent(classId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (checkRes.ok) return;

  if (checkRes.status !== 404) {
    const body = await checkRes.text();
    throw new Error(`Error checking loyalty class (${checkRes.status}): ${body}`);
  }

  const createRes = await fetch(`${apiBase}/loyaltyClass`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: classId,
      issuerName: "Food Universe",
      programName: "Food Universe Loyalty",
      programLogo: {
        sourceUri: { uri: logoUrl },
        contentDescription: {
          defaultValue: { language: "en-US", value: "Food Universe Logo" },
        },
      },
      reviewStatus: "UNDER_REVIEW",
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Failed to create loyalty class (${createRes.status}): ${body}`);
  }
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
    .select("card_number, points")
    .eq("user_id", user.id)
    .maybeSingle();

  if (cardError || !card) {
    return new Response("Loyalty card not found", { status: 404 });
  }

  const profileRes = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileRes.data as {
    first_name?: string;
    last_name?: string;
  } | null;

  const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID")!;
  const classSuffix =
    Deno.env.get("GOOGLE_WALLET_CLASS_ID") ?? "loyalty_class";
  const serviceAccountEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")!;
  const privateKeyPem = Deno.env.get("GOOGLE_PRIVATE_KEY")!;
  const logoUrl =
    Deno.env.get("GOOGLE_WALLET_LOGO_URL") ??
    "https://storage.googleapis.com/wallet-lab-tools-codelab-artifacts-public/pass_google_logo.jpg";

  const memberName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "";

  const objectSuffix = `loyalty_${card.card_number.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  try {
    const accessToken = await getAccessToken(serviceAccountEmail, privateKeyPem);
    await ensureLoyaltyClass(accessToken, issuerId, classSuffix, logoUrl);

    const jwtClaims = {
      iss: serviceAccountEmail,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(Date.now() / 1000),
      origins: [],
      payload: {
        loyaltyObjects: [
          {
            id: `${issuerId}.${objectSuffix}`,
            classId: `${issuerId}.${classSuffix}`,
            state: "ACTIVE",
            accountId: card.card_number,
            accountName: memberName,
            loyaltyPoints: {
              label: "Points",
              balance: { int: card.points ?? 0 },
            },
            barcode: {
              type: "CODE_128",
              value: card.card_number,
              alternateText: card.card_number,
            },
          },
        ],
      },
    };

    const jwt = await createSignedJWT(jwtClaims, privateKeyPem);
    return new Response(JSON.stringify({ jwt }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("Google Wallet pass generation failed:", message, stack);
    return new Response(JSON.stringify({ error: message, stack }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
