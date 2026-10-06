import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { evaluateSafetyText, evaluateSafetyDocument, SAFETY_DECISIONS } from "./safety-engine.ts";
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

    const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    const secret=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!secret)throw new Error("missing server key");

    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,secret,{
      auth:{persistSession:false,autoRefreshToken:false}
    });

    const {data:rows,error}=await supabase
      .from("properties")
      .select("id,title,summary,status,price,bedrooms,condition_status,safety_decision,safety_code")
      .in("status",["candidate","verified"])
      .lte("price",MAX_PRICE)
      .gte("bedrooms",MIN_BEDROOMS);

    if(error)throw error;

    const ids=(rows||[]).map((p:any)=>p.id);
    const securityByProperty=new Map<string,any>();
    if(ids.length){
      const {data:securityRows,error:securityError}=await supabase
        .from("listing_security_text")
        .select("id,property_id,title_text,meta_description,structured_text,body_text,safety_text,captured_at")
        .in("property_id",ids)
        .order("captured_at",{ascending:false});
      if(securityError)throw securityError;
      for(const row of securityRows||[]){
        if(!securityByProperty.has(row.property_id)&&row.safety_text){
          securityByProperty.set(row.property_id,row);
        }
      }
    }

    let accepted=0,review=0,rejected=0,fullTextUsed=0;
    const details:any[]=[];

    for(const p of rows||[]){
      const privateDoc=securityByProperty.get(p.id);
      const text=privateDoc?.safety_text||`${p.title||""} ${p.summary||""}`;
      const result=privateDoc
        ? evaluateSafetyDocument({
            title:privateDoc.title_text,
            metaDescription:privateDoc.meta_description,
            structuredText:privateDoc.structured_text,
            bodyText:privateDoc.body_text,
            safetyText:privateDoc.safety_text
          })
        : evaluateSafetyText(text);
      if(privateDoc)fullTextUsed++;
      const now=new Date().toISOString();

      if(result.decision===SAFETY_DECISIONS.REJECT){
        const {error:updateError}=await supabase.from("properties")
          .update({
            status:"quarantine",
            condition_status:"pending",
            safety_decision:"REJECT",
            safety_reason:result.reason,
            safety_code:result.code,
            quarantine_reason:"safety_v2:"+result.code,
            last_checked:now,
            last_verified_at:null
          })
          .eq("id",p.id);
        if(updateError)throw updateError;

        const {error:sourceError}=await supabase.from("listing_sources")
          .update({
            safety_decision:"REJECT",
            safety_reason:result.reason,
            safety_code:result.code
          })
          .eq("property_id",p.id);
        if(sourceError)throw sourceError;

        rejected++;
      }else{
        const conditionStatus=result.decision===SAFETY_DECISIONS.ACCEPT?"confirmed":"pending";
        const {error:updateError}=await supabase.from("properties")
          .update({
            condition_status:conditionStatus,
            safety_decision:result.decision,
            safety_reason:result.reason,
            safety_code:result.code,
            quarantine_reason:null,
            last_checked:now
          })
          .eq("id",p.id);
        if(updateError)throw updateError;

        const {error:sourceError}=await supabase.from("listing_sources")
          .update({
            safety_decision:result.decision,
            safety_reason:result.reason,
            safety_code:result.code
          })
          .eq("property_id",p.id)
          .eq("active",true);
        if(sourceError)throw sourceError;

        if(result.decision===SAFETY_DECISIONS.ACCEPT)accepted++;
        else review++;
      }

      if(privateDoc){
        const detail=result.evidenceDetail||{};
        const {error:evidenceError}=await supabase.from("listing_security_text")
          .update({
            safety_decision:result.decision,
            safety_code:result.code,
            safety_reason:result.reason,
            evidence_source:detail.source||null,
            evidence_match:detail.match?String(detail.match).slice(0,300):null,
            evidence_excerpt:detail.excerpt?String(detail.excerpt).slice(0,260):null,
            updated_at:now
          })
          .eq("id",privateDoc.id);
        if(evidenceError)throw evidenceError;
      }

      details.push({
        id:p.id,
        from:p.safety_decision||null,
        to:result.decision,
        code:result.code,
        evidenceSource:result.evidenceDetail?.source||null
      });
    }

    return Response.json({
      ok:true,
      processed:(rows||[]).length,
      accepted,
      review,
      rejected,
      fullTextUsed,
      details
    });
  }catch(e){
    console.error(e);
    return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:401});
  }
});
