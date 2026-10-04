Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const WOOVI_APP_ID = Deno.env.get("WOOVI_APP_ID");

    if (!WOOVI_APP_ID) {
      throw new Error("WOOVI_APP_ID não configurado");
    }

    let paymentId = "";

    // Aceita tanto POST com JSON quanto GET com query string
    if (req.method === "POST") {
      const body = await req.json();

      paymentId =
        body.payment_id ||
        body.correlation_id ||
        body.correlationID ||
        "";
    } else {
      const url = new URL(req.url);

      paymentId =
        url.searchParams.get("payment_id") ||
        url.searchParams.get("correlation_id") ||
        "";
    }

    if (!paymentId) {
      return new Response(
        JSON.stringify({
          erro: "payment_id não informado",
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

    const response = await fetch(
      `https://api.woovi.com/api/v1/charge/${encodeURIComponent(paymentId)}`,
      {
        method: "GET",
        headers: {
          Authorization: WOOVI_APP_ID,
          Accept: "application/json",
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro consulta Woovi:", data);

      return new Response(
        JSON.stringify({
          erro: "Não foi possível consultar o PIX.",
          detalhes: data,
        }),
        {
          status: response.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const charge = data.charge;

    if (!charge) {
      throw new Error("Cobrança não encontrada na resposta da Woovi.");
    }

    const statusWoovi = String(charge.status || "").toUpperCase();

    // Mantemos os nomes que o seu HTML já utilizava com Mercado Pago
    let status = "pending";

    if (statusWoovi === "COMPLETED") {
      status = "approved";
    } else if (statusWoovi === "EXPIRED") {
      status = "expired";
    }

    return new Response(
      JSON.stringify({
        status,
        status_woovi: statusWoovi,
        payment_id: paymentId,
        correlation_id: charge.correlationID || paymentId,
        paid_at: charge.paidAt || null,
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
    console.error("Erro status-pix:", error);

    return new Response(
      JSON.stringify({
        erro: "Erro interno ao consultar PIX.",
        detalhes: String(error),
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
});
