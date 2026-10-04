import { admin, json, secret } from '../_shared/common.ts';

const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
const safeEqual=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;};
async function verify(payload:string,header:string,webhookSecret:string){
  const parts=header.split(',').map(x=>x.split('='));
  const timestamp=parts.find(x=>x[0]==='t')?.[1];
  const signatures=parts.filter(x=>x[0]==='v1').map(x=>x[1]);
  if(!timestamp||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some(s=>safeEqual(s,expected));
}
const subscriptionStatus=(stripeStatus:string)=>{
  if(['active','trialing'].includes(stripeStatus))return stripeStatus==='trialing'?'trial':'active';
  if(['past_due','unpaid','incomplete'].includes(stripeStatus))return 'payment_pending';
  if(['canceled','incomplete_expired'].includes(stripeStatus))return 'cancelled';
  if(stripeStatus==='paused')return 'suspended';
  return null;
};

Deno.serve(async req=>{
  if(req.method!=='POST')return json({error:'Método inválido.'},405);
  const payload=await req.text();
  const signature=req.headers.get('stripe-signature')||'';
  const webhookSecret=secret('STRIPE_BILLING_WEBHOOK_SECRET')||'';
  if(!webhookSecret||!await verify(payload,signature,webhookSecret))return json({error:'Assinatura inválida.'},400);
  let event:any;try{event=JSON.parse(payload);}catch{return json({error:'JSON inválido.'},400);}
  const db=admin();
  const {error:duplicate}=await db.from('stripe_webhook_events').insert({event_id:event.id,event_type:`saas.${event.type}`,stripe_account_id:null});
  if(duplicate?.code==='23505')return json({received:true,duplicate:true});
  if(duplicate)return json({error:'Falha de idempotência.'},500);

  try{
    const o=event.data?.object||{};
    if(event.type==='checkout.session.completed'&&o.mode==='subscription'){
      const tenant=o.metadata?.tenant_id||o.client_reference_id;
      if(tenant)await db.from('subscriptions').update({
        payment_provider:'stripe',stripe_customer_id:typeof o.customer==='string'?o.customer:null,
        stripe_subscription_id:typeof o.subscription==='string'?o.subscription:null,
        stripe_checkout_session_id:o.id,payment_method:'card'
      }).eq('tenant_id',tenant);
    }else if(event.type.startsWith('customer.subscription.')){
      const tenant=o.metadata?.tenant_id;
      const status=subscriptionStatus(o.status);
      if(tenant&&status){
        const periodEndUnix=o.current_period_end||o.items?.data?.[0]?.current_period_end;
        const subscriptionUpdate:any={status,stripe_customer_id:o.customer,stripe_subscription_id:o.id,payment_provider:'stripe'};
        if(periodEndUnix)subscriptionUpdate.current_period_end=new Date(periodEndUnix*1000).toISOString();
        await db.from('subscriptions').update(subscriptionUpdate).eq('tenant_id',tenant);
        await db.from('companies').update({status}).eq('id',tenant);
      }
    }else if(event.type==='invoice.paid'||event.type==='invoice.payment_failed'){
      const stripeSub=typeof o.subscription==='string'
        ? o.subscription
        : typeof o.parent?.subscription_details?.subscription==='string'
          ? o.parent.subscription_details.subscription
          : null;
      if(stripeSub){
        const {data:sub}=await db.from('subscriptions').select('id,tenant_id,billing_currency').eq('stripe_subscription_id',stripeSub).maybeSingle();
        if(sub){
          const paid=event.type==='invoice.paid';
          const due=o.due_date?new Date(o.due_date*1000).toISOString().slice(0,10):new Date().toISOString().slice(0,10);
          const invoicePayload={
            tenant_id:sub.tenant_id,subscription_id:sub.id,amount:Number(o.amount_due||0)/100,status:paid?'paid':'failed',due_date:due,
            paid_at:paid?new Date((o.status_transitions?.paid_at||Math.floor(Date.now()/1000))*1000).toISOString():null,
            currency_code:String(o.currency||sub.billing_currency||'USD').toUpperCase(),payment_provider:'stripe',
            provider_invoice_id:o.id,hosted_invoice_url:o.hosted_invoice_url||null
          };
          const {data:placeholder}=await db.from('subscription_invoices')
            .select('id').eq('subscription_id',sub.id).eq('due_date',due)
            .is('provider_invoice_id',null).in('status',['pending','failed']).limit(1).maybeSingle();
          if(placeholder?.id){
            await db.from('subscription_invoices').update(invoicePayload).eq('id',placeholder.id);
          }else{
            await db.from('subscription_invoices').upsert(invoicePayload,{onConflict:'provider_invoice_id'});
          }
          const status=paid?'active':'payment_pending';
          await db.from('subscriptions').update({status}).eq('id',sub.id);
          await db.from('companies').update({status}).eq('id',sub.tenant_id);
        }
      }
    }
    return json({received:true});
  }catch(e){
    console.error(e);await db.from('stripe_webhook_events').delete().eq('event_id',event.id);
    return json({error:'Falha ao processar evento Stripe Billing.'},500);
  }
});
