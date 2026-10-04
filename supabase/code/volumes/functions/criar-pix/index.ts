Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const WOOVI_APP_ID = Deno.env.get("WOOVI_APP_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!WOOVI_APP_ID) {
      throw new Error("WOOVI_APP_ID não configurado");
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("Configuração interna do Supabase não encontrada");
    }

    const { valor, nome } = await req.json();

    const valorNumero = Number(valor);

    if (!valorNumero || valorNumero <= 0) {
      return new Response(
        JSON.stringify({
          erro: "Valor da doação inválido.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const valorCentavos = Math.round(valorNumero * 100);
    const correlationID = crypto.randomUUID();

    // ============================
    // CRIAR COBRANÇA NA WOOVI
    // ============================

    const wooviResponse = await fetch(
      "https://api.woovi.com/api/v1/charge",
      {
        method: "POST",
        headers: {
          Authorization: WOOVI_APP_ID,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          correlationID,
          value: valorCentavos,
          comment: nome
            ? `Doação - ${nome}`
            : "Doação - Campanha de arrecadação",
        }),
      }
    );

    const wooviData = await wooviResponse.json();

    if (!wooviResponse.ok) {
      console.error("Erro Woovi:", wooviData);

      return new Response(
        JSON.stringify({
          erro: "Não foi possível gerar o PIX.",
          detalhes: wooviData,
        }),
        {
          status: wooviResponse.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const charge = wooviData.charge;

    if (!charge?.brCode) {
      console.error("Resposta inesperada Woovi:", wooviData);
      throw new Error("Woovi não retornou o código PIX.");
    }

    // ============================
    // SALVAR NA TABELA DOACOES
    // ============================

    const bancoResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/doacoes`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          mp_payment_id: correlationID,
          valor: valorNumero,
          status: "pending",
          nome_doador: nome || null,
          email_doador: null,
          qr_code: charge.brCode,
          qr_code_base64: null,
        }),
      }
    );

    const bancoTexto = await bancoResponse.text();

    if (!bancoResponse.ok) {
      console.error(
        "PIX criado, mas erro ao salvar no banco:",
        bancoTexto
      );

      return new Response(
        JSON.stringify({
          erro: "PIX criado, mas não foi possível registrar a doação.",
          detalhes: bancoTexto,
          payment_id: correlationID,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    console.log(
      "Cobrança criada e registrada:",
      correlationID
    );

    // ============================
    // RETORNO PARA O SITE
    // ============================

    return new Response(
      JSON.stringify({
        payment_id: correlationID,
        correlation_id: correlationID,

        qr_code: charge.brCode,

        qr_code_base64: null,

        qr_code_image:
          charge.qrCodeImage || null,

        payment_link:
          charge.paymentLinkUrl || null,

        status: "pending",
        status_woovi:
          String(charge.status || "").toUpperCase(),
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Erro criar-pix:", error);

    return new Response(
      JSON.stringify({
        erro: "Erro interno ao gerar PIX.",
        detalhes: String(error),
      }),
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      }
    );
  }
});
