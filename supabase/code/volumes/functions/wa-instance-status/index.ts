import {cors,json,requireTenant,handleError,evolutionSettings,evolutionFetch,evolutionState,evolutionPhone} from '../_shared/wa-common.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='GET') return json({error:'Método não permitido.'},405);
  try{
    const {db,tenantId}=await requireTenant(req);
    const {data:integration,error}=await db.from('whatsapp_integrations').select('*').eq('tenant_id',tenantId).maybeSingle();
    if(error) throw error;
    if(!integration) return json({status:'disconnected',phone_number:null});
    const settings=await evolutionSettings(db);
    let stateData:any={};
    try{
      stateData=(await evolutionFetch(settings,`/instance/connectionState/${encodeURIComponent(integration.instance_name)}`)).data;
    }catch(error){
      await db.from('whatsapp_integrations').update({status:'disconnected',phone_number:null}).eq('tenant_id',tenantId);
      return json({status:'disconnected',phone_number:null});
    }
    let status=evolutionState(stateData);
    let phone=evolutionPhone(stateData)||integration.phone_number||'';
    if(status==='connected'&&!phone){
      try{
        const fetched=(await evolutionFetch(settings,`/instance/fetchInstances?instanceName=${encodeURIComponent(integration.instance_name)}`)).data;
        const row=Array.isArray(fetched)?fetched[0]:fetched;
        phone=evolutionPhone(row);
      }catch(_){/* número é apenas informativo */}
    }
    await db.from('whatsapp_integrations').update({
      status,phone_number:phone||null,
      connected_at:status==='connected'?(integration.connected_at||new Date().toISOString()):integration.connected_at
    }).eq('tenant_id',tenantId);
    return json({status,phone_number:phone||null});
  }catch(error){return handleError(error);}
});
