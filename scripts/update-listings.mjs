import fs from "node:fs/promises";
import crypto from "node:crypto";
import * as cheerio from "cheerio";

const DATA_PATH=new URL("../data/listings.json",import.meta.url);
const GEO_PATH=new URL("../data/geocache.json",import.meta.url);
const MODE=(process.env.SCAN_MODE||"recent").toLowerCase()==="deep"?"deep":"recent";
const SCAN_PROVIDER=(process.env.SCAN_PROVIDER||"").trim();
const SCAN_PROVINCE=(process.env.SCAN_PROVINCE||"").trim();
const INCREMENTAL_ONLY=(process.env.INCREMENTAL_ONLY||"false")==="true";
const OUTPUT_PATH=process.env.OUTPUT_PATH||"data/listings.json";
const MAX_PRICE=185000;
const SOFT_PRICE=180000;
const MIN_BEDROOMS=3;
const MAX_DRIVE_MINUTES=90;
const ORIGIN={lat:41.4247,lon:2.1647,label:"08032 Barcelona"};
const UA="Mozilla/5.0 (compatible; CasasCatalunyaFamilyFinder/2.0; +https://github.com/AlbaGG95/casas-catalunya)";
const MAX_DETAILS=MODE==="deep"?1600:360;
const MAX_REVALIDATE=MODE==="deep"?160:36;

const PROVINCES=[
  {name:"Barcelona",slug:"barcelona"},
  {name:"Tarragona",slug:"tarragona"},
  {name:"Girona",slug:"girona"},
  {name:"Lleida",slug:"lleida"}
];

function sourceDefinitions(){
  const out=[];
  // Interleave provinces so one large province can never consume the full scan.
  for(const p of PROVINCES){
    out.push({
      provider:"Fotocasa",province:p.name,kind:"recent",
      base:`https://www.fotocasa.es/es/comprar/chalets/${p.slug}-provincia/todas-las-zonas/publicado-ultimas-48-horas/l?priceMax=185000&bedroomsMin=3`,
      pages:1,maxDetails:MODE==="deep"?70:45
    });
    out.push({
      provider:"Indomio",province:p.name,kind:MODE==="recent"?"recentish":"deep",
      base:`https://www.indomio.es/venta-casas/${p.slug}-provincia/con-jardin/`,
      pages:MODE==="deep"?10:2,maxDetails:MODE==="deep"?120:45
    });
    out.push({
      provider:"Habitaclia",province:p.name,kind:MODE==="recent"?"recentish":"deep",
      base:`https://www.habitaclia.com/comprar/chalets/${p.slug}-provincia/baratos/s`,
      pages:MODE==="deep"?8:2,maxDetails:MODE==="deep"?110:45
    });
    out.push({
      provider:"Pisos.com",province:p.name,kind:MODE==="recent"?"recentish":"deep",
      base:`https://www.pisos.com/venta/casas-${p.slug}/con-3-habitaciones/hasta-185000/`,
      pages:MODE==="deep"?8:2,maxDetails:MODE==="deep"?100:40
    });
  }
  return out.filter(src =>
    (!SCAN_PROVIDER || src.provider===SCAN_PROVIDER) &&
    (!SCAN_PROVINCE || src.province===SCAN_PROVINCE)
  );
}

const BLOCK_PATTERNS=[
  ["ocupada",/\bocupad[ao]s?\b|ocupaci[oó]n\s+ilegal|okupad[ao]/i],
  ["sin posesión",/sin\s+posesi[oó]n|sin\s+acceso\s+al\s+interior|situaci[oó]n\s+posesoria/i],
  ["inquilinos",/\binquilin[oa]s?\b|con\s+arrendatari|arrendamiento\s+vigente/i],
  ["alquilada",/\balquilad[ao]s?\b|\barrendad[ao]s?\b/i],
  ["no visitable",/no\s+(?:se\s+puede\s+)?visitar|no\s+visitable|sin\s+posibilidad\s+de\s+visita/i],
  ["nuda propiedad",/nuda\s+propiedad/i],
  ["proindiviso",/proindiviso|pro-indiviso|participaci[oó]n\s+indivisa/i],
  ["subasta",/\bsubasta\b|cesi[oó]n\s+de\s+remate|ejecuci[oó]n\s+hipotecaria/i],
  ["venta de deuda",/venta\s+de\s+deuda|cesi[oó]n\s+de\s+cr[eé]dito/i],
  ["solo inversores",/s[oó]lo\s+(?:para\s+)?inversores|especial\s+inversores/i],
  ["no hipotecable",/no\s+hipotecable|no\s+admite\s+hipoteca|no\s+es\s+viable\s+la\s+financiaci[oó]n|requiere\s+fondos\s+propios/i],
  ["vpo/restricción",/vivienda\s+de\s+protecci[oó]n\s+oficial|\bVPO\b/i],
  ["cargas indicadas",/con\s+cargas\s+registrales|cargas\s+pendientes|gravamen\s+pendiente/i],
  ["sin cédula",/sin\s+c[eé]dula(?:\s+de\s+habitabilidad)?/i],
  ["adosada",/\badosad[ao]s?\b|casa\s+adosada/i],
  ["pareada",/\bparead[ao]s?\b|casa\s+pareada/i],
  ["entre medianeras",/entre\s+medianeras|casa\s+medianera/i],
  ["finca rústica",/finca\s+r[uú]stica|suelo\s+r[uú]stico|terreno\s+r[uú]stico/i],
  ["uso no habitual",/no\s+es\s+posible\s+como\s+vivienda\s+habitual|uso\s+temporal/i],
  ["sin servicios",/sin\s+alcantarillado|sin\s+agua\s+de\s+red|sin\s+luz\s+de\s+red|sin\s+suministros/i]
];

const BAD_CONDITION=[
  ["reforma integral",/reforma\s+integral|para\s+reformar|a\s+reformar|necesita\s+reforma|requiere\s+reforma/i],
  ["estado de origen",/estado\s+de\s+origen|de\s+origen\s+y\s+requiere|para\s+actualizar/i],
  ["ruina/derribo",/\bruina\b|para\s+derribar|derribo|estado\s+ruinoso/i],
  ["sin terminar",/sin\s+terminar|obra\s+inacabada|obra\s+parada|por\s+terminar/i],
  ["mal estado",/mal\s+estado|muy\s+deteriorad|inhabitable/i]
];

const POSITIVE={
  house:/casa|chalet|torre|unifamiliar|vivienda\s+independiente/i,
  independent:/casa\s+independiente|chalet\s+independiente|vivienda\s+independiente|cuatro\s+vientos|4\s+vientos|a\s+cuatro\s+vientos|chalet\s+individual|casa\s+individual/i,
  garden:/jard[ií]n\s+privad|jard[ií]n|parcela\s+(?:privada|propia)?|patio\s+privado|terreno\s+privado/i,
  condition:/buen\s+estado|muy\s+buen\s+estado|reformad[ao]|para\s+entrar\s+a\s+vivir|lista\s+para\s+entrar|obra\s+nueva|semi\s*nuev|impecable|excelente\s+estado|perfecto\s+estado/i,
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
    if(/fotocasa\.es|habitaclia\.com|pisos\.com/i.test(u.hostname)){
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
  return src.base;
}
function isDetail(provider,url){
  if(provider==="Fotocasa")return /\/es\/comprar\/vivienda\//i.test(url);
  if(provider==="Habitaclia")return /\/comprar\/(?:vivienda|casa|chalet)\//i.test(url)&&/\/d(?:\?|$)/i.test(url);
  if(provider==="Pisos.com")return /\/comprar\//i.test(url)&&!/\/venta\//i.test(url);
  return false;
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
    if(!u||!isDetail(src.provider,u))return;
    const text=cardTextFor($,a);
    if(listPrefilter(text))found.set(u,{url:u,listText:text});
  });
  const patterns=src.provider==="Fotocasa"
    ? [/https?:\\?\/\\?\/www\.fotocasa\.es\\?\/es\\?\/comprar\\?\/vivienda\\?\/[^"'<>\s]+/gi,/\/es\/comprar\/vivienda\/[^"'<>\s]+/gi]
    : src.provider==="Habitaclia"
    ? [/https?:\\?\/\\?\/www\.habitaclia\.com\\?\/comprar\\?\/(?:vivienda|casa|chalet)\\?\/[^"'<>\s]+?\\?\/d/gi,/\/comprar\/(?:vivienda|casa|chalet)\/[^"'<>\s]+?\/d/gi]
    : src.provider==="Indomio"
    ? [/https?:\\?\/\\?\/www\.indomio\.es\\?\/anuncios\\?\/\d+\\?\/?/gi,/\/anuncios\/\d+\/?/gi]
    : [/https?:\\?\/\\?\/www\.pisos\.com\\?\/comprar\\?\/[^"'<>\s]+/gi,/\/comprar\/[^"'<>\s]+/gi];
  for(const rx of patterns){
    for(const m of html.matchAll(rx)){
      const raw=m[0].replace(/\\\//g,"/").replace(/\\u002F/g,"/");
      const u=abs(base,raw);
      if(u&&isDetail(src.provider,u)&&!found.has(u))found.set(u,{url:u,listText:""});
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

function firstNumber(v){
  if(v==null)return null;
  const raw=String(v).replace(/[^0-9.,]/g,"");
  const n=Number(raw.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)&&n>0?n:null;
}
function parseEuro(raw){
  if(!raw)return null;
  const n=Number(String(raw).replace(/[^0-9]/g,""));
  return Number.isFinite(n)&&n>=10000&&n<=5000000?n:null;
}
function extractProminentPrice($){
  const candidates=[];
  const selectors=[
    '[data-testid*="price" i]','[class*="price" i]','[class*="precio" i]',
    'main','article'
  ];
  for(const sel of selectors){
    const node=$(sel).first();
    if(!node.length)continue;
    const txt=clean(node.text()).slice(0,5000);
    for(const m of txt.matchAll(/(\d{2,3}(?:[.\s]\d{3})+|\d{5,7})\s*€/g)){
      const n=parseEuro(m[1]);
      if(n)candidates.push(n);
      if(candidates.length>=5)break;
    }
    if(candidates.length)break;
  }
  return candidates[0]||null;
}
function extractPrice(text,items,$){
  const prominent=extractProminentPrice($);
  if(prominent)return prominent;
  for(const x of items){
    for(const p of [x?.offers?.price,x?.price,x?.offers?.lowPrice]){
      const n=firstNumber(p);if(n&&n>=10000&&n<=5000000)return Math.round(n);
    }
  }
  const m=text.match(/(?:precio[^0-9]{0,20})?(\d{2,3}(?:[.\s]\d{3})+|\d{5,7})\s*€/i);
  return m?parseEuro(m[1]):null;
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
function extractPlace(items,$,url,provider,meta,title){
  for(const x of items){
    const a=x.address||x.location?.address;
    const p=a?.addressLocality;
    if(p)return clean(p);
  }
  const desc=clean(meta);
  const dm=desc.match(/(?:venta\s+de\s+(?:casa|chalet).*?\s+en|casa.*?\s+en|chalet.*?\s+en)\s+([^.,]{2,60})/i);
  if(dm)return clean(dm[1]);
  const crumb=clean($('[aria-label*="breadcrumb" i],.breadcrumb,.breadcrumbs').text());
  if(crumb){
    const parts=crumb.split(/\s*[>›|]\s*/).filter(Boolean);
    const candidate=parts.findLast?.(x=>x.length>2&&!/comprar|venta|casa|chalet/i.test(x));
    if(candidate)return clean(candidate);
  }
  if(provider==="Habitaclia"){
    try{
      const parts=new URL(url).pathname.split("/").filter(Boolean);
      const uuidIndex=parts.findIndex(x=>/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(x));
      if(uuidIndex>1)return titleCaseSlug(parts[uuidIndex-1]);
    }catch{}
  }
  const tm=clean(title).match(/\ben\s+([^,|]{2,60})/i);
  return tm?clean(tm[1]):"";
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
  const meta=$('meta[property="og:image"]').attr("content");
  if(meta&&/^https?:/i.test(meta))return meta;
  for(const x of items){
    const img=Array.isArray(x.image)?x.image[0]:x.image;
    const url=typeof img==="string"?img:img?.url;
    if(url&&/^https?:/i.test(url))return url;
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
function blockReason(text){
  for(const [reason,rx] of BLOCK_PATTERNS)if(rx.test(text))return reason;
  return null;
}
function badConditionReason(text){
  for(const [reason,rx] of BAD_CONDITION)if(rx.test(text))return reason;
  return null;
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
function scoreOf(x,text){
  let s=28;
  if(x.price<=SOFT_PRICE)s+=12;else s+=4;
  if(x.bedrooms>=4)s+=7;else s+=4;
  if(x.independentStatus==="confirmed")s+=16;else s+=5;
  if(x.conditionStatus==="confirmed")s+=13;
  if(x.occupancyStatus==="confirmed_free")s+=6;else s+=2;
  if(x.registryStatus==="claimed_clear")s+=4;
  if(x.fiberStatus==="confirmed")s+=4;
  if(x.servicesStatus==="confirmed")s+=4;
  if(x.travelStatus==="confirmed"){
    if(x.driveMinutes<=60)s+=8;
    else if(x.driveMinutes<=75)s+=5;
    else s+=2;
  }
  if(x.plotM2>=400)s+=5;
  if(x.houseM2>=90)s+=3;
  if(x.freshnessStatus==="recent")s+=6;
  if(POSITIVE.garage.test(text))s+=2;
  if(POSITIVE.pool.test(text))s+=1;
  return Math.min(100,s);
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
  const block=blockReason(text);if(block)return {reject:block};
  const conditionBlock=badConditionReason(text);if(conditionBlock)return {reject:conditionBlock};
  if(!POSITIVE.house.test(text))return {reject:"no parece casa/chalet"};
  if(!POSITIVE.garden.test(text))return {reject:"sin jardín/parcela detectada"};
  const conditionPositive=POSITIVE.condition.test(text);

  const title=clean($("h1").first().text()||$('meta[property="og:title"]').attr("content")||$("title").text()).slice(0,180);
  if(/(?:casa|finca|mas[ií]a)\s+r[uú]stica/i.test(title))return {reject:"rústica"};
  const meta=clean($('meta[name="description"]').attr("content"));
  const price=extractPrice(text,items,$),bedrooms=extractBedrooms(text,items);
  if(!price||price>MAX_PRICE)return {reject:"precio"};
  if(!bedrooms||bedrooms<MIN_BEDROOMS||bedrooms>12)return {reject:"habitaciones"};

  const province=extractProvince(items,src.province);
  const place=extractPlace(items,$,url,src.provider,meta,title);
  const houseM2=extractM2(text,"house",meta),plotM2=extractM2(text,"plot",meta);
  const date=extractPublishedAt(items,$,text,src.kind,now);
  const fresh=freshnessStatus(date.publishedAt,date.evidence,now);
  if(fresh==="old")return {reject:"anuncio antiguo"};

  const listing={
    id:idFor(src.provider,url),provider:src.provider,title:title||"Casa detectada",place,province,
    price,bedrooms,houseM2,plotM2,url,imageUrl:extractImage(items,$),
    summary:(meta||summarize(title,place,price,bedrooms,plotM2)).slice(0,420),
    firstSeen:null,lastSeen:now,lastChecked:now,active:true,
    publishedAt:date.publishedAt,freshnessEvidence:date.evidence,freshnessStatus:fresh,discoveredVia:src.kind,
    occupancyStatus:POSITIVE.free.test(text)?"confirmed_free":"no_signals",
    financingStatus:"no_restrictions_detected",
    registryStatus:POSITIVE.clearCharges.test(text)?"claimed_clear":"pending",
    independentStatus:POSITIVE.independent.test(text)?"confirmed":"pending",
    conditionStatus:conditionPositive?"confirmed":"pending",
    fiberStatus:POSITIVE.fiber.test(text)?"confirmed":"pending",
    servicesStatus:POSITIVE.services.test(text)?"confirmed":"pending",
    travelStatus:"pending",driveMinutes:null,geo:extractGeo(items),
    hasGarage:POSITIVE.garage.test(text),hasPool:POSITIVE.pool.test(text),
    stretchBudget:price>SOFT_PRICE,score:0
  };
  listing.score=scoreOf(listing,text);
  return {listing};
}

function mergeListing(old,n,now){
  const history=Array.isArray(old?.priceHistory)?[...old.priceHistory]:[];
  const last=history.at(-1);
  if(!last||last.price!==n.price)history.push({date:today(),price:n.price});
  const discoveredVia=old?.discoveredVia==="recent"||n.discoveredVia==="recent"?"recent":(old?.discoveredVia||n.discoveredVia);
  return {...old,...n,firstSeen:old?.firstSeen||now,lastSeen:now,lastChecked:now,discoveredVia,missedRuns:0,active:true,priceHistory:history.slice(-30)};
}
function sourceKey(src){return src.provider+" "+src.province+" "+src.kind}
function isUnavailable(text){
  return /anuncio\s+(?:ya\s+)?no\s+disponible|inmueble\s+(?:ya\s+)?no\s+disponible|anuncio\s+retirado|inmueble\s+retirado|\breservad[ao]\b|vendid[ao]/i.test(text);
}

async function main(){
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
      const block=blockReason(text),conditionBlock=badConditionReason(text);
      if(isUnavailable(text)||block||conditionBlock){
        found.set(old.url,{...old,active:false,lastChecked:now,removalReason:isUnavailable(text)?"retirada/reservada":(block||conditionBlock)});
      }else{
        const src={provider:old.provider,province:old.province,kind:old.discoveredVia||"deep"};
        const parsed=parseDetail(src,old.url,html,now);
        if(parsed.listing){
          let listing=await enrichTravel(parsed.listing,geocache);
          if(listing.travelStatus==="too_far")found.set(old.url,{...old,active:false,lastChecked:now,removalReason:"más de 1h30"});
          else{
            listing.score=scoreOf(listing,text);
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
