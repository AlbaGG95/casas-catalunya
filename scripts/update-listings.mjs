import fs from "node:fs/promises";
import crypto from "node:crypto";
import * as cheerio from "cheerio";

const DATA_PATH=new URL("../data/listings.json",import.meta.url);
const MAX_PRICE=185000;
const MIN_BEDROOMS=3;

const SOURCES=[
  {provider:"Fotocasa",province:"Barcelona",url:"https://www.fotocasa.es/es/comprar/viviendas/barcelona-provincia/todas-las-zonas/publicado-ultimas-48-horas/l?priceMax=185000&bedroomsMin=3"},
  {provider:"Fotocasa",province:"Tarragona",url:"https://www.fotocasa.es/es/comprar/viviendas/tarragona-provincia/todas-las-zonas/publicado-ultimas-48-horas/l?priceMax=185000&bedroomsMin=3"},
  {provider:"Fotocasa",province:"Girona",url:"https://www.fotocasa.es/es/comprar/viviendas/girona-provincia/todas-las-zonas/publicado-ultimas-48-horas/l?priceMax=185000&bedroomsMin=3"},
  {provider:"Fotocasa",province:"Lleida",url:"https://www.fotocasa.es/es/comprar/viviendas/lleida-provincia/todas-las-zonas/publicado-ultimas-48-horas/l?priceMax=185000&bedroomsMin=3"},
  {provider:"Habitaclia",province:"Barcelona",url:"https://www.habitaclia.com/comprar/casas/barcelona-provincia/s"},
  {provider:"Habitaclia",province:"Tarragona",url:"https://www.habitaclia.com/comprar/casas/tarragona-provincia/s"},
  {provider:"Habitaclia",province:"Girona",url:"https://www.habitaclia.com/comprar/casas/girona-provincia/s"},
  {provider:"Habitaclia",province:"Lleida",url:"https://www.habitaclia.com/comprar/casas/lleida-provincia/s"},
  {provider:"Yaencontre",province:"Barcelona",url:"https://www.yaencontre.com/venta/viviendas/barcelona-provincia"},
  {provider:"Yaencontre",province:"Tarragona",url:"https://www.yaencontre.com/venta/viviendas/tarragona-provincia"},
  {provider:"Pisos.com",province:"Barcelona",url:"https://www.pisos.com/venta/casas-barcelona/"},
  {provider:"Pisos.com",province:"Tarragona",url:"https://www.pisos.com/venta/casas-tarragona/"}
];

const REJECT_PATTERNS=[
  ["ocupada",/\bocupad[ao]s?\b/i],
  ["sin posesión",/sin\s+posesi[oó]n/i],
  ["inquilinos",/\binquilin[oa]s?\b|con\s+arrendatari/i],
  ["alquilada",/\balquilad[ao]s?\b|\barrendad[ao]s?\b/i],
  ["no visitable",/no\s+(?:se\s+puede\s+)?visitar|no\s+visitable/i],
  ["nuda propiedad",/nuda\s+propiedad/i],
  ["proindiviso",/proindiviso|pro-indiviso/i],
  ["subasta",/\bsubasta\b|cesi[oó]n\s+de\s+remate/i],
  ["solo inversores",/s[oó]lo\s+(?:para\s+)?inversores|especial\s+inversores/i],
  ["no hipotecable",/no\s+hipotecable|no\s+admite\s+hipoteca/i],
  ["sin cédula",/sin\s+c[eé]dula/i],
  ["reforma integral",/reforma\s+integral|para\s+reformar|a\s+reformar|necesita\s+reforma/i],
  ["ruina",/\bruina\b|para\s+derribar|derribo/i],
  ["adosada",/\badosad[ao]s?\b/i],
  ["pareada",/\bparead[ao]s?\b/i],
  ["casa de pueblo",/casa\s+de\s+pueblo/i],
  ["finca rústica",/finca\s+r[uú]stica|suelo\s+r[uú]stico/i],
  ["sin servicios",/sin\s+alcantarillado|sin\s+agua\s+de\s+red|sin\s+luz\s+de\s+red/i]
];

const POSITIVE={
  house:/casa|chalet|torre|unifamiliar|vivienda\s+independiente/i,
  independent:/casa\s+independiente|chalet\s+independiente|cuatro\s+vientos|4\s+vientos|a\s+cuatro\s+vientos/i,
  garden:/jard[ií]n|parcela|patio\s+privado|terreno\s+privado/i,
  condition:/buen\s+estado|muy\s+buen\s+estado|reformad[ao]|para\s+entrar\s+a\s+vivir|lista\s+para\s+entrar|obra\s+nueva|semi\s*nuev/i,
  free:/libre\s+de\s+ocupantes|entrega\s+libre|vivienda\s+vac[ií]a|desocupad[ao]|sin\s+inquilinos/i,
  fiber:/fibra\s+[oó]ptica|fibra\s+disponible/i
};

const UA="Mozilla/5.0 (compatible; CasasCatalunyaFamilyFinder/1.0; +https://github.com/AlbaGG95/casas-catalunya)";
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>(s||"").replace(/\s+/g," ").trim();
const slug=s=>clean(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const today=()=>new Date().toISOString().slice(0,10);

async function fetchHtml(url){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),15000);
  try{
    const r=await fetch(url,{headers:{"user-agent":UA,"accept-language":"es-ES,es;q=.9,en;q=.5"},redirect:"follow",signal:ctrl.signal});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const ct=r.headers.get("content-type")||"";
    if(!ct.includes("text/html")) throw new Error("not html");
    return await r.text();
  } finally { clearTimeout(t); }
}

function abs(base,href){
  try{return new URL(href,base).toString().split("#")[0]}catch{return null}
}
function isDetail(provider,url){
  if(provider==="Fotocasa") return /\/es\/comprar\/vivienda\//i.test(url);
  if(provider==="Habitaclia") return /\/comprar\/(?:vivienda|casa|chalet)\//i.test(url);
  if(provider==="Yaencontre") return /\/venta\/(?:casa|piso|chalet|vivienda)\//i.test(url);
  if(provider==="Pisos.com") return /\/comprar\//i.test(url);
  return false;
}
function discover(provider,base,html){
  const $=cheerio.load(html);
  const urls=new Set();
  $("a[href]").each((_,a)=>{
    const u=abs(base,$(a).attr("href"));
    if(u&&isDetail(provider,u)) urls.add(u);
  });
  return [...urls].slice(0,24);
}
function allJsonLd($){
  const items=[];
  $('script[type="application/ld+json"]').each((_,s)=>{
    try{
      const v=JSON.parse($(s).text());
      const walk=x=>{
        if(!x)return;
        if(Array.isArray(x)) return x.forEach(walk);
        if(typeof x==="object"){items.push(x);Object.values(x).forEach(walk)}
      };
      walk(v);
    }catch{}
  });
  return items;
}
function firstNumber(v){
  if(v==null)return null;
  const n=Number(String(v).replace(/[^0-9.,]/g,"").replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)&&n>0?n:null;
}
function extractPrice(text,items){
  for(const x of items){
    const p=x?.offers?.price??x?.price??x?.offers?.lowPrice;
    const n=firstNumber(p);
    if(n&&n>=10000&&n<=2000000)return Math.round(n);
  }
  const m=text.match(/(?:precio[^0-9]{0,20})?(\d{2,3}(?:[.\s]\d{3})+|\d{5,6})\s*€/i);
  return m?Number(m[1].replace(/[.\s]/g,"")):null;
}
function extractBedrooms(text,items){
  for(const x of items){
    const vals=[x.numberOfRooms,x.numberOfBedrooms,x.numberOfBedroomsTotal,x.bedrooms];
    for(const v of vals){const n=firstNumber(v);if(n&&n<30)return Math.round(n)}
  }
  const m=text.match(/(\d{1,2})\s*(?:hab\.?|habitaciones?|dormitorios?)/i);
  return m?Number(m[1]):null;
}
function toM2(raw,max=10000){
  if(!raw)return null;
  const n=Math.round(Number(String(raw).replace(/\./g,"").replace(",",".")));
  return Number.isFinite(n)&&n>=20&&n<=max?n:null;
}
function extractM2(text,label,metaDescription=""){
  if(label==="house"){
    // Los portales suelen poner primero los m² reales de vivienda en la meta descripción.
    const md=clean(metaDescription);
    const mm=md.match(/(?:^|[.,;:]\s*|\s)(\d{2,4}(?:[.,]\d+)?)\s*m(?:²|2)(?:\b|,)/i);
    const fromMeta=toM2(mm?.[1],1000);
    if(fromMeta)return fromMeta;
    const candidates=[...text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*m(?:²|2)\s*(?:construidos?|de\s+vivienda|útiles|utiles)?/gi)]
      .map(m=>toM2(m[1],1000)).filter(Boolean);
    return candidates.length?Math.min(...candidates):null;
  }
  const m=text.match(/(?:parcela|terreno)[^0-9]{0,40}(\d{2,5}(?:[.,]\d+)?)\s*m(?:²|2)/i);
  return toM2(m?.[1],20000);
}
function extractPlace(items,$,fallbackProvince){
  for(const x of items){
    const a=x.address||x.location?.address;
    const p=a?.addressLocality||a?.addressRegion;
    if(p)return clean(p);
  }
  const crumb=$('[aria-label*="breadcrumb" i],.breadcrumb,.breadcrumbs').text();
  if(crumb){
    const parts=clean(crumb).split(/\s*[>›|]\s*/).filter(Boolean);
    if(parts.length>1)return parts.at(-2);
  }
  return "";
}
function extractProvince(items,fallback){
  for(const x of items){
    const a=x.address||x.location?.address;
    const r=clean(a?.addressRegion||"");
    if(/barcelona/i.test(r))return "Barcelona";
    if(/tarragona/i.test(r))return "Tarragona";
    if(/girona|gerona/i.test(r))return "Girona";
    if(/lleida|lérida|lerida/i.test(r))return "Lleida";
  }
  return fallback;
}
function extractGeo(items){
  for(const x of items){
    const g=x.geo||x.location?.geo;
    const lat=Number(g?.latitude),lon=Number(g?.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=40&&lat<=43.5&&lon>=0&&lon<=3.5)return {lat,lon};
  }
  return null;
}
async function routeMinutes(geo){
  if(!geo)return null;
  const origin={lat:41.4247,lon:2.1647};
  const url=`https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${geo.lon},${geo.lat}?overview=false`;
  try{
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),9000);
    const r=await fetch(url,{headers:{"user-agent":UA},signal:ctrl.signal});
    clearTimeout(t);
    if(!r.ok)return null;
    const j=await r.json();
    const sec=j?.routes?.[0]?.duration;
    return Number.isFinite(sec)?sec/60:null;
  }catch{return null}
}
function occupancy(text){
  return POSITIVE.free.test(text)?"confirmed_free":"no_signals";
}
function hardReject(text){
  for(const [reason,rx] of REJECT_PATTERNS) if(rx.test(text)) return reason;
  return null;
}
function scoreOf(x,text){
  let s=40;
  if(x.price<=170000)s+=10; else if(x.price<=180000)s+=6;
  if(x.bedrooms>=4)s+=6; else s+=3;
  if(POSITIVE.independent.test(text))s+=15; else s+=6;
  if(POSITIVE.garden.test(text))s+=10;
  if(POSITIVE.condition.test(text))s+=10;
  if(POSITIVE.free.test(text))s+=6;
  if(POSITIVE.fiber.test(text))s+=5;
  if(x.plotM2>=400)s+=5;
  if(x.houseM2&&x.houseM2>=90)s+=3;
  return Math.min(100,s);
}
function idFor(provider,url,title,place){
  const key=provider+"|"+(url||title+"|"+place);
  return slug(provider)+"-"+crypto.createHash("sha1").update(key).digest("hex").slice(0,12);
}
function summarize(title,place,price,bedrooms,plotM2){
  const bits=[title];
  if(place)bits.push("en "+place);
  bits.push(bedrooms+" habitaciones");
  if(plotM2)bits.push("parcela aprox. "+plotM2+" m²");
  bits.push("por "+new Intl.NumberFormat("es-ES").format(price)+" €");
  return bits.join(", ")+".";
}
function parseDetail(provider,province,url,html){
  const $=cheerio.load(html);
  const text=clean($("body").text());
  const reject=hardReject(text);
  if(reject)return {reject};
  if(!POSITIVE.house.test(text))return {reject:"no parece casa"};
  if(!POSITIVE.garden.test(text))return {reject:"sin jardín/parcela detectada"};
  if(!POSITIVE.condition.test(text))return {reject:"sin evidencia de buen estado"};

  const items=allJsonLd($);
  const title=clean($("h1").first().text()||$('meta[property="og:title"]').attr("content")||$("title").text()).slice(0,180);
  const price=extractPrice(text,items);
  const bedrooms=extractBedrooms(text,items);
  if(!price||price>MAX_PRICE)return {reject:"precio"};
  if(!bedrooms||bedrooms<MIN_BEDROOMS)return {reject:"habitaciones"};

  const place=extractPlace(items,$,province);
  const finalProvince=extractProvince(items,province);
  const metaDescription=clean($('meta[name="description"]').attr("content"));
  const plotM2=extractM2(text,"plot",metaDescription);
  const houseM2=extractM2(text,"house",metaDescription);
  const independent=POSITIVE.independent.test(text);
  const conditionOk=POSITIVE.condition.test(text);
  const fiber=POSITIVE.fiber.test(text);
  const geo=extractGeo(items);

  const listing={
    id:idFor(provider,url,title,place),
    provider,title:title||"Casa detectada",place,province:finalProvince,price,bedrooms,plotM2,houseM2,
    url,summary:metaDescription?.slice(0,360)||summarize(title,place,price,bedrooms,plotM2),
    active:true,occupancyStatus:occupancy(text),
    independentStatus:independent?"confirmed":"pending",
    conditionStatus:conditionOk?"confirmed":"pending",
    fiberStatus:fiber?"confirmed":"pending",
    travelStatus:"pending",
    driveMinutes:null,
    geo,
    score:0
  };
  listing.score=scoreOf(listing,text);
  return {listing};
}
function mergeListing(old,newItem,now){
  const history=Array.isArray(old?.priceHistory)?old.priceHistory:[];
  const last=history.at(-1);
  if(!last||last.price!==newItem.price)history.push({date:today(),price:newItem.price});
  return {
    ...old,...newItem,
    firstSeen:old?.firstSeen||now,
    lastSeen:now,
    missedRuns:0,
    active:true,
    priceHistory:history.slice(-20)
  };
}

async function main(){
  const now=new Date().toISOString();
  const prior=JSON.parse(await fs.readFile(DATA_PATH,"utf8"));
  const byUrl=new Map((prior.listings||[]).map(x=>[x.url,x]));
  const found=new Map();
  const sourceStatus={};

  for(const src of SOURCES){
    const key=src.provider+" "+src.province;
    try{
      const html=await fetchHtml(src.url);
      const detailUrls=discover(src.provider,src.url,html);
      sourceStatus[key]={ok:true,discovered:detailUrls.length};
      for(const url of detailUrls){
        try{
          const detail=await fetchHtml(url);
          const parsed=parseDetail(src.provider,src.province,url,detail);
          if(parsed.listing){
            if(parsed.listing.geo){
              const mins=await routeMinutes(parsed.listing.geo);
              if(mins!=null){
                if(mins>90) { await wait(250); continue; }
                parsed.listing.driveMinutes=Math.round(mins);
                parsed.listing.travelStatus="confirmed";
                parsed.listing.score=Math.min(100,parsed.listing.score+5);
              }
            }
            const old=byUrl.get(url);
            found.set(url,mergeListing(old,parsed.listing,now));
          }
        }catch(e){
          console.warn("detail failed",url,e.message);
        }
        await wait(350);
      }
    }catch(e){
      sourceStatus[key]={ok:false,error:e.message};
      console.warn("source failed",key,e.message);
    }
    await wait(700);
  }

  // Revalidar directamente las candidatas existentes para que un portal bloqueado
  // o una búsqueda que no las muestre no las marque como retiradas por error.
  for(const old of prior.listings||[]){
    if(found.has(old.url))continue;
    try{
      const html=await fetchHtml(old.url);
      const $=cheerio.load(html);
      const text=clean($("body").text());
      const unavailable=/anuncio\s+(?:ya\s+)?no\s+disponible|inmueble\s+(?:ya\s+)?no\s+disponible|anuncio\s+retirado|inmueble\s+retirado|\breservad[ao]\b/i.test(text);
      const reject=hardReject(text);
      if(unavailable||reject){
        found.set(old.url,{...old,active:false,lastChecked:now,removalReason:unavailable?"no disponible":reject});
      }else{
        const parsed=parseDetail(old.provider,old.province,old.url,html);
        if(parsed.listing){
          if(parsed.listing.geo){
            const mins=await routeMinutes(parsed.listing.geo);
            if(mins!=null){
              if(mins>90){
                found.set(old.url,{...old,active:false,lastChecked:now,removalReason:"más de 1h30"});
                continue;
              }
              parsed.listing.driveMinutes=Math.round(mins);
              parsed.listing.travelStatus="confirmed";
            }
          }
          found.set(old.url,mergeListing(old,parsed.listing,now));
        }else{
          found.set(old.url,{...old,active:true,lastChecked:now,missedRuns:0});
        }
      }
    }catch{
      found.set(old.url,{...old,active:old.active!==false,lastCheckFailedAt:now});
    }
    await wait(250);
  }

  const next=[...found.values()];

  const dedup=new Map();
  for(const x of next){
    const fp=[slug(x.place||""),x.price,x.bedrooms,slug(x.title||"").slice(0,35)].join("|");
    const cur=dedup.get(fp);
    if(!cur||new Date(x.lastSeen||0)>new Date(cur.lastSeen||0))dedup.set(fp,x);
  }

  const out={
    generatedAt:now,
    rules:{maxPrice:MAX_PRICE,minBedrooms:MIN_BEDROOMS,gardenRequired:true,occupiedRejected:true},
    sourceStatus,
    listings:[...dedup.values()].sort((a,b)=>(b.active-a.active)||(b.score-a.score))
  };
  await fs.writeFile(DATA_PATH,JSON.stringify(out,null,2)+"\n");
  console.log("active",out.listings.filter(x=>x.active).length,"total",out.listings.length);
}
main().catch(e=>{console.error(e);process.exitCode=1});
