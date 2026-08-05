import { createClient } from "npm:@supabase/supabase-js@2";
import forge from "npm:node-forge@1.3.1";
import JSZip from "npm:jszip@3.10.1";

const APPLE_WWDR_G4_PEM = `-----BEGIN CERTIFICATE-----
MIIEVTCCAz2gAwIBAgIUE9x3lVJx5T3GMujM/+Uh88zFztIwDQYJKoZIhvcNAQEL
BQAwYjELMAkGA1UEBhMCVVMxEzARBgNVBAoTCkFwcGxlIEluYy4xJjAkBgNVBAsT
HUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRYwFAYDVQQDEw1BcHBsZSBS
b290IENBMB4XDTIwMTIxNjE5MzYwNFoXDTMwMTIxMDAwMDAwMFowdTFEMEIGA1UE
Aww7QXBwbGUgV29ybGR3aWRlIERldmVsb3BlciBSZWxhdGlvbnMgQ2VydGlmaWNh
dGlvbiBBdXRob3JpdHkxCzAJBgNVBAsMAkc0MRMwEQYDVQQKDApBcHBsZSBJbmMu
MQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBANAf
eKp6JzKwRl/nF3bYoJ0OKY6tPTKlxGs3yeRBkWq3eXFdDDQEYHX3rkOPR8SGHgjo
v9Y5Ui8eZ/xx8YJtPH4GUnadLLzVQ+mxtLxAOnhRXVGhJeG+bJGdayFZGEHVD41t
QSo5SiHgkJ9OE0/QjJoyuNdqkh4laqQyziIZhQVg3AJK8lrrd3kCfcCXVGySjnYB
5kaP5eYq+6KwrRitbTOFOCOL6oqW7Z+uZk+jDEAnbZXQYojZQykn/e2kv1MukBVl
PNkuYmQzHWxq3Y4hqqRfFcYw7V/mjDaSlLfcOQIA+2SM1AyB8j/VNJeHdSbCb64D
YyEMe9QbsWLFApy9/a8CAwEAAaOB7zCB7DASBgNVHRMBAf8ECDAGAQH/AgEAMB8G
A1UdIwQYMBaAFCvQaUeUdgn+9GuNLkCm90dNfwheMEQGCCsGAQUFBwEBBDgwNjA0
BggrBgEFBQcwAYYoaHR0cDovL29jc3AuYXBwbGUuY29tL29jc3AwMy1hcHBsZXJv
b3RjYTAuBgNVHR8EJzAlMCOgIaAfhh1odHRwOi8vY3JsLmFwcGxlLmNvbS9yb290
LmNybDAdBgNVHQ4EFgQUW9n6HeeaGgujmXYiUIY+kchbd6gwDgYDVR0PAQH/BAQD
AgEGMBAGCiqGSIb3Y2QGAgEEAgUAMA0GCSqGSIb3DQEBCwUAA4IBAQA/Vj2e5bbD
eeZFIGi9v3OLLBKeAuOugCKMBB7DUshwgKj7zqew1UJEggOCTwb8O0kU+9h0UoWv
p50h5wESA5/NQFjQAde/MoMrU1goPO6cn1R2PWQnxn6NHThNLa6B5rmluJyJlPef
x4elUWY0GzlxOSTjh2fvpbFoe4zuPfeutnvi0v/fYcZqdUmVIkSoBPyUuAsuORFJ
EtHlgepZAE9bPFo22noicwkJac3AfOriJP6YRLj477JxPxpd1F1+M02cHSS+APCQ
A1iZQT0xWmJArzmoUUOSqwSonMJNsUvSq3xKX+udO7xPiEAGE/+QF4oIRynoYpgp
pU8RBWk6z/Kf
-----END CERTIFICATE-----`;

const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=";

async function sha1Hex(data: Uint8Array | string): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

async function fetchImageBytes(url: string, fallback: Uint8Array): Promise<Uint8Array> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return fallback;
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

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: card, error: cardError } = await supabase
    .from("loyalty_cards")
    .select("card_number, points, created_at, id_store")
    .eq("user_id", user.id)
    .maybeSingle();

  if (cardError || !card) {
    return new Response("Loyalty card not found", { status: 404 });
  }

  const [storeRes, profileRes] = await Promise.all([
    card.id_store
      ? supabase
          .from("stores")
          .select("name, colors, logo_header_url")
          .eq("id", card.id_store)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const store = storeRes.data as {
    name?: string;
    colors?: string[];
    logo_header_url?: string;
  } | null;
  const profile = profileRes.data as {
    first_name?: string;
    last_name?: string;
  } | null;

  const orgName = store?.name ?? Deno.env.get("ORG_NAME") ?? "Food Universe";
  const primaryColor = store?.colors?.[0]
    ? hexToRgb(store.colors[0])
    : "rgb(43, 127, 255)";
  const memberName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "";
  const memberEmail = user.email ?? "";
  const points = card.points ?? 0;

  const starCount = Math.min(5, Math.max(1, Math.ceil(points / 100)));
  const stars = "★".repeat(starCount) + "☆".repeat(5 - starCount);

  try {
    const passTypeIdentifier = Deno.env.get("PASS_TYPE_IDENTIFIER")!;
    const teamIdentifier = Deno.env.get("TEAM_IDENTIFIER")!;
    const placeholderBytes = base64ToBytes(PLACEHOLDER_PNG_BASE64);

    const logoUrl = store?.logo_header_url ?? Deno.env.get("ORG_LOGO_URL");
    const logoBytes = logoUrl
      ? await fetchImageBytes(logoUrl, placeholderBytes)
      : placeholderBytes;

    const passJson = {
      formatVersion: 1,
      passTypeIdentifier,
      serialNumber: card.card_number,
      teamIdentifier,
      organizationName: orgName,
      description: `${orgName} Loyalty Card`,
      foregroundColor: "rgb(255, 255, 255)",
      backgroundColor: primaryColor,
      labelColor: "rgb(200, 230, 255)",
      logoText: orgName,
      storeCard: {
        headerFields: [
          {
            key: "points",
            label: "POINTS",
            value: String(points),
          },
        ],
        primaryFields: [
          {
            key: "member_name",
            label: `${orgName.toUpperCase()} MARKETPLACE`,
            value: memberName || orgName,
          },
        ],
        secondaryFields: [
          {
            key: "stars",
            label: "",
            value: stars,
          },
        ],
        auxiliaryFields: [
          {
            key: "member_email",
            label: "",
            value: memberEmail,
          },
          {
            key: "card_number",
            label: "",
            value: `#${card.card_number}`,
          },
        ],
      },
      barcodes: [
        {
          message: card.card_number,
          format: "PKBarcodeFormatCode128",
          messageEncoding: "iso-8859-1",
          altText: card.card_number,
        },
      ],
      barcode: {
        message: card.card_number,
        format: "PKBarcodeFormatCode128",
        messageEncoding: "iso-8859-1",
        altText: card.card_number,
      },
    };

    const passJsonStr = JSON.stringify(passJson);

    const manifest = {
      "pass.json": await sha1Hex(passJsonStr),
      "icon.png": await sha1Hex(placeholderBytes),
      "icon@2x.png": await sha1Hex(placeholderBytes),
      "logo.png": await sha1Hex(logoBytes),
      "logo@2x.png": await sha1Hex(logoBytes),
    };
    const manifestStr = JSON.stringify(manifest);

    const p12Base64 = Deno.env.get("PASS_CERTIFICATE_P12_BASE64")!;
    const p12Password = Deno.env.get("PASS_CERTIFICATE_PASSWORD") ?? "";

    const p12Der = forge.util.decode64(p12Base64);
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, p12Password);

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const keyBags = p12.getBags({
      bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
    });

    const leafCert = certBags[forge.pki.oids.certBag]![0].cert!;
    const privateKey =
      keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]![0].key!;
    const wwdrCert = forge.pki.certificateFromPem(APPLE_WWDR_G4_PEM);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(manifestStr);
    p7.addCertificate(leafCert);
    p7.addCertificate(wwdrCert);
    p7.addSigner({
      key: privateKey,
      certificate: leafCert,
      digestAlgorithm: forge.pki.oids.sha1,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });
    p7.sign({ detached: true });

    const p7Asn1 = p7.toAsn1();
    const signedData = p7Asn1.value[1].value[0];
    const encapContentInfo = signedData.value[2];
    encapContentInfo.value = [encapContentInfo.value[0]];

    const sigDer = forge.asn1.toDer(p7Asn1).getBytes();
    const sigBytes = new Uint8Array(sigDer.length);
    for (let i = 0; i < sigDer.length; i++)
      sigBytes[i] = sigDer.charCodeAt(i);

    const zip = new JSZip();
    zip.file("pass.json", passJsonStr);
    zip.file("manifest.json", manifestStr);
    zip.file("signature", sigBytes);
    zip.file("icon.png", placeholderBytes);
    zip.file("icon@2x.png", placeholderBytes);
    zip.file("logo.png", logoBytes);
    zip.file("logo@2x.png", logoBytes);

    const pkpass = await zip.generateAsync({ type: "uint8array" });

    return new Response(pkpass, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": 'attachment; filename="loyalty.pkpass"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("Pass generation failed:", message, stack);
    return new Response(
      JSON.stringify({ error: message, stack }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
