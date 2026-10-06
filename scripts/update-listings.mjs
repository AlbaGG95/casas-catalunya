import fs from "node:fs/promises";
import crypto from "node:crypto";
import * as cheerio from "cheerio";
import {extractPrice,firstNumber} from "./lib/price-validation.mjs";
import {MAX_PRICE,MIN_BEDROOMS,MAX_DRIVE_MINUTES,BLOCK_PATTERNS,BAD_CONDITION} from "./lib/safety-rules.mjs";
import {evaluateSafetyText,SAFETY_DECISIONS} from "./lib/safety-engine.mjs";
import {extractExplicitCadastralRef,extractStructuredIdentity,identityPrecision} from "./lib/official-identity.mjs";
import {isDetailUrl,embeddedDetailPatterns} from "./lib/provider-adapters.mjs";
import {buildSourceDefinitions,sourceDefinitionKey} from "./lib/source-catalog.mjs";

const DATA_PATH=new URL("../data/listings.json",import.meta.url);
const GEO_PATH=new URL("../data/geocache.json",import.meta.url);
const MODE=(process.env.SCAN_MODE||"recent").toLowerCase()==="deep"?"deep":"recent";
const SCAN_PROVIDER=(process.env.SCAN_PROVIDER||"").trim();
const SCAN_PROVINCE=(process.env.SCAN_PROVINCE||"").trim();
const INCREMENTAL_ONLY=(process.env.INCREMENTAL_ONLY||"false")==="true";
const OUTPUT_PATH=process.env.OUTPUT_PATH||"data/listings.json";
const PIPELINE_PHASE=(process.env.PIPELINE_PHASE||"legacy").trim().toLowerCase();
const PLAN_PATH=process.env.PLAN_PATH||"data/plan.json";
const SOFT_PRICE=180000;
const ORIGIN={lat:41.4247,lon:2.1647,label:"08032 Barcelona"};
const UA="Mozilla/5.0 (compatible; CasasCatalunyaFamilyFinder/2.0; +https://github.com/AlbaGG95/casas-catalunya)";
const MAX_DETAILS=MODE==="deep"?1600:360;
const MAX_REVALIDATE=MODE==="deep"?160:36;

function sourceDefinitions(){
  return buildSourceDefinitions({
    mode:MODE,
    scanProvider:SCAN_PROVIDER,
    scanProvince:SCAN_PROVINCE
  });
}

const POSITIVE={
  house:/casa|chalet|torre|unifamiliar|vivienda\s+independiente/i,
  independent:/casa\s+independiente|chalet\s+independiente|vivienda\s+independiente|cuatro\s+vientos|4\s+vientos|a\s+cuatro\s+vientos|chalet\s+individual|casa\s+individual/i,
  garden:/jard[ií]n\s+privad|jard[ií]n|parcela\s+(?:privada|propia)?|patio\s+privado|terreno\s+privado/i,
  free:/libre\s+de\s+ocupantes|entrega\s+libre|vivienda\s+vac[ií]a|desocupad[ao]|sin\s+inquilinos|libre\s+y\s+disponible/i,
  clearCharges:/libre\s+de\s+cargas|sin\s+cargas\s+registrales/i,
  fiber:/fibra\s+[oó]ptica|fibra\s+disponible|conexi[oó]n\s+de\s+fibra/i,
  services:/todos\s+los\s+servicios|servicios\s+cercanos|cerca\s+de\s+supermercad|colegios?\s+cercanos|a\s+\d+\s+minutos?\s+de\s+(?:servicios|pueblo|centro)|bien\s+comunicad/i,
  garage:/garaje|parking|aparcamiento/i,
  pool:/piscina/i
};

const OLD_PATTERNS=[
  [/m[aá]s\s+de\s+3\s+meses/i,100],
  [/m[aá]s\s+de\s+2\s+meses/i,70],
  [/hace\s+(\d+)\s+mes(?:es)?/i,null]
];

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const clean=s=>(s||"").replace(/\s+/g," ").trim();
const slug=s=>clean(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const today=()=>new Date().toISOString().slice(0,10);
const daysAgo=(n,base=new Date())=>new Date(base.getTime()-n*86400000).toISOString();

async function readJson(path,fallback){
  try{return JSON.parse(await fs.readFile(path,"utf8"))}catch{return fallback}
}
async function fetchHtml(url){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),18000);
  try{
    const r=await fetch(url,{headers:{"user-agent":UA,"accept-language":"es-ES,es;q=.9,en;q=.5"},redirect:"follow",signal:ctrl.signal});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const ct=r.headers.get("content-type")||"";
    if(!ct.includes("text/html"))throw new Error("not html");
    return await r.text();
  }finally{clearTimeout(timer)}
}
function abs(base,href){
  try{
    const u=new URL(href.replace(/\\u002F/g,"/").replace(/\\\//g,"/"),base);
    u.hash="";
    // Normalize detail URLs so tracking parameters do not create duplicate properties.
    if(/fotocasa\.es|habitaclia\.com|pisos\.com|yaencontre\.com|servihabitat\.com|idealista\.com|indomio\.es/i.test(u.hostname)){
      for(const key of [...u.searchParams.keys()]){
        if(/^(from|utm_|source|campaign|medium|ref)/i.test(key))u.searchParams.delete(key);
      }
    }
    return u.toString();
  }catch{return null}
}
function pageUrl(src,page){
  if(page<=1)return src.base;
  if(src.provider==="Habitaclia")return src.base.replace(/\/$/,"")+"/"+page;
  if(src.provider==="Pisos.com")return src.base.replace(/\/$/,"")+"/"+page+"/";
  if(src.provider==="Idealista"){
    const u=new URL(src.base);
    const path=u.pathname.replace(/\/$/,"");
    u.pathname=path+"/pagina-"+page+".htm";
    return u.toString();
  }
  return src.base;
}
function cardTextFor($,a){
  const node=$(a).closest("article,li,[class*='card'],[class*='Card']").first();
  const text=clean((node.length?node:$(a).parent()).text());
  return text.slice(0,1800);
}
function listPrefilter(text){
  if(!text)return true;
  for(const [,rx] of BLOCK_PATTERNS)if(rx.test(text))return false;
  for(const [,rx] of BAD_CONDITION)if(rx.test(text))return false;
  const priceMatch=text.match(/(\d{2,3}(?:[.\s]\d{3})+)\s*€/);
  if(priceMatch){
    const p=Number(priceMatch[1].replace(/[.\s]/g,""));
    if(p>MAX_PRICE)return false;
  }
  const bed=text.match(/(\d{1,2})\s*(?:hab\.?|habs\.?|habitaciones?|dormitorios?)/i);
  if(bed&&Number(bed[1])<MIN_BEDROOMS)return false;
  return true;
}
function discover(src,base,html){
  const $=cheerio.load(html);
  const found=new Map();
  $("a[href]").each((_,a)=>{
    const u=abs(base,$(a).attr("href")||"");
    if(!u||!isDetailUrl(src.provider,u))return;
    const text=cardTextFor($,a);
    if(listPrefilter(text))found.set(u,{url:u,listText:text});
  });
  const patterns=embeddedDetailPatterns(src.provider);
  for(const rx of patterns){
    for(const m of html.matchAll(rx)){
      const raw=m[0].replace(/\\\//g,"/").replace(/\\u002F/g,"/");
      const u=abs(base,raw);
      if(u&&isDetailUrl(src.provider,u)&&!found.has(u))found.set(u,{url:u,listText:""});
    }
  }
  return [...found.values()].slice(0,140);
}
function allJsonLd($){
  const items=[];
  $('script[type="application/ld+json"]').each((_,s)=>{
    try{
      const v=JSON.parse($(s).text());
      const walk=x=>{
        if(!x)return;
        if(Array.isArray(x))return x.forEach(walk);
        if(typeof x==="object"){items.push(x);Object.values(x).forEach(walk)}
      };
      walk(v);
    }catch{}
  });
  return items;
}
function relevantText($,items){
  const chunks=[];
  const title=clean($("h1").first().text()||$("title").text());
  const meta=clean($('meta[name="description"]').attr("content"));
  if(title)chunks.push(title);
  if(meta)chunks.push(meta);
  for(const x of items){
    for(const v of [x?.description,x?.headline,x?.name]){
      if(typeof v==="string"&&v.length>20)chunks.push(clean(v));
    }
  }
  // Clone the central content and remove navigation, related-listing carousels and footers.
  const root=$("main").first().length?$("main").first().clone():$("body").clone();
  root.find("nav,footer,header,aside,script,style,noscript,[class*='related' i],[class*='similar' i],[class*='recommend' i],[class*='carousel' i],[class*='suggest' i]").remove();
  const mainText=clean(root.text());
  if(mainText)chunks.push(mainText.slice(0,22000));
  return clean(chunks.join(" "));
}

function extractBedrooms(text,items){
  for(const x of items){
    for(const v of [x.numberOfRooms,x.numberOfBedrooms,x.numberOfBedroomsTotal,x.bedrooms]){
      const n=firstNumber(v);if(n&&n<=12)return Math.round(n);
    }
  }
  const m=text.match(/(\d{1,2})\s*(?:hab\.?|habs\.?|habitaciones?|dormitorios?)/i);
  return m?Number(m[1]):null;
}
function toM2(raw,max){
  if(!raw)return null;
  const n=Math.round(Number(String(raw).replace(/\./g,"").replace(",",".")));
  return Number.isFinite(n)&&n>=20&&n<=max?n:null;
}
function extractM2(text,label,meta=""){
  if(label==="house"){
    const mm=clean(meta).match(/(?:^|[.,;:]\s*|\s)(\d{2,4}(?:[.,]\d+)?)\s*m(?:²|2)(?:\b|,)/i);
    const v=toM2(mm?.[1],1200);if(v)return v;
    const arr=[...text.matchAll(/(\d{2,4}(?:[.,]\d+)?)\s*m(?:²|2)\s*(?:construidos?|de\s+vivienda|útiles|utiles)?/gi)]
      .map(m=>toM2(m[1],1200)).filter(Boolean);
    return arr.length?Math.min(...arr):null;
  }
  const m=text.match(/(?:parcela|terreno)[^0-9]{0,50}(\d{2,5}(?:[.,]\d+)?)\s*m(?:²|2)/i);
  return toM2(m?.[1],25000);
}
function titleCaseSlug(s){
  return s.split("-").filter(Boolean).map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");
}
function placeFromUrl(url,provider){
  try{
    const parts=new URL(url).pathname.split("/").filter(Boolean);
    if(provider==="Habitaclia"){
      const uuidIndex=parts.findIndex(x=>/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(x));
      if(uuidIndex>1)return titleCaseSlug(parts[uuidIndex-1]);
    }
    if(provider==="Pisos.com"){
      const i=parts.findIndex(x=>x==="comprar");
      const slugPart=parts[i+1]||"";
      let s=slugPart
        .replace(/^(?:casa_unifamiliar|casa-unifamiliar|chalet_independiente|chalet-independiente|casa|chalet|vivienda)-?/i,"")
        .replace(/-\d{6,}_[0-9]+$/i,"")
        .replace(/(?:_centro_urbano|_casco_urbano)$/i,"")
        .replace(/\d{5}$/,"")
        .replace(/_/g,"-");
      return titleCaseSlug(s);
    }
    if(provider==="Fotocasa"){
      const i=parts.findIndex(x=>x==="vivienda");
      let s=parts[i+1]||"";
      if(/^(obra-nueva|segunda-mano)$/i.test(s))s=parts[i+2]||"";
      if(s && !/^(aire-acondicionado|parking|jardin|terraza|piscina)/i.test(s))return titleCaseSlug(s);
    }
    if(provider==="Servihabitat"){
      const detail=parts.find((x,idx)=>idx>2&&/^(?:barcelona|girona|tarragona|lleida)-/i.test(x));
      if(detail){
        const province=detail.match(/^(barcelona|girona|tarragona|lleida)-/i)?.[1];
        let tail=detail.replace(new RegExp("^"+province+"-","i"),"");
        const bits=tail.split("-").filter(Boolean);
        if(bits.length)return titleCaseSlug(bits.at(-1));
      }
    }
  }catch{}
  return "";
}
function plausiblePlace(s){
  const v=clean(s);
  if(v.length<2||v.length>80)return false;
  if(/venta\s+en|construcci[oó]n|ambiente|descubre|espacio|blanco\s+para|carrer|calle|avenida|cam[ií]|lugar\s+vernet/i.test(v))return false;
  if(/\d{3,}/.test(v))return false;
  return /[a-záéíóúàèòçñ]/i.test(v);
}
function extractPlace(items,$,url,provider,meta,title){
  for(const x of items){
    const a=x.address||x.location?.address;
    const p=clean(a?.addressLocality||"");
    if(plausiblePlace(p))return p;
  }
  const crumb=clean($('[aria-label*="breadcrumb" i],.breadcrumb,.breadcrumbs').text());
  if(crumb){
    const parts=crumb.split(/\s*[>›|]\s*/).filter(Boolean);
    const candidate=parts.findLast?.(x=>plausiblePlace(x)&&!/comprar|venta|casa|chalet/i.test(x));
    if(candidate)return clean(candidate);
  }

  const fromUrl=placeFromUrl(url,provider);
  if(plausiblePlace(fromUrl))return fromUrl;

  const desc=clean(meta);
  const dm=desc.match(/(?:venta\s+de\s+(?:casa|chalet).*?\s+en|casa.*?\s+en|chalet.*?\s+en)\s+([^.,]{2,60})/i);
  if(dm&&plausiblePlace(dm[1]))return clean(dm[1]);
  const tm=clean(title).match(/\ben\s+([^,|]{2,60})/i);
  return tm&&plausiblePlace(tm[1])?clean(tm[1]):"";
}
function extractProvince(items,fallback){
  for(const x of items){
    const a=x.address||x.location?.address;
    const r=clean(a?.addressRegion||"");
    if(/barcelona/i.test(r))return "Barcelona";
    if(/tarragona/i.test(r))return "Tarragona";
    if(/girona|gerona/i.test(r))return "Girona";
    if(/lleida|l[eé]rida/i.test(r))return "Lleida";
  }
  return fallback;
}
function extractGeo(items){
  for(const x of items){
    const g=x.geo||x.location?.geo;
    const lat=Number(g?.latitude),lon=Number(g?.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=40&&lat<=43.5&&lon>=0&&lon<=3.7)return {lat,lon};
  }
  return null;
}
function extractImage(items,$){
  const candidates=[
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $('link[rel="image_src"]').attr("href")
  ];
  for(const x of items){
    const imgs=Array.isArray(x.image)?x.image:[x.image];
    for(const img of imgs){
      const url=typeof img==="string"?img:img?.url;
      if(url)candidates.push(url);
    }
  }
  const hero=$('main img[src], article img[src], [class*="gallery" i] img[src], [class*="photo" i] img[src]').first().attr("src");
  if(hero)candidates.push(hero);
  for(const raw of candidates){
    if(!raw)continue;
    try{
      const u=new URL(raw,$("base").attr("href")||undefined);
      if(/^https?:$/.test(u.protocol) && !/logo|icon|avatar|placeholder/i.test(u.pathname))return u.toString();
    }catch{}
  }
  return null;
}
function parseDateValue(v){
  if(!v)return null;
  const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString();
}
function extractPublishedAt(items,$,text,sourceKind,now){
  for(const x of items){
    for(const v of [x.datePublished,x.datePosted,x.uploadDate,x.dateCreated,x.dateModified]){
      const d=parseDateValue(v);if(d)return {publishedAt:d,evidence:"structured"};
    }
  }
  const updatedMatch=text.match(/(?:anuncio\s+)?actualizado\s+el\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if(updatedMatch){
    const d=new Date(Date.UTC(Number(updatedMatch[3]),Number(updatedMatch[2])-1,Number(updatedMatch[1]),12,0,0));
    return {publishedAt:d.toISOString(),evidence:"updated_date"};
  }
  const dt=$("time[datetime]").first().attr("datetime");
  const parsed=parseDateValue(dt);if(parsed)return {publishedAt:parsed,evidence:"time_element"};
  if(/\bhoy\b/i.test(text))return {publishedAt:now,evidence:"page_text"};
  if(/\bayer\b/i.test(text))return {publishedAt:daysAgo(1,new Date(now)),evidence:"page_text"};
  let m=text.match(/hace\s+(\d+)\s+horas?/i);
  if(m)return {publishedAt:new Date(new Date(now).getTime()-Number(m[1])*3600000).toISOString(),evidence:"page_text"};
  m=text.match(/hace\s+(\d+)\s+d[ií]as?/i);
  if(m)return {publishedAt:daysAgo(Number(m[1]),new Date(now)),evidence:"page_text"};
  for(const [rx,fixed] of OLD_PATTERNS){
    const om=text.match(rx);
    if(om){
      const days=fixed??Number(om[1])*30;
      return {publishedAt:daysAgo(days,new Date(now)),evidence:"page_text_old"};
    }
  }
  if(sourceKind==="recent")return {publishedAt:now,evidence:"recent_source"};
  return {publishedAt:null,evidence:"unknown"};
}
function freshnessStatus(publishedAt,evidence,now){
  if(evidence==="recent_source")return "recent";
  if(!publishedAt)return "unknown";
  const days=(new Date(now)-new Date(publishedAt))/86400000;
  if(days<=14)return "recent";
  if(days>90)return "old";
  return "normal";
}
function idFor(provider,url){
  return slug(provider)+"-"+crypto.createHash("sha1").update(provider+"|"+url).digest("hex").slice(0,14);
}
function summarize(title,place,price,bedrooms,plotM2){
  const b=[title||"Casa"];
  if(place)b.push("en "+place);
  b.push(bedrooms+" habitaciones");
  if(plotM2)b.push("parcela aprox. "+plotM2+" m²");
  b.push(new Intl.NumberFormat("es-ES").format(price)+" €");
  return b.join(", ")+".";
}
function confidenceOf(x){
  let score=0;
  if(x.priceConfidence==="high")score+=35;
  else if(x.priceConfidence==="medium")score+=22;
  else if(x.priceConfidence==="low")score+=8;

  const bedConfidence=x.evidence?.bedrooms?.confidence;
  if(bedConfidence==="high")score+=15;
  else if(bedConfidence==="medium")score+=10;

  if(x.evidence?.garden?.matched)score+=15;
  if(x.independentStatus==="confirmed")score+=10;
  else if(x.independentStatus==="probable")score+=6;
  if(x.conditionStatus==="confirmed")score+=10;
  if(x.place)score+=8;
  if(x.travelStatus==="confirmed")score+=7;

  const bounded=Math.max(0,Math.min(100,score));
  return {
    score:bounded,
    level:bounded>=80?"high":bounded>=55?"medium":"low"
  };
}

function scoreBreakdownOf(x,text){
  const parts=[{key:"base",label:"Base de encaje",points:28}];
  parts.push({key:"budget",label:x.price<=SOFT_PRICE?"Precio ≤180.000 €":"Precio dentro del margen 180–185k",points:x.price<=SOFT_PRICE?12:4});
  parts.push({key:"bedrooms",label:x.bedrooms>=4?"4+ habitaciones":"3 habitaciones",points:x.bedrooms>=4?7:4});
  parts.push({
    key:"independent",
    label:x.independentStatus==="confirmed"?"Independiente confirmada":x.independentStatus==="probable"?"Probablemente independiente":"Independencia pendiente",
    points:x.independentStatus==="confirmed"?16:x.independentStatus==="probable"?11:5
  });
  if(x.conditionStatus==="confirmed")parts.push({key:"condition",label:"Estado para entrar indicado",points:13});
  parts.push({key:"occupancy",label:x.occupancyStatus==="confirmed_free"?"Entrega libre indicada":"Sin señales de ocupación",points:x.occupancyStatus==="confirmed_free"?6:2});
  if(["claimed_clear","verified_clear"].includes(x.registryStatus))parts.push({key:"registry",label:x.registryStatus==="verified_clear"?"Cargas verificadas":"Anuncio afirma libre de cargas",points:4});
  if(x.fiberStatus==="confirmed")parts.push({key:"fiber",label:"Fibra mencionada",points:4});
  if(x.servicesStatus==="confirmed")parts.push({key:"services",label:"Servicios cercanos indicados",points:4});
  if(x.travelStatus==="confirmed"){
    const pts=x.driveMinutes<=60?8:x.driveMinutes<=75?5:2;
    parts.push({key:"travel",label:`Trayecto aproximado ${Math.round(x.driveMinutes)} min`,points:pts});
  }
  if(x.plotM2>=400)parts.push({key:"plot",label:"Parcela ≥400 m²",points:5});
  if(x.houseM2>=90)parts.push({key:"house",label:"Vivienda ≥90 m²",points:3});
  if(x.freshnessStatus==="recent")parts.push({key:"freshness",label:"Anuncio reciente",points:6});
  if(POSITIVE.garage.test(text))parts.push({key:"garage",label:"Garaje",points:2});
  if(POSITIVE.pool.test(text))parts.push({key:"pool",label:"Piscina",points:1});
  return parts;
}
function scoreOf(x,text){
  return Math.min(100,scoreBreakdownOf(x,text).reduce((sum,p)=>sum+p.points,0));
}
async function geocodePlace(place,province,cache){
  if(!place)return null;
  const key=slug(place+"-"+province);
  if(cache[key])return cache[key];
  const q=encodeURIComponent(place+", "+province+", Catalunya, España");
  const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=es&q=${q}`;
  try{
    const r=await fetch(url,{headers:{"user-agent":UA,"accept-language":"es"}});
    if(!r.ok)return null;
    const arr=await r.json();
    const first=arr?.[0];
    const geo=first?{lat:Number(first.lat),lon:Number(first.lon)}:null;
    if(geo&&Number.isFinite(geo.lat)&&Number.isFinite(geo.lon)){
      cache[key]=geo;await wait(1050);return geo;
    }
  }catch{}
  return null;
}
async function routeMinutes(geo){
  if(!geo)return null;
  const url=`https://router.project-osrm.org/route/v1/driving/${ORIGIN.lon},${ORIGIN.lat};${geo.lon},${geo.lat}?overview=false`;
  try{
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
    const r=await fetch(url,{headers:{"user-agent":UA},signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok)return null;
    const j=await r.json(),sec=j?.routes?.[0]?.duration;
    return Number.isFinite(sec)?sec/60:null;
  }catch{return null}
}
async function enrichTravel(listing,cache){
  let geo=listing.geo;
  if(!geo&&listing.place)geo=await geocodePlace(listing.place,listing.province,cache);
  if(!geo)return listing;
  const mins=await routeMinutes(geo);
  if(mins==null)return {...listing,geo};
  return {...listing,geo,driveMinutes:Math.round(mins),travelStatus:mins<=MAX_DRIVE_MINUTES?"confirmed":"too_far"};
}
function parseDetail(src,url,html,now){
  const $=cheerio.load(html);
  const items=allJsonLd($);
  const text=relevantText($,items);
  const safety=evaluateSafetyText(text);
  if(safety.decision===SAFETY_DECISIONS.REJECT)return {reject:"safety:"+safety.code,safety};
  if(!POSITIVE.house.test(text))return {reject:"no parece casa/chalet"};
  if(!POSITIVE.garden.test(text))return {reject:"sin jardín/parcela detectada"};
  const conditionPositive=safety.decision===SAFETY_DECISIONS.ACCEPT;

  const title=clean($("h1").first().text()||$('meta[property="og:title"]').attr("content")||$("title").text()).slice(0,180);
  if(/(?:casa|finca|mas[ií]a)\s+r[uú]stica/i.test(title))return {reject:"rústica"};
  const meta=clean($('meta[name="description"]').attr("content"));
  const priceInfo=extractPrice(text,items,$,src.provider),price=priceInfo.price,bedrooms=extractBedrooms(text,items);
  if(priceInfo.conflict)return {reject:"precio conflictivo/no verificado"};
  if(!price||price>MAX_PRICE)return {reject:"precio"};
  if(!bedrooms||bedrooms<MIN_BEDROOMS||bedrooms>12)return {reject:"habitaciones"};

  const province=extractProvince(items,src.province);
  const place=extractPlace(items,$,url,src.provider,meta,title);
  const structuredIdentity=extractStructuredIdentity(items);
  const cadastralRef=extractExplicitCadastralRef(text+" "+meta);
  const sourceGeo=extractGeo(items);
  const locationPrecision=identityPrecision({cadastralRef,address:structuredIdentity,geo:sourceGeo,place});
  const houseM2=extractM2(text,"house",meta),plotM2=extractM2(text,"plot",meta);
  const date=extractPublishedAt(items,$,text,src.kind,now);
  const fresh=freshnessStatus(date.publishedAt,date.evidence,now);
  if(fresh==="old")return {reject:"anuncio antiguo"};

  const listing={
    id:idFor(src.provider,url),provider:src.provider,title:title||"Casa detectada",place,province,
    price,bedrooms,houseM2,plotM2,url,imageUrl:extractImage(items,$),
    priceEvidence:priceInfo.evidence,priceConfidence:priceInfo.confidence,
    summary:(meta||summarize(title,place,price,bedrooms,plotM2)).slice(0,420),
    firstSeen:null,lastSeen:now,lastChecked:now,active:true,
    publishedAt:date.publishedAt,freshnessEvidence:date.evidence,freshnessStatus:fresh,discoveredVia:src.kind,
    occupancyStatus:POSITIVE.free.test(text)?"confirmed_free":"no_signals",
    financingStatus:"no_restrictions_detected",
    registryStatus:POSITIVE.clearCharges.test(text)?"claimed_clear":"pending",
    independentStatus:POSITIVE.independent.test(text)?"confirmed":(/\bchalet\b/i.test(title)&&!/adosad|paread|medianer/i.test(text)?"probable":"pending"),
    conditionStatus:conditionPositive?"confirmed":"pending",
    safetyDecision:safety.decision,
    safetyReason:safety.reason,
    fiberStatus:POSITIVE.fiber.test(text)?"confirmed":"pending",
    servicesStatus:POSITIVE.services.test(text)?"confirmed":"pending",
    travelStatus:"pending",driveMinutes:null,geo:sourceGeo,
    addressText:structuredIdentity?.streetAddress||null,
    postalCode:structuredIdentity?.postalCode||null,
    cadastralRef,
    locationPrecision,
    hasGarage:POSITIVE.garage.test(text),hasPool:POSITIVE.pool.test(text),
    stretchBudget:price>SOFT_PRICE,score:0,
    evidence:{
      price:{evidence:priceInfo.evidence,confidence:priceInfo.confidence,value:price},
      bedrooms:{confidence:items.some(x=>x?.numberOfRooms||x?.numberOfBedrooms||x?.numberOfBedroomsTotal||x?.bedrooms)?"high":"medium",value:bedrooms},
      garden:{confidence:"high",matched:true},
      independent:{confidence:POSITIVE.independent.test(text)?"high":(/\bchalet\b/i.test(title)&&!/adosad|paread|medianer/i.test(text)?"medium":"unknown")},
      condition:{
        confidence:conditionPositive?"high":safety.decision===SAFETY_DECISIONS.REVIEW?"medium":"unknown",
        decision:safety.decision,
        code:safety.code,
        reason:safety.reason,
        evidence:safety.evidence
      },
      safety,
      occupancy:{confidence:POSITIVE.free.test(text)?"high":"medium"},
      locality:{confidence:place?"medium":"unknown",value:place||null},
      officialIdentity:{
        confidence:cadastralRef?"high":structuredIdentity?.exact?"high":sourceGeo?"medium":place?"low":"unknown",
        cadastralRef:cadastralRef||null,
        streetAddress:structuredIdentity?.streetAddress||null,
        postalCode:structuredIdentity?.postalCode||null,
        locationPrecision
      }
    },
    dataConfidence:"unknown",confidenceScore:0
  };
  listing.score=scoreOf(listing,text);
  listing.evidence.scoreBreakdown=scoreBreakdownOf(listing,text);
  const confidence=confidenceOf(listing);
  listing.confidenceScore=confidence.score;
  listing.dataConfidence=confidence.level;
  return {listing};
}

function mergeListing(old,n,now){
  const history=Array.isArray(old?.priceHistory)?[...old.priceHistory]:[];
  const last=history.at(-1);
  if(!last||last.price!==n.price)history.push({date:today(),price:n.price});
  const discoveredVia=old?.discoveredVia==="recent"||n.discoveredVia==="recent"?"recent":(old?.discoveredVia||n.discoveredVia);
  return {...old,...n,firstSeen:old?.firstSeen||now,lastSeen:now,lastChecked:now,discoveredVia,missedRuns:0,active:true,priceHistory:history.slice(-30)};
}
function sourceKey(src){return sourceDefinitionKey(src)}
function isUnavailable(text){
  return /anuncio\s+(?:ya\s+)?no\s+disponible|inmueble\s+(?:ya\s+)?no\s+disponible|anuncio\s+retirado|inmueble\s+retirado|\breservad[ao]\b|vendid[ao]/i.test(text);
}

async function runDiscoveryPhase(){
  const now=new Date().toISOString();
  const sourceStatus={};
  const discoveries=[];
  const globalSeen=new Set();

  for(const src of sourceDefinitions()){
    const status={ok:true,pages:0,discovered:0,checked:0,accepted:0,rejected:{}};
    try{
      for(let page=1;page<=src.pages;page++){
        const url=pageUrl(src,page);
        let html;
        try{html=await fetchHtml(url)}catch(e){if(page===1)throw e;break}
        status.pages++;
        const candidates=discover(src,url,html);
        status.discovered+=candidates.length;
        for(const candidate of candidates){
          if(globalSeen.has(candidate.url))continue;
          globalSeen.add(candidate.url);
          discoveries.push({
            provider:src.provider,
            province:src.province,
            kind:src.kind,
            url:candidate.url,
            listText:candidate.listText||""
          });
        }
        await wait(180);
      }
    }catch(e){
      status.ok=false;
      status.error=e instanceof Error?e.message:String(e);
    }
    sourceStatus[sourceKey(src)]=status;
  }

  const out={generatedAt:now,scanMode:MODE,sourceStatus,discoveries};
  await fs.mkdir(new URL("../data/",import.meta.url),{recursive:true});
  await fs.writeFile(OUTPUT_PATH,JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify({phase:"discover",mode:MODE,discovered:discoveries.length,sources:Object.keys(sourceStatus).length},null,2));
}

async function runClassificationPhase(){
  const now=new Date().toISOString();
  const plan=await readJson(PLAN_PATH,{generatedAt:now,scanMode:MODE,sourceStatus:{},items:[]});
  const geocache=await readJson(GEO_PATH,{});
  const sourceStatus=JSON.parse(JSON.stringify(plan.sourceStatus||{}));
  const rejectionTotals={};
  const listings=[];
  const pipelineResults=[];
  const items=Array.isArray(plan.items)?plan.items.slice(0,MAX_DETAILS):[];

  const getStatus=src=>{
    const key=sourceKey(src);
    if(!sourceStatus[key])sourceStatus[key]={ok:true,pages:0,discovered:0,checked:0,accepted:0,rejected:{}};
    sourceStatus[key].checked=Number(sourceStatus[key].checked||0);
    sourceStatus[key].accepted=Number(sourceStatus[key].accepted||0);
    sourceStatus[key].rejected=sourceStatus[key].rejected||{};
    return sourceStatus[key];
  };

  for(const item of items){
    const src={
      provider:String(item.provider||SCAN_PROVIDER||""),
      province:String(item.province||SCAN_PROVINCE||""),
      kind:String(item.kind||MODE)
    };
    const status=getStatus(src);
    status.checked++;

    try{
      const detail=await fetchHtml(item.url);
      const parsed=parseDetail(src,item.url,detail,now);
      if(!parsed.listing){
        const reason=parsed.reject||"descartada";
        status.rejected[reason]=(status.rejected[reason]||0)+1;
        rejectionTotals[reason]=(rejectionTotals[reason]||0)+1;
        pipelineResults.push({url:item.url,provider:src.provider,province:src.province,kind:src.kind,outcome:"rejected",reason});
      }else{
        let listing=await enrichTravel(parsed.listing,geocache);
        if(listing.travelStatus==="too_far"){
          const reason="más de 1h30";
          status.rejected[reason]=(status.rejected[reason]||0)+1;
          rejectionTotals[reason]=(rejectionTotals[reason]||0)+1;
          pipelineResults.push({url:item.url,provider:src.provider,province:src.province,kind:src.kind,outcome:"rejected",reason});
        }else{
          const _$=cheerio.load(detail),_items=allJsonLd(_$);
          const detailText=relevantText(_$,_items);
          listing.score=scoreOf(listing,detailText);
          listing.evidence={...(listing.evidence||{}),scoreBreakdown:scoreBreakdownOf(listing,detailText)};
          const confidence=confidenceOf(listing);
          listing.confidenceScore=confidence.score;
          listing.dataConfidence=confidence.level;
          listings.push(mergeListing(null,listing,now));
          status.accepted++;
          pipelineResults.push({url:item.url,provider:src.provider,province:src.province,kind:src.kind,outcome:"accepted"});
        }
      }
    }catch(e){
      const reason=e instanceof Error?e.message:"error detalle";
      status.rejected["error detalle"]=(status.rejected["error detalle"]||0)+1;
      pipelineResults.push({url:item.url,provider:src.provider,province:src.province,kind:src.kind,outcome:"error",reason});
    }
    await wait(120);
  }

  const out={
    generatedAt:now,
    scanMode:MODE,
    pipelinePhase:"classify",
    rules:{
      preferredMaxPrice:SOFT_PRICE,maxPrice:MAX_PRICE,minBedrooms:MIN_BEDROOMS,
      gardenRequired:true,occupiedRejected:true,maxDriveMinutes:MAX_DRIVE_MINUTES,
      condition:"ready_to_live",origin:ORIGIN.label
    },
    stats:{
      active:listings.length,
      recent:listings.filter(x=>x.freshnessStatus==="recent").length,
      under180:listings.filter(x=>x.price<=SOFT_PRICE).length,
      stretch:listings.filter(x=>x.price>SOFT_PRICE).length,
      checkedDetails:items.length,
      rejectionTotals
    },
    sourceStatus,
    pipelineResults,
    listings
  };

  await fs.mkdir(new URL("../data/",import.meta.url),{recursive:true});
  await fs.writeFile(OUTPUT_PATH,JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify({phase:"classify",mode:MODE,planned:items.length,accepted:listings.length,rejected:pipelineResults.filter(x=>x.outcome==="rejected").length,errors:pipelineResults.filter(x=>x.outcome==="error").length},null,2));
}

async function main(){
  if(PIPELINE_PHASE==="discover")return runDiscoveryPhase();
  if(PIPELINE_PHASE==="classify")return runClassificationPhase();

  const now=new Date().toISOString();
  const prior=INCREMENTAL_ONLY
    ? {generatedAt:null,listings:[],sourceStatus:{}}
    : await readJson(DATA_PATH,{generatedAt:null,listings:[],sourceStatus:{}});
  const geocache=await readJson(GEO_PATH,{});
  const byUrl=new Map((prior.listings||[]).map(x=>[x.url,x]));
  const found=new Map();
  const sourceStatus={};
  const rejectionTotals={};
  let detailBudget=MAX_DETAILS;

  for(const src of sourceDefinitions()){
    if(detailBudget<=0)break;
    const status={ok:true,pages:0,discovered:0,checked:0,accepted:0,rejected:{}};
    let sourceBudget=Math.min(src.maxDetails||80,detailBudget);
    try{
      for(let page=1;page<=src.pages&&detailBudget>0&&sourceBudget>0;page++){
        const url=pageUrl(src,page);
        let html;
        try{html=await fetchHtml(url)}catch(e){if(page===1)throw e;break}
        status.pages++;
        const candidates=discover(src,url,html);
        status.discovered+=candidates.length;
        for(const c of candidates){
          if(detailBudget<=0||sourceBudget<=0)break;
          if(found.has(c.url)){continue}
          detailBudget--;sourceBudget--;status.checked++;
          try{
            const detail=await fetchHtml(c.url);
            const parsed=parseDetail(src,c.url,detail,now);
            if(!parsed.listing){
              const reason=parsed.reject||"descartada";
              status.rejected[reason]=(status.rejected[reason]||0)+1;
              rejectionTotals[reason]=(rejectionTotals[reason]||0)+1;
            }else{
              let listing=await enrichTravel(parsed.listing,geocache);
              if(listing.travelStatus==="too_far"){
                const reason="más de 1h30";
                status.rejected[reason]=(status.rejected[reason]||0)+1;
                rejectionTotals[reason]=(rejectionTotals[reason]||0)+1;
              }else{
                {
                  const _$=cheerio.load(detail),_items=allJsonLd(_$);
                  listing.score=scoreOf(listing,relevantText(_$,_items));
                }
                found.set(c.url,mergeListing(byUrl.get(c.url),listing,now));
                status.accepted++;
              }
            }
          }catch(e){
            status.rejected["error detalle"]=(status.rejected["error detalle"]||0)+1;
          }
          await wait(120);
        }
        await wait(250);
      }
    }catch(e){status.ok=false;status.error=e.message}
    sourceStatus[sourceKey(src)]=status;
  }

  const revalidate=INCREMENTAL_ONLY ? [] : (prior.listings||[])
    .filter(x=>x.active!==false&&!found.has(x.url))
    .sort((a,b)=>new Date(a.lastChecked||a.lastSeen||0)-new Date(b.lastChecked||b.lastSeen||0))
    .slice(0,MAX_REVALIDATE);

  for(const old of revalidate){
    try{
      const html=await fetchHtml(old.url),$=cheerio.load(html),items=allJsonLd($),text=relevantText($,items);
      const safety=evaluateSafetyText(text);
      if(isUnavailable(text)||safety.decision===SAFETY_DECISIONS.REJECT){
        found.set(old.url,{...old,active:false,lastChecked:now,removalReason:isUnavailable(text)?"retirada/reservada":"safety:"+safety.code});
      }else{
        const src={provider:old.provider,province:old.province,kind:old.discoveredVia||"deep"};
        const parsed=parseDetail(src,old.url,html,now);
        if(parsed.listing){
          let listing=await enrichTravel(parsed.listing,geocache);
          if(listing.travelStatus==="too_far")found.set(old.url,{...old,active:false,lastChecked:now,removalReason:"más de 1h30"});
          else{
            listing.score=scoreOf(listing,text);
            listing.evidence={...(listing.evidence||{}),scoreBreakdown:scoreBreakdownOf(listing,text)};
            const confidence=confidenceOf(listing);
            listing.confidenceScore=confidence.score;
            listing.dataConfidence=confidence.level;
            found.set(old.url,mergeListing(old,listing,now));
          }
        }else{
          found.set(old.url,{...old,active:false,lastChecked:now,removalReason:parsed.reject||"ya no cumple"});
        }
      }
    }catch{
      found.set(old.url,{...old,lastCheckFailedAt:now,lastChecked:now,active:old.active!==false});
    }
    await wait(120);
  }

  const revalidatedUrls=new Set(revalidate.map(x=>x.url));
  for(const old of (INCREMENTAL_ONLY ? [] : (prior.listings||[]))){
    if(found.has(old.url))continue;
    const lastOk=new Date(old.lastSeen||old.firstSeen||0);
    const ageDays=(new Date(now)-lastOk)/86400000;
    if(ageDays>21){
      found.set(old.url,{...old,active:false,removalReason:"sin revalidar >21 días"});
    }else{
      found.set(old.url,{...old,missedRuns:(old.missedRuns||0)+(revalidatedUrls.has(old.url)?0:1)});
    }
  }

  const listings=[...found.values()]
    .filter(x=>x.price<=MAX_PRICE)
    .sort((a,b)=>(Number(b.active)-Number(a.active))||((b.freshnessStatus==="recent")-(a.freshnessStatus==="recent"))||((b.score||0)-(a.score||0)));

  const out={
    generatedAt:now,
    scanMode:MODE,
    rules:{
      preferredMaxPrice:SOFT_PRICE,maxPrice:MAX_PRICE,minBedrooms:MIN_BEDROOMS,
      gardenRequired:true,occupiedRejected:true,maxDriveMinutes:MAX_DRIVE_MINUTES,
      condition:"ready_to_live",origin:ORIGIN.label
    },
    stats:{
      active:listings.filter(x=>x.active).length,
      recent:listings.filter(x=>x.active&&x.freshnessStatus==="recent").length,
      under180:listings.filter(x=>x.active&&x.price<=SOFT_PRICE).length,
      stretch:listings.filter(x=>x.active&&x.price>SOFT_PRICE).length,
      checkedDetails:MAX_DETAILS-detailBudget,
      rejectionTotals
    },
    sourceStatus,
    listings
  };
  await fs.mkdir(new URL("../data/",import.meta.url),{recursive:true});
  await fs.writeFile(OUTPUT_PATH,JSON.stringify(out,null,2)+"\n");
  if(!INCREMENTAL_ONLY) await fs.writeFile(GEO_PATH,JSON.stringify(geocache,null,2)+"\n");
  console.log(JSON.stringify({mode:MODE,active:out.stats.active,recent:out.stats.recent,under180:out.stats.under180,checked:out.stats.checkedDetails,sources:Object.keys(sourceStatus).length},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
