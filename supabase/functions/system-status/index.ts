import { createClient } from "npm:@supabase/supabase-js@2";\nimport { MAX_PRICE, MIN_BEDROOMS } from "../_shared/search-criteria.ts";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Cache-Control":"public, max-age=30"
};

function ageMinutes(value:any){
  if(!value)return null;
  const ms=Date.now()-new Date(value).getTime();
  return Number.isFinite(ms)?Math.max(0,Math.round(ms/60000)):null;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="GET")return new Response("Method not allowed",{status:405,headers:cors});

  try{
    const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    const secret=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!secret)throw new Error("missing server key");
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,secret,{
      auth:{persistSession:false,autoRefreshToken:false}
    });

    const [{data:properties,error:pError},{data:health,error:hError},{data:discoveries,error:dError}]=await Promise.all([
      supabase.from("properties")
        .select("status,safety_decision,price,bedrooms,last_seen,last_revalidation_at,first_seen"),
      supabase.from("source_health")
        .select("provider,status,ingestion_enabled,discovered_count,accepted_count,rejected_count,consecutive_failures,cooldown_until,last_run_at,last_success_at,recovery_count")
        .order("provider"),
      supabase.from("listing_discovery")
        .select("provider,state,last_seen,last_fetched_at")
        .range(0,9999)
    ]);
    if(pError)throw pError;
    if(hError)throw hError;
    if(dError)throw dError;

    const now=Date.now();
    const active=(properties||[]).filter((p:any)=>["candidate","verified"].includes(p.status));
    const compatible=active.filter((p:any)=>p.safety_decision==="ACCEPT");
    const review=active.filter((p:any)=>p.safety_decision==="REVIEW");
    const rejected=(properties||[]).filter((p:any)=>p.status==="quarantine"&&p.safety_decision==="REJECT");
    const withdrawn=(properties||[]).filter((p:any)=>p.status==="withdrawn");
    const overBudget=active.filter((p:any)=>Number(p.price)>MAX_PRICE);
    const underBedrooms=active.filter((p:any)=>Number(p.bedrooms)<MIN_BEDROOMS);
    const stale=active.filter((p:any)=>{
      const ref=p.last_revalidation_at||p.last_seen;
      return !ref||now-new Date(ref).getTime()>4*24*3600000;
    });
    const recent24h=active.filter((p:any)=>{
      const ref=p.first_seen;
      return ref&&now-new Date(ref).getTime()<=24*3600000;
    });
    const maxVisiblePrice=active.length?Math.max(...active.map((p:any)=>Number(p.price)||0)):null;

    const discoveryByProvider=new Map<string,any>();
    for(const row of discoveries||[]){
      const provider=String(row.provider||"unknown");
      const current=discoveryByProvider.get(provider)||{
        total:0,accepted:0,rejected:0,error:0,seen:0,planned:0,lastSeen:null,lastFetched:null
      };
      current.total++;
      if(Object.prototype.hasOwnProperty.call(current,row.state))current[row.state]++;
      if(row.last_seen&&(!current.lastSeen||new Date(row.last_seen)>new Date(current.lastSeen)))current.lastSeen=row.last_seen;
      if(row.last_fetched_at&&(!current.lastFetched||new Date(row.last_fetched_at)>new Date(current.lastFetched)))current.lastFetched=row.last_fetched_at;
      discoveryByProvider.set(provider,current);
    }

    const providers=(health||[]).map((h:any)=>{
      const discovery=discoveryByProvider.get(h.provider)||{
        total:0,accepted:0,rejected:0,error:0,seen:0,planned:0,lastSeen:null,lastFetched:null
      };
      return {
        provider:h.provider,
        status:h.status,
        enabled:!!h.ingestion_enabled,
        discoveredLastRun:Number(h.discovered_count||0),
        acceptedLastRun:Number(h.accepted_count||0),
        rejectedLastRun:Number(h.rejected_count||0),
        consecutiveFailures:Number(h.consecutive_failures||0),
        cooldownUntil:h.cooldown_until||null,
        lastRunAt:h.last_run_at||null,
        lastSuccessAt:h.last_success_at||null,
        recoveryCount:Number(h.recovery_count||0),
        lastRunAgeMinutes:ageMinutes(h.last_run_at),
        discovery
      };
    });

    const healthy=providers.filter((p:any)=>p.status==="ok"&&p.enabled).length;
    const quarantined=providers.filter((p:any)=>p.status==="quarantined"||!p.enabled).length;

    const payload={
      generatedAt:new Date().toISOString(),
      catalogue:{
        active:active.length,
        compatible:compatible.length,
        review:review.length,
        rejectedQuarantine:rejected.length,
        withdrawn:withdrawn.length,
        new24h:recent24h.length,
        stale:stale.length,
        maxVisiblePrice,
        overBudget:overBudget.length,
        underBedroomMinimum:underBedrooms.length
      },
      invariants:{
        budgetOk:overBudget.length===0&&maxVisiblePrice<=MAX_PRICE,
        bedroomsOk:underBedrooms.length===0,
        rejectLeakOk:active.every((p:any)=>p.safety_decision!=="REJECT")
      },
      sources:{
        total:providers.length,
        healthy,
        quarantined,
        providers
      }
    };

    return new Response(JSON.stringify(payload),{
      status:200,
      headers:{...cors,"Content-Type":"application/json; charset=utf-8"}
    });
  }catch(e){
    console.error(e);
    return new Response(JSON.stringify({ok:false,error:"status_unavailable"}),{
      status:500,
      headers:{...cors,"Content-Type":"application/json; charset=utf-8"}
    });
  }
});