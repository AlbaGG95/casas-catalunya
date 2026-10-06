import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { MAX_PRICE, MIN_BEDROOMS } from "../_shared/search-criteria.ts";

const ALLOWED_REPO="AlbaGG95/casas-catalunya";
const ALLOWED_REF="refs/heads/main";
const AUDIENCE="casas-catalunya-supabase";
const JWKS=createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

async function verifyGithub(req:Request){
  const auth=req.headers.get("authorization")||"";
  if(!auth.startsWith("Bearer "))throw new Error("missing bearer token");
  const {payload}=await jwtVerify(auth.slice(7),JWKS,{
    issuer:"https://token.actions.githubusercontent.com",
    audience:AUDIENCE
  });
  if(payload.repository!==ALLOWED_REPO)throw new Error("repository not allowed");
  if(payload.ref!==ALLOWED_REF)throw new Error("ref not allowed");
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  try{
    await verifyGithub(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"plan");
    const now=body?.generatedAt||new Date().toISOString();

    const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    const secret=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!secret)throw new Error("missing server key");
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,secret,{auth:{persistSession:false,autoRefreshToken:false}});

    if(action==="complete"){
      const results=Array.isArray(body?.pipelineResults)?body.pipelineResults:[];
      let ok=0,withdrawn=0,quarantined=0,errors=0;

      for(const result of results){
        const propertyId=String(result?.propertyId||"");
        const url=String(result?.url||"");
        if(!propertyId||!url)continue;

        const outcome=String(result?.outcome||"error");
        const reason=String(result?.reason||"");
        const sourcePatch:any={last_revalidation_at:now};

        if(outcome==="accepted"){
          sourcePatch.revalidation_failures=0;
          sourcePatch.last_revalidation_status="ok";
          const {error}=await supabase.from("listing_sources").update(sourcePatch)
            .eq("property_id",propertyId).eq("url",url);
          if(error)throw error;
          const {error:pError}=await supabase.from("properties")
            .update({last_revalidation_at:now,last_seen:now})
            .eq("id",propertyId);
          if(pError)throw pError;
          ok++;
          continue;
        }

        if(outcome==="rejected"&&reason==="unavailable"){
          sourcePatch.last_revalidation_status="unavailable";
          sourcePatch.revalidation_failures=0;
          sourcePatch.active=false;
          const {error}=await supabase.from("listing_sources").update(sourcePatch)
            .eq("property_id",propertyId).eq("url",url);
          if(error)throw error;
          const {error:pError}=await supabase.from("properties")
            .update({status:"withdrawn",last_revalidation_at:now,last_checked:now})
            .eq("id",propertyId);
          if(pError)throw pError;
          withdrawn++;
          continue;
        }

        if(outcome==="rejected"&&(reason.startsWith("safety:")||["precio","habitaciones","anuncio antiguo","rústica"].includes(reason))){
          sourcePatch.last_revalidation_status="rejected";
          sourcePatch.revalidation_failures=0;
          const {error}=await supabase.from("listing_sources").update(sourcePatch)
            .eq("property_id",propertyId).eq("url",url);
          if(error)throw error;
          const {error:pError}=await supabase.from("properties")
            .update({
              status:"quarantine",
              quarantine_reason:"revalidation:"+reason,
              last_revalidation_at:now,
              last_checked:now
            })
            .eq("id",propertyId);
          if(pError)throw pError;
          quarantined++;
          continue;
        }

        const {data:source,error:readError}=await supabase.from("listing_sources")
          .select("revalidation_failures")
          .eq("property_id",propertyId).eq("url",url).maybeSingle();
        if(readError)throw readError;
        const failures=Number(source?.revalidation_failures||0)+1;
        sourcePatch.revalidation_failures=failures;
        sourcePatch.last_revalidation_status="error";
        const {error}=await supabase.from("listing_sources").update(sourcePatch)
          .eq("property_id",propertyId).eq("url",url);
        if(error)throw error;

        // Network/parser errors alone do not immediately hide a home.
        // After 3 independent revalidation failures it is quarantined for manual/scheduled recovery.
        if(failures>=3){
          const {error:pError}=await supabase.from("properties")
            .update({
              status:"quarantine",
              quarantine_reason:"revalidation_errors:"+failures,
              last_revalidation_at:now,
              last_checked:now
            })
            .eq("id",propertyId);
          if(pError)throw pError;
          quarantined++;
        }
        errors++;
      }

      return Response.json({ok:true,processed:results.length,valid:ok,withdrawn,quarantined,errors});
    }

    const limit=Math.max(1,Math.min(100,Number(body?.limit)||60));
    const {data,error}=await supabase.from("listing_sources")
      .select(`
        property_id,provider,url,canonical_url,last_checked,last_revalidation_at,revalidation_failures,
        properties!inner(id,status,price,bedrooms,province,safety_decision,last_seen)
      `)
      .eq("active",true)
      .in("properties.status",["candidate","verified"])
      .lte("properties.price",MAX_PRICE)
      .gte("properties.bedrooms",MIN_BEDROOMS)
      .order("last_revalidation_at",{ascending:true,nullsFirst:true})
      .order("last_checked",{ascending:true})
      .limit(300);
    if(error)throw error;

    const {data:securityRows,error:securityError}=await supabase
      .from("listing_security_text")
      .select("property_id");
    if(securityError)throw securityError;
    const securityPropertyIds=new Set((securityRows||[]).map((x:any)=>x.property_id));

    const nowMs=new Date(now).getTime();
    const due=(data||[])
      .map((row:any)=>({...row,needsSecurityBackfill:!securityPropertyIds.has(row.property_id)}))
      .filter((row:any)=>{
        const p=Array.isArray(row.properties)?row.properties[0]:row.properties;
        if(!p)return false;
        if(row.needsSecurityBackfill)return true;
        const ref=row.last_revalidation_at||row.last_checked||p.last_seen;
        const age=ref?nowMs-new Date(ref).getTime():Infinity;
        const maxAge=p.safety_decision==="REVIEW"?6*3600000:12*3600000;
        return age>=maxAge;
      })
      .sort((a:any,b:any)=>Number(b.needsSecurityBackfill)-Number(a.needsSecurityBackfill))
      .slice(0,limit);

    const items=due.map((row:any)=>{
      const p=Array.isArray(row.properties)?row.properties[0]:row.properties;
      return {
        propertyId:row.property_id,
        provider:row.provider,
        province:p?.province||"",
        kind:"revalidate",
        url:row.url,
        listText:"",
        revalidation:true
      };
    });

    return Response.json({
      ok:true,
      generatedAt:now,
      scanMode:"deep",
      revalidation:true,
      planned:items.length,
      sourceStatus:{},
      items
    });
  }catch(e){
    console.error(e);
    return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:401});
  }
});