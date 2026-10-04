import {cors,json,requireTenant,handleError,HttpError,secret} from '../_shared/wa-common.ts';

const ALLOWED_AUDIENCES=new Set(['all','purchased','recent_30','inactive_30','repeat_2','repeat_3']);
const ALLOWED_MIME=new Set(['image/jpeg','image/png','image/webp']);

function decodeDataUrl(value:string,mimeHint?:string){
  const match=value.match(/^data:([^;]+);base64,(.+)$/s);
  const mime=match?.[1]||mimeHint||'';
  const encoded=(match?.[2]||value).replace(/\s/g,'');
  if(!ALLOWED_MIME.has(mime)) throw new HttpError('Formato da imagem inválido.',400);
  let binary='';
  try{binary=atob(encoded);}catch{throw new HttpError('Imagem inválida.',400);}
  if(binary.length>3*1024*1024) throw new HttpError('A imagem deve ter no máximo 3 MB.',413);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return {bytes,mime};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'Método não permitido.'},405);
  try{
    const {db,user,tenantId}=await requireTenant(req);
    const body=await req.json();
    const name=String(body.name||'').trim();
    const message=String(body.message||'').trim();
    const audience=String(body.audience_type||'all');
    const couponId=body.coupon_id?String(body.coupon_id):null;
    if(!name||name.length>120) throw new HttpError('Informe um nome de campanha com até 120 caracteres.');
    if(!message||message.length>4096) throw new HttpError('Informe uma mensagem com até 4096 caracteres.');
    if(!ALLOWED_AUDIENCES.has(audience)) throw new HttpError('Público inválido.');
    if(message.includes('{{cupom}}')&&!couponId) throw new HttpError('Selecione um cupom para utilizar {{cupom}}.');

    const {data:integration}=await db.from('whatsapp_integrations').select('status').eq('tenant_id',tenantId).maybeSingle();
    if(integration?.status!=='connected') throw new HttpError('Conecte o WhatsApp da empresa antes de criar a campanha.',409);
    if(couponId){
      const {data:coupon}=await db.from('coupons').select('id').eq('id',couponId).eq('tenant_id',tenantId).eq('is_active',true).maybeSingle();
      if(!coupon) throw new HttpError('Cupom inválido ou inativo.',400);
    }

    const {data:campaign,error}=await db.from('whatsapp_campaigns').insert({
      tenant_id:tenantId,created_by:user.id,name,audience_type:audience,coupon_id:couponId,message,status:'draft'
    }).select('id').single();
    if(error||!campaign) throw error||new Error('Não foi possível criar a campanha.');

    let storagePath:string|null=null;
    try{
      if(body.image_base64){
        const {bytes,mime}=decodeDataUrl(String(body.image_base64),body.image_mime_type?String(body.image_mime_type):undefined);
        const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
        storagePath=`${tenantId}/${campaign.id}.${ext}`;
        const upload=await db.storage.from('whatsapp-campaign-media').upload(storagePath,bytes,{contentType:mime,upsert:false});
        if(upload.error) throw upload.error;
        const publicSupabaseUrl=String(
          secret('PUBLIC_SUPABASE_URL')||'https://supabase-cardapio.softwaresolucoes.com'
        ).replace(/\/$/,'');
        const publicPath=storagePath.split('/').map(encodeURIComponent).join('/');
        const imageUrl=`${publicSupabaseUrl}/storage/v1/object/public/whatsapp-campaign-media/${publicPath}`;
        const {error:updateError}=await db.from('whatsapp_campaigns').update({image_url:imageUrl,image_storage_path:storagePath,image_mime_type:mime}).eq('id',campaign.id);
        if(updateError) throw updateError;
      }

      const {data:recipientCount,error:buildError}=await db.rpc('wa_build_campaign_recipients',{
        p_campaign_id:campaign.id,p_tenant_id:tenantId,p_audience_type:audience
      });
      if(buildError) throw buildError;
      const recipients=Number(recipientCount||0);
      if(recipients<1) throw new HttpError('Nenhum cliente autorizado foi encontrado para esse público.',409);
      if(recipients>1000) throw new HttpError('A campanha excede o limite de 1.000 destinatários.',413);
      const {error:queueError}=await db.from('whatsapp_campaigns').update({status:'queued',total_recipients:recipients}).eq('id',campaign.id);
      if(queueError) throw queueError;
      return json({campaign_id:campaign.id,recipients});
    }catch(error){
      if(storagePath) await db.storage.from('whatsapp-campaign-media').remove([storagePath]);
      await db.from('whatsapp_campaigns').delete().eq('id',campaign.id);
      throw error;
    }
  }catch(error){return handleError(error);}
});
