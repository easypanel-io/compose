import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admin, cors, json, secret, stripeForm } from '../_shared/common.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:cors});
  try {
    const auth=req.headers.get('authorization')||'';
    const client=createClient(secret('SUPABASE_URL')!,secret('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data:{user}}=await client.auth.getUser();
    if(!user)return json({error:'Sessão inválida.'},401);
    const {tenant_id}=await req.json();
    const db=admin();
    const {data:profile}=await db.from('users').select('tenant_id,role').eq('id',user.id).maybeSingle();
    if(!profile||profile.tenant_id!==tenant_id||!['admin','owner'].includes(profile.role))return json({error:'Acesso negado.'},403);
    const {data:sub}=await db.from('subscriptions').select('stripe_customer_id').eq('tenant_id',tenant_id).maybeSingle();
    if(!sub?.stripe_customer_id)return json({error:'Cliente Stripe ainda não cadastrado.'},409);
    const dashboard=(secret('DASHBOARD_URL')||'https://dashboard.cardapioplus.com').replace(/\/$/,'');
    const body=new URLSearchParams({customer:sub.stripe_customer_id,return_url:`${dashboard}/?view=assinatura`});
    const session=await stripeForm('billing_portal/sessions',body);
    return json({url:session.url});
  }catch(e){console.error(e);return json({error:e instanceof Error?e.message:'Não foi possível abrir o portal Stripe.'},500);}
});

