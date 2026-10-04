// send-renewal-reminders/index.ts
// Dois modos:
//  1. Sem body (ou {}) -> modo lote: varre assinaturas perto de vencer e
//     manda o lembrete (e-mail + WhatsApp, sempre os dois juntos) pra cada
//     uma. Chamado pelo pg_cron diário, ou manualmente pelo botão
//     "Enviar lembretes agora" no admin.
//  2. Com { test_email } e/ou { test_whatsapp } -> manda só um teste pro(s)
//     destino(s) informado(s), sem mexer em nenhuma assinatura.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { internationalPhone } from "../_shared/wa-common.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function renewalLink(settings: any): string {
  const base = settings.app_url || "https://dashboard.cardapioplus.com";
  return `${base.replace(/\/$/, "")}/?view=assinatura`;
}

function formatSubscriptionMoney(value: unknown, currency = "BRL"): string {
  const locale = ({ BRL:"pt-BR", EUR:"pt-PT", USD:"en-US", GBP:"en-GB" } as Record<string,string>)[currency] || "en-US";
  return Number(value || 0).toLocaleString(locale, { style:"currency", currency });
}

async function sendEmail(settings: any, to: string, subject: string, bodyText: string) {
  const client = new SMTPClient({
    connection: {
      hostname: settings.smtp_host,
      port: settings.smtp_port || 587,
      tls: settings.smtp_port === 465,
      auth: { username: settings.smtp_username, password: settings.smtp_password },
    },
  });
  const bodyHtml = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;"><h2 style="color:#EA1D2C;margin-bottom:4px;">Cardápio+</h2><div style="white-space:pre-line;color:#1C1C21;font-size:14px;line-height:1.6;margin-top:20px;">${bodyText.replace(/</g, "&lt;")}</div></div>`;
  await client.send({
    from: `${settings.smtp_from_name || "Cardápio+"} <${settings.smtp_from_email}>`,
    to, subject, content: bodyText, html: bodyHtml,
  });
  await client.close();
}

async function sendWhatsapp(settings: any, phone: string, text: string, countryCode = "BR") {
  const number = internationalPhone(phone, countryCode);
  if (!number) throw new Error("Número de WhatsApp ausente ou inválido.");
  const url = `${settings.whatsapp_evolution_url.replace(/\/$/, "")}/message/sendText/${settings.whatsapp_evolution_instance}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": settings.whatsapp_evolution_api_key },
    body: JSON.stringify({ number, text }),
  });
  if (!res.ok) throw new Error(`Evolution API respondeu ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { data: settings, error: settingsErr } = await supabaseAdmin
      .from("platform_settings").select("*").eq("id", 1).single();
    if (settingsErr) return json({ error: "Erro ao carregar configurações." }, 400);

    if (body.test_email || body.test_whatsapp) {
      const vars = {
        empresa: "Empresa de Teste", plano: "Plano Profissional", valor: "R$ 99,90",
        vencimento: new Date(Date.now() + 3 * 86400000).toLocaleDateString("pt-BR"),
        link_renovacao: renewalLink(settings),
      };
      const results: Record<string, string> = {};
      if (body.test_email) {
        if (!settings.smtp_host) return json({ error: "SMTP não configurado." }, 400);
        const subject = fillTemplate(settings.reminder_email_subject, vars);
        const text = fillTemplate(settings.reminder_email_body, vars);
        await sendEmail(settings, body.test_email, `[TESTE] ${subject}`, text);
        results.email = "enviado";
      }
      if (body.test_whatsapp) {
        if (!settings.whatsapp_evolution_url || !settings.whatsapp_evolution_instance || !settings.whatsapp_evolution_api_key) {
          return json({ error: "Evolution API não configurada (URL, instância ou API Key faltando)." }, 400);
        }
        await sendWhatsapp(settings, body.test_whatsapp, fillTemplate(settings.whatsapp_reminder_message, vars), body.test_country || "BR");
        results.whatsapp = "enviado";
      }
      return json({ ok: true, message: "Teste enviado.", results });
    }

    // Faz a transição do trial/ciclo vencido e cria a fatura antes de procurar
    // destinatários. A função SQL é idempotente, então também pode ser chamada
    // pelo cron e pelo painel sem duplicar faturas.
    const { data: billingResult, error: billingError } = await supabaseAdmin.rpc("check_subscription_billing_status");
    if (billingError) console.error("Erro ao processar vencimentos:", billingError);

    const daysBefore = settings.reminder_days_before || 3;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + daysBefore * 86400000);
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("id, status, billing_currency, current_period_start, current_period_end, trial_ends_at, last_reminder_sent_at, tenant_id, companies(name, email, whatsapp, country_code), plans(name, monthly_price, plan_prices(currency_code, monthly_price, is_active))")
      .in("status", ["active", "trial", "payment_pending", "overdue"]);

    let sentCount = 0;
    const emailReady = !!settings.smtp_host;
    const whatsappReady = !!(settings.whatsapp_evolution_url && settings.whatsapp_evolution_instance && settings.whatsapp_evolution_api_key);
    for (const sub of subs || []) {
      const relevantDate = sub.status === "trial"
        ? sub.trial_ends_at
        : (sub.current_period_end || sub.trial_ends_at);
      if (!relevantDate) continue;
      const dueDate = new Date(relevantDate);
      const isPastDue = dueDate <= now;
      if (!isPastDue && dueDate > windowEnd) continue;
      if (isPastDue && !["trial", "payment_pending", "overdue"].includes(sub.status)) continue;
      const cycleStart = sub.current_period_start ? new Date(sub.current_period_start) : new Date(0);
      if (sub.last_reminder_sent_at && new Date(sub.last_reminder_sent_at) > cycleStart) continue;
      const email = sub.companies?.email;
      const whatsapp = sub.companies?.whatsapp;
      if (!email && !whatsapp) continue;
      const billingCurrency = sub.billing_currency || "BRL";
      const localizedPrice = (sub.plans?.plan_prices || []).find((price: any) => price.currency_code === billingCurrency && price.is_active !== false);
      const vars = {
        empresa: sub.companies?.name || "sua empresa",
        plano: sub.plans?.name || "seu plano",
        valor: formatSubscriptionMoney(localizedPrice?.monthly_price ?? sub.plans?.monthly_price, billingCurrency),
        vencimento: dueDate.toLocaleDateString("pt-BR"),
        link_renovacao: renewalLink(settings),
      };
      let anySent = false;
      if (emailReady && email) {
        try {
          await sendEmail(settings, email, fillTemplate(settings.reminder_email_subject, vars), fillTemplate(settings.reminder_email_body, vars));
          anySent = true;
        } catch (err) { console.error(`Erro ao enviar e-mail pra ${email}:`, err); }
      }
      if (whatsappReady && whatsapp) {
        try {
          await sendWhatsapp(
            settings,
            whatsapp,
            fillTemplate(settings.whatsapp_reminder_message, vars),
            sub.companies?.country_code || "BR",
          );
          anySent = true;
        } catch (err) { console.error(`Erro ao enviar WhatsApp pra ${whatsapp}:`, err); }
      }
      if (anySent) {
        await supabaseAdmin.from("subscriptions").update({ last_reminder_sent_at: new Date().toISOString() }).eq("id", sub.id);
        sentCount++;
      }
    }
    return json({ ok: true, sent: sentCount, billing: billingResult || null, billing_error: billingError?.message || null });
  } catch (err) {
    console.error(err);
    return json({ error: "Erro inesperado ao processar lembretes." }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
