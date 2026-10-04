import {cors,json,requireTenant,handleError,evolutionSettings,evolutionFetch,instanceName,evolutionState,evolutionPhone,qrCodeFrom} from '../_shared/wa-common.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'Método não permitido.'},405);
  try{
    const {db,tenantId}=await requireTenant(req);
    const settings=await evolutionSettings(db);
    const {data:stored}=await db.from('whatsapp_integrations').select('*').eq('tenant_id',tenantId).maybeSingle();
    let name=String(stored?.instance_name||instanceName(tenantId));
    let stateData:any={};
    let mustCreate=!stored;

    if(stored){
      try{
        stateData=(await evolutionFetch(settings,`/instance/connectionState/${encodeURIComponent(name)}`)).data;
      }catch(error){
        const message=error instanceof Error?error.message:'';
        if(!message.toLowerCase().includes('does not exist')&&!message.toLowerCase().includes('não existe')) throw error;
        // Não reutilizar o identificador órfão mantido pela Evolution.
        name=`${instanceName(tenantId)}-${Date.now().toString(36)}`;
        mustCreate=true;
      }
    }

    let created:any=null;
    if(mustCreate){
      const result=await evolutionFetch(settings,'/instance/create',{
        method:'POST',
        body:JSON.stringify({
          instanceName:name,
          integration:'WHATSAPP-BAILEYS',
          qrcode:true,
          rejectCall:true,
          groupsIgnore:true,
          alwaysOnline:false,
          readMessages:false,
          readStatus:false,
          syncFullHistory:false
        })
      });
      created=result.data;
      const {error:upsertError}=await db.from('whatsapp_integrations').upsert({
        tenant_id:tenantId,instance_name:name,status:'connecting',phone_number:null,connected_at:null
      },{onConflict:'tenant_id'});
      if(upsertError) throw upsertError;
    }

    const status=evolutionState(stateData);
    const phone=evolutionPhone(stateData);
    if(status==='connected'){
      await db.from('whatsapp_integrations').update({status,phone_number:phone||stored?.phone_number||null,connected_at:new Date().toISOString()}).eq('tenant_id',tenantId);
      return json({status,phone_number:phone||stored?.phone_number||null});
    }

    let qrcode=qrCodeFrom(created);
    if(!qrcode){
      const connect=(await evolutionFetch(settings,`/instance/connect/${encodeURIComponent(name)}`)).data;
      qrcode=qrCodeFrom(connect);
    }
    await db.from('whatsapp_integrations').update({status:'connecting'}).eq('tenant_id',tenantId);
    if(!qrcode) return json({status:'connecting',qrcode:null,message:'Instância criada, mas o QR Code ainda não ficou disponível.'},202);
    return json({status:'connecting',qrcode});
  }catch(error){return handleError(error);}
});
