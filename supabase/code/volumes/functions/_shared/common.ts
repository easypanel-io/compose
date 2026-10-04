import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export { secret } from './runtime-secrets.ts';
import { secret } from './runtime-secrets.ts';

export const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, stripe-signature','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
export const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:{...cors,'content-type':'application/json'}});
export const admin = () => createClient(secret('SUPABASE_URL')!, secret('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});
export const stripeSecret = () => { const v=secret('STRIPE_SECRET_KEY'); if(!v) throw new Error('STRIPE_SECRET_KEY ausente'); return v; };
export const stripeForm = async (path:string, body:URLSearchParams, account?:string, idempotency?:string) => {
  const headers:Record<string,string>={'Authorization':`Bearer ${stripeSecret()}`,'Content-Type':'application/x-www-form-urlencoded'};
  if(account) headers['Stripe-Account']=account;
  if(idempotency) headers['Idempotency-Key']=idempotency;
  const res=await fetch(`https://api.stripe.com/v1/${path}`,{method:'POST',headers,body});
  const data=await res.json();
  if(!res.ok) throw new Error(data?.error?.message || `Stripe HTTP ${res.status}`);
  return data;
};
export const stripeGet = async (path:string) => {
  const res=await fetch(`https://api.stripe.com/v1/${path}`,{headers:{Authorization:`Bearer ${stripeSecret()}`}});
  const data=await res.json();
  if(!res.ok) throw new Error(data?.error?.message || `Stripe HTTP ${res.status}`);
  return data;
};
export const sha256 = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
