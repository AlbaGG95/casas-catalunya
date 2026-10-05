import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL="https://ethtlpnvqyxkoeudtcsj.supabase.co";
const SUPABASE_KEY="sb_publishable_RAi269FvaP67ITZDNLi_bg_O-56BiRu";
const db=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const $=s=>document.querySelector(s),els={grid:$("#listingGrid"),empty:$("#emptyState"),search:$("#searchInput"),province:$("#provinceFilter"),budget:$("#budgetFilter"),status:$("#statusFilter"),sort:$("#sortFilter"),visible:$("#visibleCount"),newCount:$("#newCount"),under180:$("#under180Count"),savedCount:$("#savedCount"),updatedAt:$("#updatedAt"),lastScan:$("#lastScan"),sourceHealth:$("#sourceHealth"),toast:$("#toast")};

let payload={listings:[],sourceStatus:{}},known=new Set(),saved=new Set(JSON.parse(localStorage.getItem("savedHomes")||"[]"));
let realtimeChannel=null;

const euro=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const fmt=v=>v?new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"—";
const hours=v=>v?(Date.now()-new Date(v))/36e5:1e9;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const safe=u=>{try{let x=new URL(u);return /^https?:$/.test(x.protocol)?x:""}catch{return""}};
const date=h=>h.publishedAt||h.firstSeen;
const recent=h=>h.freshnessStatus==="recent"||hours(date(h))<=336;
const new48=h=>recent(h)&&hours(date(h))<=48;
const stretch=h=>h.price>180000&&h.price<=185000;
const HARD_EXCLUDE=/(ocupad[oa]|sin posesión|sin posesion|inquilin|alquilad[oa]|arrendad[oa]|nuda propiedad|proindiviso|pro-indiviso|subasta|cesión de crédito|cesion de credito|cesión de remate|cesion de remate|solo inversores|sólo inversores|no hipotecable|fondos propios|\\bVPO\\b|finca rústica|finca rustica|parcela rústica|parcela rustica|suelo rústico|suelo rustico|terreno rústico|terreno rustico|adosad[oa]|paread[oa]|medianer[oa]|semiadosad[oa]|reforma integral|para reformar|a reformar|necesita reforma|requiere reforma|proyecto de reforma|ruina|derribo|inhabitable|obra inacabada|sin terminar|medio construir|casa a medio construir|inscrita.{0,20}en construcción|inscrita.{0,20}en construccion|reservada|bungalow|camping)/i;
const candidate=h=>
  h.status==="verified" &&
  h.active!==false &&
  !HARD_EXCLUDE.test((h.title||"")+" "+(h.summary||"")) &&
  Number.isFinite(Number(h.price)) &&
  Number(h.price)>0 &&
  Number(h.price)<=185000 &&
  Number(h.bedrooms)>=3 &&
  h.occupancyStatus!=="blocked" &&
  h.financingStatus!=="blocked";

function tag(t,c=""){return '<span class="tag '+c+'">'+esc(t)+'</span>'}
function check(t,s){return '<span class="check '+s+'">'+(s==="ok"?"✓ ":s==="pending"?"⚠ ":"• ")+esc(t)+'</span>'}
function toast(t){els.toast.textContent=t;els.toast.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.hidden=true,4500)}

function card(h){
  let ts=[];
  if(new48(h))ts.push(tag("Nueva ≤48h","new"));else if(recent(h))ts.push(tag("Reciente","new"));
  if((h.score||0)>=84)ts.push(tag("Buen encaje","fit"));
  if(h.occupancyStatus==="confirmed_free")ts.push(tag("Libre indicada","free"));
  if(stretch(h))ts.push(tag("180–185k","stretch"));
  if(h.registryStatus!=="verified_clear")ts.push(tag("Nota simple pendiente","pending"));

  let img=safe(h.imageUrl);
  let media=img
    ?'<div class="card-media"><img loading="lazy" referrerpolicy="no-referrer" src="'+esc(img)+'"><span class="media-badge">'+(new48(h)?"Nueva":"Candidata")+'</span></div>'
    :'<div class="card-media"><div class="photo-fallback">Foto en anuncio original</div><span class="media-badge">'+(new48(h)?"Nueva":"Candidata")+'</span></div>';

  let travel=h.driveMinutes!=null?Math.round(h.driveMinutes)+" min aprox.":"Distancia pendiente";
  let link=safe(h.url),sv=saved.has(h.id);

  return '<article class="card">'+media+'<div class="card-body">'+
    '<div class="card-top"><div class="tags">'+ts.join("")+'</div><span class="score">'+esc(h.score||0)+'/100</span></div>'+
    '<div><div class="price">'+euro(h.price)+(stretch(h)?'<small>margen</small>':"")+'</div><h2>'+esc(h.title)+'</h2><div class="place">'+esc(h.place||"Localidad por identificar")+' · '+esc(h.province||"Cataluña")+'</div></div>'+
    '<div class="features"><span>'+esc(h.bedrooms)+' hab.</span>'+(h.houseM2?'<span>'+esc(h.houseM2)+' m² casa</span>':"")+(h.plotM2?'<span>'+esc(h.plotM2)+' m² parcela</span>':"")+'<span>'+esc(travel)+'</span></div>'+
    '<p>'+esc(h.summary||"Candidata detectada automáticamente.")+'</p>'+
    '<div class="checks">'+
      check("Jardín/parcela","ok")+
      check(h.independentStatus==="confirmed"?"Independiente":"Tipología por confirmar",h.independentStatus==="confirmed"?"ok":"pending")+
      check(h.conditionStatus==="confirmed"?"Estado para entrar":"Estado por confirmar",h.conditionStatus==="confirmed"?"ok":"pending")+
      check(h.occupancyStatus==="confirmed_free"?"Libre indicada":"Sin señales de ocupación",h.occupancyStatus==="confirmed_free"?"ok":"pending")+
      check("Sin restricción bancaria detectada","ok")+
      check(h.registryStatus==="verified_clear"?"Cargas verificadas":h.registryStatus==="claimed_clear"?"Libre de cargas según anuncio":"Nota simple pendiente",h.registryStatus==="verified_clear"?"ok":"pending")+
    '</div>'+
    '<div class="meta"><span>'+esc(h.provider)+'</span><span>Detectada '+fmt(h.firstSeen)+'</span><span>Revisada '+fmt(h.lastSeen||h.lastChecked)+'</span></div>'+
    '<div class="actions"><button class="'+(sv?"saved":"")+'" data-save="'+esc(h.id)+'">'+(sv?"Quitar":"Guardar")+'</button>'+(link?'<a href="'+esc(link)+'" target="_blank" rel="noopener">Ver anuncio</a>':"")+'</div>'+
    '</div></article>';
}

function render(){
  let a=(payload.listings||[]).filter(candidate);
  const q=els.search.value.toLowerCase().trim(),p=els.province.value,b=els.budget.value,s=els.status.value;
  if(q)a=a.filter(h=>(h.title+" "+(h.place||"")).toLowerCase().includes(q));
  if(p)a=a.filter(h=>h.province===p);
  if(b==="180")a=a.filter(h=>h.price<=180000);
  else if(b==="smart185")a=a.filter(h=>h.price<=180000||(h.price<=185000&&(h.score||0)>=78));
  if(s==="new")a=a.filter(recent);
  if(s==="best")a=a.filter(h=>(h.score||0)>=84);
  if(s==="independent")a=a.filter(h=>h.independentStatus==="confirmed");
  if(s==="free")a=a.filter(h=>h.occupancyStatus==="confirmed_free");
  if(s==="pending")a=a.filter(h=>h.conditionStatus!=="confirmed"||h.independentStatus!=="confirmed"||h.registryStatus!=="verified_clear");
  if(s==="saved")a=a.filter(h=>saved.has(h.id));

  const so=els.sort.value,d=h=>new Date(date(h)||0);
  if(so==="recent")a.sort((x,y)=>d(y)-d(x)||(y.score||0)-(x.score||0));
  else if(so==="score")a.sort((x,y)=>(y.score||0)-(x.score||0));
  else if(so==="price-asc")a.sort((x,y)=>x.price-y.price);
  else a.sort((x,y)=>y.price-x.price);

  els.grid.innerHTML=a.map(card).join("");
  els.empty.hidden=!!a.length;

  const all=(payload.listings||[]).filter(candidate);
  const bootstrapping=all.length===0 && Object.keys(payload.sourceStatus||{}).length===0;
  els.visible.textContent=bootstrapping?"—":a.length;
  els.newCount.textContent=bootstrapping?"—":all.filter(recent).length;
  els.under180.textContent=bootstrapping?"—":all.filter(h=>h.price<=180000).length;
  if(bootstrapping){
    els.empty.hidden=false;
    els.empty.textContent="Sincronizando el catálogo seguro por primera vez. Las viviendas aparecerán aquí en cuanto cada fuente termine su primer escaneo.";
  }
  els.savedCount.textContent=saved.size;
  els.updatedAt.textContent="Datos "+fmt(payload.generatedAt);
  els.lastScan.textContent=fmt(payload.generatedAt);

  const st=Object.values(payload.sourceStatus||{});
  els.sourceHealth.textContent=st.length?st.filter(x=>x?.status==="ok").length+"/"+st.length+" OK":"—";

  document.querySelectorAll("[data-save]").forEach(x=>x.onclick=()=>{
    const id=x.dataset.save;
    saved.has(id)?saved.delete(id):saved.add(id);
    localStorage.setItem("savedHomes",JSON.stringify([...saved]));
    render();
  });
}

function transformProperty(row){
  const sources=(row.listing_sources||[]).filter(s=>s.active!==false);
  const source=sources[0]||{};
  return {
    id:row.fingerprint||row.id,
    status:row.status,
    provider:source.provider||"Fuente",
    title:row.title,
    place:row.locality,
    province:row.province,
    price:Number(row.price),
    bedrooms:Number(row.bedrooms),
    bathrooms:row.bathrooms,
    houseM2:row.house_m2,
    plotM2:row.plot_m2,
    imageUrl:row.image_url||source.image_url,
    summary:row.summary,
    url:source.url,
    active:["candidate","verified"].includes(row.status),
    publishedAt:row.published_at||source.published_at,
    firstSeen:row.first_seen,
    lastSeen:row.last_seen,
    lastChecked:row.last_checked,
    freshnessStatus:hours(row.published_at||row.first_seen)<=336?"recent":"normal",
    occupancyStatus:row.occupancy_status,
    financingStatus:row.financing_status,
    registryStatus:row.registry_status,
    independentStatus:row.independent_status,
    conditionStatus:row.condition_status,
    fiberStatus:row.fiber_status,
    servicesStatus:row.services_status,
    travelStatus:row.travel_status,
    driveMinutes:row.drive_minutes,
    hasGarage:row.has_garage,
    hasPool:row.has_pool,
    score:Number(row.score)||0,
  };
}

async function load(silent=false){
  try{
    const [{data:rows,error},{data:health,error:healthError}]=await Promise.all([
      db.from("properties")
        .select("*, listing_sources(provider,url,image_url,published_at,active)")
        .eq("status","verified")
        .lte("price",185000)
        .gte("bedrooms",3)
        .order("published_at",{ascending:false,nullsFirst:false}),
      db.from("source_health").select("*").order("provider")
    ]);
    if(error)throw error;
    if(healthError)throw healthError;

    const listings=(rows||[]).map(transformProperty).filter(candidate);
    const ids=new Set(listings.map(x=>x.id));
    if(silent&&known.size){
      const added=[...ids].filter(x=>!known.has(x));
      if(added.length)toast("🏠 "+added.length+" nueva"+(added.length>1?"s":"")+" candidata"+(added.length>1?"s":""));
    }
    known=ids;

    const sourceStatus={};
    for(const h of health||[])sourceStatus[h.provider]=h;
    const latest=listings.map(x=>x.lastChecked||x.lastSeen).filter(Boolean).sort().at(-1)||null;
    payload={generatedAt:latest,listings,sourceStatus};
    render();
  }catch(e){
    console.error("Supabase load failed",e);
    payload={generatedAt:null,listings:[],sourceStatus:{}};
    render();
    els.empty.hidden=false;
    els.empty.textContent="El catálogo seguro se está sincronizando. No mostramos el catálogo antiguo para evitar precios o anuncios incorrectos.";
  }
}

function subscribeRealtime(){
  if(realtimeChannel)db.removeChannel(realtimeChannel);
  realtimeChannel=db.channel("casas-catalunya-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"properties"},()=>load(true))
    .on("postgres_changes",{event:"*",schema:"public",table:"listing_sources"},()=>load(true))
    .on("postgres_changes",{event:"*",schema:"public",table:"source_health"},()=>load(false))
    .subscribe();
}

[els.search,els.province,els.budget,els.status,els.sort].forEach(x=>x.addEventListener(x===els.search?"input":"change",render));
load().then(subscribeRealtime);
setInterval(()=>load(true),60000);

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(e=>console.warn("PWA service worker",e)));}
