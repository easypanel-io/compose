import {cors,json,requireTenant,handleError,evolutionSettings,evolutionFetch} from '../_shared/wa-common.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({error:'Método não permitido.'},405);
  try{
    const {db,tenantId}=await requireTenant(req);
    const {data:integration,error}=await db.from('whatsapp_integrations').select('instance_name').eq('tenant_id',tenantId).maybeSingle();
    if(error) throw error;
    if(!integration) return json({ok:true,status:'disconnected'});
    const settings=await evolutionSettings(db);
    try{await evolutionFetch(settings,`/instance/logout/${encodeURIComponent(integration.instance_name)}`,{method:'DELETE'},[400,404]);}catch(_){/* continua para excluir */}
    try{await evolutionFetch(settings,`/instance/delete/${encodeURIComponent(integration.instance_name)}`,{method:'DELETE'},[400,404]);}catch(_){/* remove o vínculo local mesmo se já não existir */}
    const {error:deleteError}=await db.from('whatsapp_integrations').delete().eq('tenant_id',tenantId);
    if(deleteError) throw deleteError;
    return json({ok:true,status:'disconnected'});
  }catch(error){return handleError(error);}
});
