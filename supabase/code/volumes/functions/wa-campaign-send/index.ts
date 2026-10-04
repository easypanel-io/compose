import {cors,json,requireTenant,handleError,HttpError,evolutionSettings,evolutionFetch,internationalPhone,renderCampaignMessage,secret} from '../_shared/wa-common.ts';

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'Método não permitido.'},405);
  try{
    const {db,tenantId}=await requireTenant(req);
    const {campaign_id}=await req.json();
    if(!campaign_id) throw new HttpError('Campanha não informada.');
    const {data:campaign,error}=await db.from('whatsapp_campaigns')
      .select('id,name,message,image_url,image_mime_type,status,coupon_id,total_recipients')
      .eq('id',campaign_id).eq('tenant_id',tenantId).maybeSingle();
    if(error) throw error;
    if(!campaign) throw new HttpError('Campanha não encontrada.',404);
    if(['completed','cancelled'].includes(campaign.status)) throw new HttpError('Esta campanha já foi encerrada.',409);

    const [{data:integration},{data:company}]=await Promise.all([
      db.from('whatsapp_integrations').select('instance_name,status').eq('tenant_id',tenantId).maybeSingle(),
      db.from('companies').select('name,slug,country_code').eq('id',tenantId).maybeSingle()
    ]);
    if(integration?.status!=='connected') throw new HttpError('O WhatsApp da empresa não está conectado.',409);
    if(!company) throw new HttpError('Empresa não encontrada.',404);
    const settings=await evolutionSettings(db);
    let couponCode='';
    if(campaign.coupon_id){
      const {data:coupon}=await db.from('coupons').select('code').eq('id',campaign.coupon_id).eq('tenant_id',tenantId).maybeSingle();
      couponCode=String(coupon?.code||'');
    }
    const {data:claimed,error:claimError}=await db.rpc('wa_claim_campaign_recipients',{
      p_campaign_id:campaign.id,p_tenant_id:tenantId,p_limit:5
    });
    if(claimError) throw claimError;
    const recipients=claimed||[];
    if(campaign.status!=='sending') await db.from('whatsapp_campaigns').update({status:'sending',started_at:new Date().toISOString()}).eq('id',campaign.id);

    for(const recipient of recipients){
      const number=internationalPhone(recipient.phone,String(company.country_code||'BR'));
      const text=renderCampaignMessage(String(campaign.message),{
        nome:String(recipient.customer_name||'Cliente'),
        empresa:String(company.name||''),
        cupom:couponCode,
        link_cardapio:`${(secret('MENU_URL')||'https://app.cardapioplus.com').replace(/\/$/,'')}/?slug=${encodeURIComponent(company.slug||'')}`
      });
      try{
        if(number.length<10) throw new Error('Número de WhatsApp inválido.');
        let result:any;
        if(campaign.image_url){
          const mime=campaign.image_mime_type||'image/jpeg';
          const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
          result=(await evolutionFetch(settings,`/message/sendMedia/${encodeURIComponent(integration.instance_name)}`,{
            method:'POST',body:JSON.stringify({number,mediatype:'image',mimetype:mime,caption:text,media:campaign.image_url,fileName:`campanha.${ext}`,delay:500})
          })).data;
        }else{
          result=(await evolutionFetch(settings,`/message/sendText/${encodeURIComponent(integration.instance_name)}`,{
            method:'POST',body:JSON.stringify({number,text,delay:500,linkPreview:true})
          })).data;
        }
        const providerId=result?.key?.id||result?.id||null;
        await db.from('whatsapp_campaign_recipients').update({status:'sent',sent_at:new Date().toISOString(),provider_message_id:providerId,error_message:null}).eq('id',recipient.id).eq('tenant_id',tenantId);
      }catch(sendError){
        const message=sendError instanceof Error?sendError.message:'Falha ao enviar.';
        await db.from('whatsapp_campaign_recipients').update({status:'failed',error_message:message.slice(0,500)}).eq('id',recipient.id).eq('tenant_id',tenantId);
      }
      await wait(350);
    }

    const [sentRes,failedRes,pendingRes]=await Promise.all([
      db.from('whatsapp_campaign_recipients').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).eq('tenant_id',tenantId).eq('status','sent'),
      db.from('whatsapp_campaign_recipients').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).eq('tenant_id',tenantId).eq('status','failed'),
      db.from('whatsapp_campaign_recipients').select('id',{count:'exact',head:true}).eq('campaign_id',campaign.id).eq('tenant_id',tenantId).in('status',['pending','processing'])
    ]);
    const totalSent=sentRes.count||0,totalFailed=failedRes.count||0,remaining=pendingRes.count||0;
    const hasMore=remaining>0;
    await db.from('whatsapp_campaigns').update({
      total_sent:totalSent,total_failed:totalFailed,status:hasMore?'sending':'completed',completed_at:hasMore?null:new Date().toISOString()
    }).eq('id',campaign.id).eq('tenant_id',tenantId);
    return json({has_more:hasMore,total_sent:totalSent,total_failed:totalFailed,processed:recipients.length});
  }catch(error){return handleError(error);}
});
