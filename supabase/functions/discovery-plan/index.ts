import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

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

function canonicalize(input:string){
  try{
    const u=new URL(input);
    u.hash="";
    for(const key of [...u.searchParams.keys()]){
      if(/^(from|utm_|source|campaign|medium|ref)/i.test(key))u.searchParams.delete(key);
    }
    return u.toString();
  }catch{return input}
}

function chunks<T>(items:T[],size=80){
  const out:T[][]=[];
  for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));
  return out;
}

function rejectionAuditText(x:any,outcome:string){
  const base=String(x?.reason||(outcome==="error"?"detail_error":"rejected")).trim();
  const detail=x?.safetyEvidence;
  if(!detail||typeof detail!=="object")return base.slice(0,500);
  const source=String(detail.source||"").trim();
  const match=String(detail.match||"").trim();
  const excerpt=String(detail.excerpt||"").replace(/\s+/g," ").trim();
  const evidence=[source&&`source=${source}`,match&&`match=${match}`,excerpt&&`excerpt=${excerpt}`]
    .filter(Boolean).join(" | ");
  return (evidence?`${base} | ${evidence}`:base).slice(0,500);
}

async function selectByUrls(supabase:any,table:string,columns:string,urls:string[],extra?:(q:any)=>any){
  const all:any[]=[];
  for(const part of chunks(urls)){
    let q=supabase.from(table).select(columns).in("canonical_url",part);
    if(extra)q=extra(q);
    const {data,error}=await q;
    if(error)throw error;
    all.push(...(data||[]));
  }
  return all;
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return new Response("Method not allowed",{status:405});
  try{
    await verifyGithub(req);
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||"plan");

    const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
    const secret=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!secret)throw new Error("missing server key");
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,secret,{auth:{persistSession:false,autoRefreshToken:false}});

    if(action==="complete"){
      const results=Array.isArray(body?.pipelineResults)?body.pipelineResults:[];
      const urls=[...new Set(results.map((x:any)=>canonicalize(String(x?.url||""))).filter(Boolean))];
      if(!urls.length)return Response.json({ok:true,completed:0});

      const prior=await selectByUrls(supabase,"listing_discovery","canonical_url,fetch_count",urls);
      const priorMap=new Map(prior.map((x:any)=>[x.canonical_url,x]));
      const now=body?.generatedAt||new Date().toISOString();
      const rows=results.map((x:any)=>{
        const url=canonicalize(String(x?.url||""));
        const old:any=priorMap.get(url)||{};
        const outcome=["accepted","rejected","error"].includes(x?.outcome)?x.outcome:"error";
        return {
          canonical_url:url,
          provider:String(x?.provider||"unknown"),
          province:x?.province||null,
          source_kind:x?.kind||null,
          last_seen:now,
          last_fetched_at:now,
          fetch_count:Number(old.fetch_count||0)+1,
          state:outcome,
          last_error:outcome==="accepted"?null:rejectionAuditText(x,outcome)
        };
      }).filter((x:any)=>x.canonical_url);

      for(const part of chunks(rows,100)){
        const {error}=await supabase.from("listing_discovery").upsert(part,{onConflict:"canonical_url"});
        if(error)throw error;
      }
      return Response.json({ok:true,completed:rows.length});
    }

    const discoveries=Array.isArray(body?.discoveries)?body.discoveries:[];
    const scanMode=body?.scanMode==="deep"?"deep":"recent";
    const sourceStatus=body?.sourceStatus||{};
    const generatedAt=body?.generatedAt||new Date().toISOString();

    const byUrl=new Map<string,any>();
    for(const raw of discoveries){
      const url=canonicalize(String(raw?.url||""));
      if(!/^https?:\/\//i.test(url))continue;
      if(!byUrl.has(url))byUrl.set(url,{...raw,url});
    }
    const items=[...byUrl.values()];
    const urls=[...byUrl.keys()];
    if(!urls.length)return Response.json({ok:true,discovered:0,planned:0,items:[],sourceStatus,scanMode,generatedAt});

    const [ledger,sources,recentRejections,securityRows]=await Promise.all([
      selectByUrls(supabase,"listing_discovery","canonical_url,last_planned_at,last_fetched_at,state,fetch_count",urls),
      selectByUrls(supabase,"listing_sources","canonical_url,last_checked,active",urls),
      selectByUrls(
        supabase,"rejections","canonical_url,detected_at,reason",urls,
        q=>q.gte("detected_at",new Date(Date.now()-48*3600000).toISOString())
      ),
      selectByUrls(supabase,"listing_security_text","canonical_url",urls)
    ]);

    const ledgerMap=new Map(ledger.map((x:any)=>[x.canonical_url,x]));
    const sourceMap=new Map(sources.map((x:any)=>[x.canonical_url,x]));
    const rejectionMap=new Map(recentRejections.map((x:any)=>[x.canonical_url,x]));
    const securityMap=new Set(securityRows.map((x:any)=>x.canonical_url));

    const seenRows=items.map((x:any)=>({
      canonical_url:x.url,
      provider:String(x.provider||"unknown"),
      province:x.province||null,
      source_kind:x.kind||null,
      list_text:String(x.listText||"").slice(0,2000)||null,
      last_seen:generatedAt
    }));
    for(const part of chunks(seenRows,100)){
      const {error}=await supabase.from("listing_discovery").upsert(part,{onConflict:"canonical_url"});
      if(error)throw error;
    }

    const knownFreshMs=scanMode==="deep"?24*3600000:6*3600000;
    const plannedRetryMs=30*60000;
    const nowMs=new Date(generatedAt).getTime();
    const eligible:any[]=[];

    for(const item of items){
      const old:any=ledgerMap.get(item.url);
      const source:any=sourceMap.get(item.url);
      const reject:any=rejectionMap.get(item.url);

      if(reject)continue;

      const needsSecurityBackfill=!!source&&!securityMap.has(item.url);
      const checkedMs=source?.last_checked?new Date(source.last_checked).getTime():0;
      if(source&&checkedMs&&nowMs-checkedMs<knownFreshMs&&!needsSecurityBackfill)continue;

      const fetchedMs=old?.last_fetched_at?new Date(old.last_fetched_at).getTime():0;
      if(old?.state==="rejected"&&fetchedMs&&nowMs-fetchedMs<48*3600000)continue;
      if(old?.state==="error"&&fetchedMs&&nowMs-fetchedMs<30*60000)continue;

      const plannedMs=old?.last_planned_at?new Date(old.last_planned_at).getTime():0;
      if(!source&&plannedMs&&nowMs-plannedMs<plannedRetryMs)continue;

      eligible.push({
        ...item,
        isNew:!old&&!source,
        needsSecurityBackfill,
        lastFetchedAt:old?.last_fetched_at||source?.last_checked||null
      });
    }

    eligible.sort((a,b)=>{
      if(a.needsSecurityBackfill!==b.needsSecurityBackfill)return a.needsSecurityBackfill?-1:1;
      if(a.isNew!==b.isNew)return a.isNew?-1:1;
      return new Date(a.lastFetchedAt||0).getTime()-new Date(b.lastFetchedAt||0).getTime();
    });

    const limit=scanMode==="deep"?160:80;
    const selected=eligible.slice(0,limit);

    if(selected.length){
      for(const part of chunks(selected,100)){
        const rows=part.map((x:any)=>({
          canonical_url:x.url,
          provider:String(x.provider||"unknown"),
          province:x.province||null,
          source_kind:x.kind||null,
          list_text:String(x.listText||"").slice(0,2000)||null,
          last_seen:generatedAt,
          last_planned_at:generatedAt,
          state:"planned"
        }));
        const {error}=await supabase.from("listing_discovery").upsert(rows,{onConflict:"canonical_url"});
        if(error)throw error;
      }
    }

    return Response.json({
      ok:true,
      discovered:items.length,
      planned:selected.length,
      items:selected,
      sourceStatus,
      scanMode,
      generatedAt
    });
  }catch(e){
    console.error(e);
    return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:401});
  }
});