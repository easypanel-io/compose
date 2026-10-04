import { admin, cors, json, secret, stripeForm } from '../_shared/common.ts';

const zeroDecimal = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i,'');
    const db = admin();
    const {data:{user}} = await db.auth.getUser(token);
    if (!user) return json({error:'Sessão inválida.'},401);

    const {tenant_id} = await req.json();
    const {data:profile} = await db.from('users').select('tenant_id,role').eq('id',user.id).maybeSingle();
    if (!profile || profile.tenant_id !== tenant_id || !['admin','owner'].includes(profile.role)) return json({error:'Acesso negado.'},403);

    const [{data:company},{data:subscription}] = await Promise.all([
      db.from('companies').select('id,name,email,billing_currency').eq('id',tenant_id).maybeSingle(),
      db.from('subscriptions').select('id,plan_id,status,trial_ends_at,stripe_customer_id,stripe_subscription_id').eq('tenant_id',tenant_id).maybeSingle()
    ]);
    if (!company || !subscription) return json({error:'Assinatura não encontrada.'},404);
    if (subscription.stripe_subscription_id) return json({error:'Esta assinatura já está vinculada à Stripe.'},409);

    const currency = String(company.billing_currency || 'USD').toUpperCase();
    if (currency === 'BRL') return json({error:'Assinaturas em BRL continuam no Mercado Pago.'},409);
    const {data:price} = await db.from('plan_prices').select('monthly_price,stripe_price_id').eq('plan_id',subscription.plan_id).eq('currency_code',currency).eq('is_active',true).maybeSingle();
    if (!price) return json({error:`Preço do plano não configurado em ${currency}.`},409);

    const factor = zeroDecimal.has(currency) ? 1 : 100;
    const amount = Math.round(Number(price.monthly_price) * factor);
    if (!Number.isFinite(amount) || amount < 1) return json({error:'Valor da assinatura inválido.'},400);

    const dashboard = (secret('DASHBOARD_URL') || 'https://dashboard.cardapioplus.com').replace(/\/$/,'');
    const publishableKey = secret('STRIPE_PUBLISHABLE_KEY');
    if (!publishableKey) throw new Error('STRIPE_PUBLISHABLE_KEY ausente');
    const body = new URLSearchParams();
    body.set('mode','subscription');
    body.set('ui_mode','embedded_page');
    body.set('redirect_on_completion','never');
    body.set('payment_method_types[0]','card');
    body.set('client_reference_id',tenant_id);
    body.set('metadata[tenant_id]',tenant_id);
    body.set('metadata[subscription_id]',subscription.id);
    body.set('subscription_data[metadata][tenant_id]',tenant_id);
    body.set('subscription_data[metadata][subscription_id]',subscription.id);
    body.set('line_items[0][quantity]','1');
    if (price.stripe_price_id) {
      body.set('line_items[0][price]',price.stripe_price_id);
    } else {
      body.set('line_items[0][price_data][currency]',currency.toLowerCase());
      body.set('line_items[0][price_data][unit_amount]',String(amount));
      body.set('line_items[0][price_data][recurring][interval]','month');
      body.set('line_items[0][price_data][product_data][name]',`Assinatura Cardápio+`);
    }
    if (subscription.stripe_customer_id) body.set('customer',subscription.stripe_customer_id);
    else if (company.email) body.set('customer_email',company.email);

    const trialEnd = subscription.trial_ends_at ? Math.floor(new Date(subscription.trial_ends_at).getTime()/1000) : 0;
    if (trialEnd > Math.floor(Date.now()/1000) + 60) body.set('subscription_data[trial_end]',String(trialEnd));

    // A chave antiga era fixa por assinatura/moeda. Quando o trial, preço ou
    // outros parâmetros mudavam, a Stripe recusava a nova sessão por ela usar
    // a mesma chave com um payload diferente. A chave abaixo inclui os dados
    // que alteram o Checkout e uma janela curta: cliques repetidos no mesmo
    // minuto continuam idempotentes, mas uma nova tentativa válida não colide
    // com uma sessão criada anteriormente.
    const requestWindow = Math.floor(Date.now() / 60000);
    const priceReference = String(price.stripe_price_id || amount).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    const idempotencyKey = `saas-checkout-embedded-v3-${subscription.id}-${currency}-${priceReference}-${trialEnd || 0}-${requestWindow}`;
    const session = await stripeForm('checkout/sessions',body,undefined,idempotencyKey);
    await db.from('subscriptions').update({
      payment_provider:'stripe', billing_currency:currency, stripe_checkout_session_id:session.id
    }).eq('id',subscription.id);
    return json({clientSecret:session.client_secret,publishableKey});
  } catch (e) {
    console.error(e);
    return json({error:e instanceof Error ? e.message : 'Não foi possível abrir a cobrança internacional.'},500);
  }
});
