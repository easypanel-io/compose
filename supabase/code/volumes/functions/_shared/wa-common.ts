import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { admin, cors, json, secret } from './common.ts';

export { admin, cors, json, secret };

export class HttpError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.status=status;}
}

export async function requireTenant(req:Request){
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.toLowerCase().startsWith('bearer ')) throw new HttpError('Sessão ausente.',401);
  const url=secret('SUPABASE_URL');
  const anon=secret('SUPABASE_ANON_KEY');
  if(!url||!anon) throw new Error('Configuração interna do Supabase ausente.');
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser();
  if(error||!user) throw new HttpError('Sessão inválida. Entre novamente.',401);
  const db=admin();
  const {data:profile,error:profileError}=await db.from('users').select('tenant_id,role').eq('id',user.id).maybeSingle();
  if(profileError||!profile?.tenant_id) throw new HttpError('Usuário sem empresa vinculada.',403);
  if(!['admin','owner'].includes(profile.role)) throw new HttpError('Somente o administrador da empresa pode executar esta ação.',403);
  return {db,user,tenantId:String(profile.tenant_id),role:String(profile.role)};
}

export function handleError(error:unknown){
  console.error(error);
  if(error instanceof HttpError) return json({error:error.message},error.status);
  return json({error:error instanceof Error?error.message:'Erro interno inesperado.'},500);
}

export async function evolutionSettings(db:ReturnType<typeof admin>){
  const {data,error}=await db.from('platform_settings')
    .select('whatsapp_evolution_url,whatsapp_evolution_api_key')
    .limit(1).maybeSingle();
  if(error) throw error;
  const base=String(data?.whatsapp_evolution_url||'').replace(/\/$/,'');
  const apiKey=String(data?.whatsapp_evolution_api_key||'');
  if(!base||!apiKey) throw new HttpError('A Evolution API ainda não foi configurada no Painel Central.',409);
  return {base,apiKey};
}

export async function evolutionFetch(
  settings:{base:string;apiKey:string},
  path:string,
  init:RequestInit={},
  accepted:number[]=[]
){
  const res=await fetch(`${settings.base}${path.startsWith('/')?'':'/'}${path}`,{
    ...init,
    headers:{'Content-Type':'application/json','apikey':settings.apiKey,...(init.headers||{})}
  });
  const raw=await res.text();
  let data:any={};
  try{data=raw?JSON.parse(raw):{};}catch{data={message:raw};}
  if(!res.ok&&!accepted.includes(res.status)){
    const message=data?.response?.message?.[0]||data?.response?.message||data?.message||data?.error||`Evolution API HTTP ${res.status}`;
    throw new HttpError(Array.isArray(message)?message.join(', '):String(message),502);
  }
  return {res,data};
}

export const instanceName=(tenantId:string)=>`cardapioplus-${tenantId.toLowerCase()}`;

export function evolutionState(data:any){
  const raw=String(data?.instance?.state||data?.state||data?.connectionStatus||'').toLowerCase();
  if(['open','connected'].includes(raw)) return 'connected';
  if(['connecting','qr','pairing'].includes(raw)) return 'connecting';
  return 'disconnected';
}

export function evolutionPhone(data:any){
  const value=data?.instance?.owner||data?.instance?.ownerJid||data?.owner||data?.ownerJid||data?.number||'';
  return String(value).split('@')[0].replace(/\D/g,'');
}

export function qrCodeFrom(data:any){
  return data?.base64||data?.qrcode?.base64||data?.qr?.base64||data?.qrcode||null;
}

const DIAL_CODES:Record<string,string>={AR:'54',BR:'55',CL:'56',CO:'57',MX:'52',PE:'51',UY:'598',PT:'351',US:'1',CA:'1',GB:'44'};
export function internationalPhone(raw:string,country='BR'){
  let digits=String(raw||'').replace(/\D/g,'');
  if(!digits) return '';
  const dial=DIAL_CODES[country]||'';
  if(dial&&digits.length<=11&&!digits.startsWith(dial)) digits=dial+digits;
  return digits;
}

export function renderCampaignMessage(template:string,values:Record<string,string>){
  return Object.entries(values).reduce((text,[key,value])=>text.split(`{{${key}}}`).join(value||''),template);
}
