import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {MAX_PRICE as HARD_MAX_PRICE,PREFERRED_PRICE as TARGET_PRICE,MID_PRICE,MIN_BEDROOMS} from "./search-criteria.js";

const SUPABASE_URL="https://ethtlpnvqyxkoeudtcsj.supabase.co";
const SUPABASE_KEY="sb_publishable_RAi269FvaP67ITZDNLi_bg_O-56BiRu";
const PAGE_SIZE=24;

const db=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const $=s=>document.querySelector(s);

const els={
  grid:$("#listingGrid"),empty:$("#emptyState"),search:$("#searchInput"),
  province:$("#provinceFilter"),budget:$("#budgetFilter"),status:$("#statusFilter"),
  sort:$("#sortFilter"),visible:$("#visibleCount"),newCount:$("#newCount"),
  under180:$("#under180Count"),savedCount:$("#savedCount"),updatedAt:$("#updatedAt"),
  lastScan:$("#lastScan"),sourceHealth:$("#sourceHealth"),toast:$("#toast"),
  loadMore:$("#loadMore"),resultMeta:$("#resultMeta"),familyBtn:$("#familyButton"),
  alertBtn:$("#alertButton"),bedrooms:$("#bedroomFilter"),drive:$("#driveFilter"),
  confidence:$("#confidenceFilter"),extra:$("#extraFilter"),map:$("#candidateMap"),
  mapMeta:$("#mapMeta"),toggleMap:$("#toggleMap"),compareDock:$("#compareDock"),
  compareCount:$("#compareCount"),openCompare:$("#openCompare"),clearCompare:$("#clearCompare"),
  compareModal:$("#compareModal"),compareWrap:$("#compareTableWrap"),
  allSafetyCount:$("#allSafetyCount"),compatibleCount:$("#compatibleCount"),reviewCount:$("#reviewCount")
};

let payload={listings:[],sourceStatus:{}};
let known=new Set();
let localSaved=new Set(JSON.parse(localStorage.getItem("savedHomes")||"[]"));
let familySaved=new Set();
let familyOverview=new Map();
let familyCode=localStorage.getItem("familyCode")||"";
let familyMemberId=localStorage.getItem("familyMemberId")||"";
let familyMemberName=localStorage.getItem("familyMemberName")||"";
let realtimeChannel=null;
let visibleLimit=PAGE_SIZE;
let candidateMap=null;
let markerLayer=null;
let mapHidden=localStorage.getItem("mapHidden")!=="0";
let compareSelected=new Set(JSON.parse(localStorage.getItem("compareHomes")||"[]"));
let safetyView=localStorage.getItem("safetyView")||"all";
let compareReturnFocus=null;
if(!["all","compatible","review"].includes(safetyView))safetyView="all";
const previousVisitAt=localStorage.getItem("lastVisitAt");
const visitStartedAt=new Date().toISOString();
localStorage.setItem("lastVisitAt",visitStartedAt);

const euro=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const fmt=v=>v?new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"—";
const hours=v=>v?Math.max(0,(Date.now()-new Date(v).getTime())/36e5):Infinity;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const safe=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.toString():""}catch{return""}};
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();

const HARD_EXCLUDE=/(ocupad[oa]|sin posesión|sin posesion|inquilin|alquilad[oa]|arrendad[oa]|nuda propiedad|proindiviso|pro-indiviso|subasta|cesión de crédito|cesion de credito|cesión de remate|cesion de remate|solo inversores|sólo inversores|no hipotecable|fondos propios|\bVPO\b|finca rústica|finca rustica|parcela rústica|parcela rustica|suelo rústico|suelo rustico|terreno rústico|terreno rustico|adosad[oa]|paread[oa]|medianer[oa]|semiadosad[oa]|reforma integral|para reformar|a reformar|necesita reforma|requiere reforma|proyecto de reforma|ruina|derribo|inhabitable|obra inacabada|sin terminar|medio construir|casa a medio construir|inscrita.{0,20}en construcción|inscrita.{0,20}en construccion|reservada|bungalow|camping)/i;

const candidate=h=>
  ["candidate","verified"].includes(h.status) &&
  h.active!==false &&
  !HARD_EXCLUDE.test((h.title||"")+" "+(h.summary||"")) &&
  Number.isFinite(Number(h.price)) &&
  Number(h.price)>0 &&
  Number(h.price)<=HARD_MAX_PRICE &&
  Number(h.bedrooms)>=MIN_BEDROOMS &&
  h.occupancyStatus!=="blocked" &&
  h.financingStatus!=="blocked" &&
  h.safetyDecision!=="REJECT";

const publishedAge=h=>h.publishedAt?hours(h.publishedAt):Infinity;
const detectedAge=h=>hours(h.firstSeen);
const publishedRecent=h=>publishedAge(h)<=168;
const published48=h=>publishedAge(h)<=48;
const detectedRecent=h=>!h.publishedAt&&detectedAge(h)<=48;
const isRecent=h=>publishedRecent(h)||detectedRecent(h);
const stretch=h=>h.price>TARGET_PRICE&&h.price<=HARD_MAX_PRICE;
const newSinceVisit=h=>!!previousVisitAt&&new Date(h.firstSeen||0).getTime()>new Date(previousVisitAt).getTime();
const hasCoords=h=>Number.isFinite(Number(h.latitude))&&Number.isFinite(Number(h.longitude));
const servicesKnown=h=>(h.nearbyServices||[]).length>0||["likely","confirmed"].includes(h.servicesStatus);

function cleanPlace(value){
  let s=String(value||"").replace(/\bCentro Urbano\b/ig,"").replace(/\bCasco Urbano\b/ig,"").replace(/\s+/g," ").trim();
  if(!s)return "";
  if(/casa unifamiliar|urbanitzacions|construcci[oó]n|carrer|calle|avenida|cam[ií]|junio park/i.test(s) && s.length>35)return "";
  return s;
}

function sourceKey(h){
  return [h.provider,norm(cleanPlace(h.place)),h.price,h.bedrooms].join("|");
}
function near(a,b,tol=2){
  if(a==null||b==null)return false;
  return Math.abs(Number(a)-Number(b))<=tol;
}
function shouldMerge(a,b){
  if(a.provider!==b.provider)return false;
  if(norm(cleanPlace(a.place))!==norm(cleanPlace(b.place)))return false;
  if(Number(a.price)!==Number(b.price)||Number(a.bedrooms)!==Number(b.bedrooms))return false;
  if(norm(a.title)===norm(b.title))return true;
  if(a.plotM2&&b.plotM2&&near(a.plotM2,b.plotM2,3)&&a.houseM2&&b.houseM2&&near(a.houseM2,b.houseM2,3))return true;
  return false;
}
function richness(h){
  return [h.imageUrl,h.houseM2,h.plotM2,h.driveMinutes,h.publishedAt,h.independentStatus==="confirmed",h.conditionStatus==="confirmed"].filter(Boolean).length;
}
function dedupeListings(list){
  const out=[];
  for(const item of list){
    const idx=out.findIndex(x=>shouldMerge(x,item));
    if(idx<0){out.push(item);continue}
    const keep=richness(item)>richness(out[idx])?item:out[idx];
    const other=keep===item?out[idx]:item;
    keep.sources=[...(keep.sources||[]),...(other.sources||[])].filter((s,i,a)=>a.findIndex(x=>x.url===s.url)===i);
    out[idx]=keep;
  }
  return out;
}

function isSaved(h){return familyCode?familySaved.has(h.dbId):localSaved.has(h.id)}
function familyInfo(h){return familyCode?familyOverview.get(h.dbId)||null:null}
function familyStageLabel(stage){
  return ({
    new:"Nueva",contact:"Contactar",visit_requested:"Visita solicitada",visited:"Visitada",
    negotiating:"Negociando",offer:"Oferta",discarded:"Descartada"
  })[stage]||"";
}
function familyStageClass(stage){
  return stage==="offer"?"verified":stage==="discarded"?"pending":stage==="negotiating"?"fit":"candidate";
}
function tag(t,c=""){return '<span class="tag '+c+'">'+esc(t)+'</span>'}
function check(t,s){return '<span class="check '+s+'">'+(s==="ok"?"✓ ":s==="pending"?"⚠ ":"• ")+esc(t)+'</span>'}
function toast(t){els.toast.textContent=t;els.toast.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.hidden=true,4200)}

function freshnessBadge(h){
  if(newSinceVisit(h))return tag("Nueva desde tu última visita","new");
  if(published48(h))return tag("Publicada ≤48 h","new");
  if(publishedRecent(h))return tag("Publicada esta semana","new");
  if(detectedRecent(h))return tag("Detectada hoy","detected");
  return "";
}

function card(h){
  const img=safe(h.imageUrl);
  const place=cleanPlace(h.place)||"Localidad por confirmar";
  const travel=h.driveMinutes!=null?Math.round(h.driveMinutes)+" min":"Trayecto pendiente";
  const link=safe(h.url);
  const saved=isSaved(h);
  const family=familyInfo(h);
  const compatible=h.safetyDecision==="ACCEPT";
  const ready=compatible;
  const independent=h.independentStatus==="confirmed"?"Independiente":h.independentStatus==="probable"?"Prob. independiente":"Tipo por confirmar";
  const timing=h.publishedAt
    ? "Publicado "+fmt(h.publishedAt)
    : "Detectado "+fmt(h.firstSeen);

  const badges=[];
  badges.push('<span class="home-state '+(compatible?"ready":"review")+'">'+(compatible?"✓ Recomendada":"Falta confirmar")+'</span>');
  const fresh=freshnessBadge(h);if(fresh)badges.push(fresh);
  if(stretch(h))badges.push('<span class="home-state stretch">Margen 180–190k</span>');
  if(family?.stage&&family.stage!=="new")badges.push('<span class="home-state family">'+esc(familyStageLabel(family.stage))+'</span>');

  const media=img
    ? '<div class="card-media"><img loading="lazy" referrerpolicy="no-referrer" src="'+esc(img)+'" alt="Foto del anuncio de '+esc(h.title||"la vivienda")+'"><span class="media-badge">'+esc(h.provider||"Fuente")+'</span></div>'
    : '<div class="card-media"><div class="photo-fallback">Sin foto importada</div><span class="media-badge">'+esc(h.provider||"Fuente")+'</span></div>';

  const facts=[
    h.bedrooms+" hab.",
    h.houseM2?h.houseM2+" m² vivienda":null,
    h.plotM2?h.plotM2+" m² parcela":"Parcela detectada",
    independent,
    travel
  ].filter(Boolean);

  return '<article class="card home-card">'+media+
    '<div class="card-body">'+
      '<div class="home-card-badges">'+badges.join("")+'</div>'+
      '<div class="home-card-price-row"><div class="price">'+euro(h.price)+'</div><span class="score" title="Encaje con tus criterios">'+esc(h.score||0)+'/100</span></div>'+
      '<div><h2>'+esc(h.title)+'</h2><div class="place">'+esc(place)+' · '+esc(h.province||"Cataluña")+'</div></div>'+
      '<div class="home-facts">'+facts.map(x=>'<span>'+esc(x)+'</span>').join("")+'</div>'+
      '<div class="home-card-meta"><span>'+esc(timing)+'</span><span>Revisado '+fmt(h.lastChecked||h.lastSeen)+'</span></div>'+
      '<div class="home-card-actions">'+
        '<button class="save-button '+(saved?"saved":"")+'" data-save="'+esc(h.id)+'" data-db="'+esc(h.dbId)+'">'+(saved?"★ Guardada":"☆ Guardar")+'</button>'+
        '<button class="compare-chip '+(compareSelected.has(h.dbId)?"selected":"")+'" data-compare="'+esc(h.dbId)+'">'+(compareSelected.has(h.dbId)?"✓ Comparar":"+ Comparar")+'</button>'+
        '<a class="detail-link" href="/property.html?id='+encodeURIComponent(h.dbId)+'">Ver vivienda</a>'+
        (link?'<a class="source-link" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer" aria-label="Abrir anuncio original">↗</a>':"")+
      '</div>'+
    '</div>'+
  '</article>';
}

function filteredList(){
  let a=dedupeListings((payload.listings||[]).filter(candidate));
  const q=els.search.value.toLowerCase().trim(),p=els.province.value,b=els.budget.value,s=els.status.value;
  const minBeds=Number(els.bedrooms?.value||MIN_BEDROOMS),maxDrive=Number(els.drive?.value||0);
  const confidence=els.confidence?.value||"",extra=els.extra?.value||"";

  if(q)a=a.filter(h=>(h.title+" "+(cleanPlace(h.place)||"")).toLowerCase().includes(q));
  if(p)a=a.filter(h=>h.province===p);
  a=a.filter(h=>h.bedrooms>=minBeds);

  if(b==="180")a=a.filter(h=>h.price<=TARGET_PRICE);
  else if(b==="185")a=a.filter(h=>h.price<=MID_PRICE);
  else if(b==="190"||b==="smart190")a=a.filter(h=>h.price<=HARD_MAX_PRICE);

  if(maxDrive)a=a.filter(h=>h.driveMinutes!=null&&Number(h.driveMinutes)<=maxDrive);
  if(confidence==="high")a=a.filter(h=>h.dataConfidence==="high");
  if(confidence==="medium")a=a.filter(h=>["high","medium"].includes(h.dataConfidence));

  if(extra==="garage")a=a.filter(h=>h.hasGarage);
  if(extra==="pool")a=a.filter(h=>h.hasPool);
  if(extra==="services")a=a.filter(servicesKnown);
  if(extra==="mapped")a=a.filter(hasCoords);

  if(safetyView==="compatible")a=a.filter(h=>h.safetyDecision==="ACCEPT");
  if(safetyView==="review")a=a.filter(h=>h.safetyDecision==="REVIEW");

  if(s==="new")a=a.filter(isRecent);
  if(s==="since-visit")a=a.filter(newSinceVisit);
  if(s==="best")a=a.filter(h=>(h.score||0)>=84);
  if(s==="verified")a=a.filter(h=>h.status==="verified");
  if(s==="independent")a=a.filter(h=>["confirmed","probable"].includes(h.independentStatus));
  if(s==="pending")a=a.filter(h=>h.conditionStatus!=="confirmed"||h.independentStatus!=="confirmed"||h.registryStatus!=="verified_clear");
  if(s==="saved")a=a.filter(isSaved);
  if(s==="family-contact")a=a.filter(h=>familyInfo(h)?.stage==="contact");
  if(s==="family-visit")a=a.filter(h=>familyInfo(h)?.stage==="visit_requested");
  if(s==="family-visited")a=a.filter(h=>familyInfo(h)?.stage==="visited");
  if(s==="family-negotiating")a=a.filter(h=>familyInfo(h)?.stage==="negotiating");
  if(s==="family-offer")a=a.filter(h=>familyInfo(h)?.stage==="offer");
  if(s==="family-discarded")a=a.filter(h=>familyInfo(h)?.stage==="discarded");
  else if(familyCode)a=a.filter(h=>familyInfo(h)?.stage!=="discarded");

  const so=els.sort.value;
  const date=h=>new Date(h.publishedAt||h.firstSeen||0).getTime();
  if(so==="recent")a.sort((x,y)=>date(y)-date(x)||(y.score||0)-(x.score||0));
  else if(so==="score")a.sort((x,y)=>(y.score||0)-(x.score||0)||date(y)-date(x));
  else if(so==="price-asc")a.sort((x,y)=>x.price-y.price);
  else a.sort((x,y)=>y.price-x.price);
  return a;
}

function initMap(){
  if(candidateMap||!els.map)return;
  candidateMap=L.map(els.map,{scrollWheelZoom:false,zoomControl:true}).setView([41.75,1.8],7);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  }).addTo(candidateMap);
  markerLayer=L.layerGroup().addTo(candidateMap);
}

function renderMap(list){
  if(!els.map)return;
  els.map.hidden=mapHidden;
  els.toggleMap.textContent=mapHidden?"Mostrar mapa":"Ocultar mapa";
  if(mapHidden)return;
  initMap();
  markerLayer.clearLayers();
  const mapped=list.filter(hasCoords);
  els.mapMeta.textContent=mapped.length+" de "+list.length+" con ubicación";
  if(!mapped.length){
    candidateMap.setView([41.75,1.8],7);
    return;
  }
  const bounds=[];
  for(const h of mapped){
    const lat=Number(h.latitude),lon=Number(h.longitude);
    bounds.push([lat,lon]);
    const precise=["cadastral","exact_address"].includes(h.locationPrecision);
    const icon=L.divIcon({
      className:"house-marker-wrap",
      html:'<span class="house-marker '+(precise?"precise":"approx")+'">'+Math.round(h.price/1000)+'k</span>',
      iconSize:[44,28],iconAnchor:[22,14]
    });
    const popup='<div class="map-popup"><strong>'+esc(euro(h.price))+'</strong><span>'+esc(h.title)+'</span><small>'+esc(cleanPlace(h.place)||h.province||"Cataluña")+' · '+(precise?"ubicación precisa":"ubicación aproximada")+'</small><a href="/property.html?id='+encodeURIComponent(h.dbId)+'">Ver ficha</a></div>';
    L.marker([lat,lon],{icon}).bindPopup(popup,{maxWidth:250}).addTo(markerLayer);
  }
  candidateMap.fitBounds(bounds,{padding:[30,30],maxZoom:11});
  setTimeout(()=>candidateMap.invalidateSize(),0);
}

function persistCompare(){
  localStorage.setItem("compareHomes",JSON.stringify([...compareSelected]));
}
function updateCompareDock(){
  const n=compareSelected.size;
  els.compareDock.hidden=n===0;
  els.compareCount.textContent=n+" seleccionada"+(n===1?"":"s");
  els.openCompare.disabled=n<2;
}
function toggleCompare(id){
  if(compareSelected.has(id))compareSelected.delete(id);
  else{
    if(compareSelected.size>=4){toast("Puedes comparar un máximo de 4 viviendas.");return}
    compareSelected.add(id);
  }
  persistCompare();
  render();
}
function comparisonValue(h,key){
  if(key==="price")return euro(h.price);
  if(key==="bedrooms")return String(h.bedrooms);
  if(key==="houseM2")return h.houseM2?h.houseM2+" m²":"Pendiente";
  if(key==="plotM2")return h.plotM2?h.plotM2+" m²":"Pendiente";
  if(key==="driveMinutes")return h.driveMinutes!=null?Math.round(h.driveMinutes)+" min":"Pendiente";
  if(key==="independent")return h.independentStatus==="confirmed"?"Confirmada":h.independentStatus==="probable"?"Probable":"Pendiente";
  if(key==="condition")return h.conditionStatus==="confirmed"?"Para entrar indicado":"Pendiente";
  if(key==="services")return servicesKnown(h)?"Detectados":"Pendiente";
  if(key==="confidence")return h.confidenceScore+"/100";
  if(key==="family"){
    const f=familyInfo(h);
    if(!f)return "Sin seguimiento";
    const rating=Number(f.average_rating)>0?" · "+Number(f.average_rating).toFixed(1)+"/5":"";
    return familyStageLabel(f.stage)+rating;
  }
  if(key==="score")return h.score+"/100";
  return "—";
}
function openCompare(){
  const homes=[...compareSelected].map(id=>payload.listings.find(h=>h.dbId===id)).filter(Boolean).slice(0,4);
  if(homes.length<2){toast("Selecciona al menos 2 viviendas.");return}
  const rows=[
    ["Precio","price"],["Habitaciones","bedrooms"],["Vivienda","houseM2"],["Parcela","plotM2"],
    ["Trayecto","driveMinutes"],["Independencia","independent"],["Estado","condition"],
    ["Servicios","services"],["Familia","family"],["Información disponible","confidence"],["Coincide con tu búsqueda","score"]
  ];
  const head='<tr><th>Dato</th>'+homes.map(h=>'<th><a href="/property.html?id='+encodeURIComponent(h.dbId)+'">'+esc(cleanPlace(h.place)||h.title)+'</a><small>'+esc(euro(h.price))+'</small></th>').join("")+'</tr>';
  const body=rows.map(([label,key])=>'<tr><th>'+esc(label)+'</th>'+homes.map(h=>'<td>'+esc(comparisonValue(h,key))+'</td>').join("")+'</tr>').join("");
  els.compareWrap.innerHTML='<table class="compare-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table>';
  compareReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  els.compareModal.hidden=false;
  document.body.classList.add("modal-open");
  const closeButton=els.compareModal.querySelector("[data-close-compare]");
  requestAnimationFrame(()=>closeButton?.focus());
}
function closeCompare(){
  els.compareModal.hidden=true;
  document.body.classList.remove("modal-open");
  compareReturnFocus?.focus?.();
  compareReturnFocus=null;
}

function updateAlertButton(){
  if(!els.alertBtn)return;
  if(!("Notification" in window)){
    els.alertBtn.hidden=true;
    return;
  }
  const enabled=localStorage.getItem("candidateAlerts")==="1"&&Notification.permission==="granted";
  els.alertBtn.textContent=enabled?"✓ Alertas activas":"Activar alertas";
  els.alertBtn.classList.toggle("connected",enabled);
}
async function enableAlerts(){
  if(!("Notification" in window)){toast("Este navegador no admite notificaciones.");return}
  if(Notification.permission==="denied"){toast("Las notificaciones están bloqueadas en el navegador.");return}
  if(localStorage.getItem("candidateAlerts")==="1"&&Notification.permission==="granted"){
    localStorage.removeItem("candidateAlerts");
    updateAlertButton();
    toast("Alertas desactivadas en este dispositivo.");
    return;
  }
  const permission=await Notification.requestPermission();
  if(permission==="granted"){
    localStorage.setItem("candidateAlerts","1");
    updateAlertButton();
    toast("Alertas activadas mientras Casa Cataluña esté abierta o instalada.");
  }
}
async function notifyHomes(homes){
  if(!homes.length||localStorage.getItem("candidateAlerts")!=="1"||Notification.permission!=="granted")return;
  const h=homes[0];
  const title=homes.length===1?"Nueva candidata":"Nuevas candidatas: "+homes.length;
  const body=homes.length===1?(euro(h.price)+" · "+h.bedrooms+" hab. · "+(cleanPlace(h.place)||h.province)):"Hay "+homes.length+" viviendas nuevas que cumplen los filtros duros.";
  try{
    const reg=await navigator.serviceWorker?.ready;
    if(reg)await reg.showNotification(title,{body,icon:"/icon.svg",tag:"new-candidates",data:{url:homes.length===1?"/property.html?id="+h.dbId:"/"}});
    else new Notification(title,{body});
  }catch{try{new Notification(title,{body})}catch{}}
}

function render(){
  const a=filteredList();
  const shown=a.slice(0,visibleLimit);
  els.grid.innerHTML=shown.map(card).join("");
  els.empty.hidden=!!a.length;

  const all=dedupeListings((payload.listings||[]).filter(candidate));
  const compatibleAll=all.filter(h=>h.safetyDecision==="ACCEPT");
  const reviewAll=all.filter(h=>h.safetyDecision==="REVIEW");
  const bootstrapping=all.length===0&&Object.keys(payload.sourceStatus||{}).length===0;

  els.visible.textContent=bootstrapping?"—":a.length;
  els.newCount.textContent=bootstrapping?"—":all.filter(isRecent).length;
  els.under180.textContent=bootstrapping?"—":all.filter(h=>h.price<=TARGET_PRICE).length;
  els.savedCount.textContent=familyCode?familySaved.size:localSaved.size;
  if(els.allSafetyCount)els.allSafetyCount.textContent=bootstrapping?"—":all.length;
  if(els.compatibleCount)els.compatibleCount.textContent=bootstrapping?"—":compatibleAll.length;
  if(els.reviewCount)els.reviewCount.textContent=bootstrapping?"—":reviewAll.length;
  document.querySelectorAll("[data-safety-view]").forEach(btn=>{
    const selected=btn.dataset.safetyView===safetyView;
    btn.classList.toggle("active",selected);
    btn.setAttribute("aria-pressed",selected?"true":"false");
  });

  if(bootstrapping){
    els.empty.hidden=false;
    els.empty.textContent="Sincronizando el catálogo seguro por primera vez.";
  }else if(!a.length){
    els.empty.textContent=els.status.value==="since-visit"&&!previousVisitAt
      ?"Esta es tu primera visita en este dispositivo. Ya hemos guardado el punto de referencia; en la próxima visita podrás ver solo las viviendas nuevas."
      :"No hay viviendas que coincidan con estos filtros. El rastreador seguirá buscando.";
  }

  els.resultMeta.textContent=a.length>shown.length
    ? "Mostrando "+shown.length+" de "+a.length
    : a.length+" resultado"+(a.length===1?"":"s");

  els.loadMore.hidden=shown.length>=a.length;
  els.updatedAt.textContent="Datos "+fmt(payload.generatedAt);
  els.lastScan.textContent=fmt(payload.generatedAt);

  const st=Object.values(payload.sourceStatus||{});
  const ok=st.filter(x=>x?.status==="ok").length;
  const down=st.filter(x=>x?.status==="down").length;
  els.sourceHealth.textContent=st.length?(ok+" activas"+(down?" · "+down+" bloqueadas":"")):"—";
  renderMap(a);
  updateCompareDock();

  document.querySelectorAll("[data-compare]").forEach(x=>x.onclick=()=>toggleCompare(x.dataset.compare));
  document.querySelectorAll("[data-save]").forEach(x=>x.onclick=async()=>{
    const id=x.dataset.save,dbId=x.dataset.db;
    if(familyCode){
      const next=!familySaved.has(dbId);
      x.disabled=true;
      const {error}=await db.rpc("family_toggle_favorite",{p_code:familyCode,p_property_id:dbId,p_favorite:next});
      x.disabled=false;
      if(error){toast("No se pudo sincronizar el favorito familiar.");return}
      next?familySaved.add(dbId):familySaved.delete(dbId);
      const current=familyOverview.get(dbId)||{property_id:dbId,stage:"new"};
      familyOverview.set(dbId,{...current,favorite:next});
      toast(next?"★ Guardada para la familia":"Favorito eliminado");
    }else{
      localSaved.has(id)?localSaved.delete(id):localSaved.add(id);
      localStorage.setItem("savedHomes",JSON.stringify([...localSaved]));
    }
    render();
  });
}

function transformProperty(row){
  const sources=(row.listing_sources||[]).filter(s=>s.active!==false);
  const source=sources[0]||{};
  return {
    dbId:row.id,
    id:row.fingerprint||row.id,
    status:row.status,
    sources,
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
    publishedAt:row.published_at||source.published_at||null,
    firstSeen:row.first_seen,
    lastSeen:row.last_seen,
    lastChecked:row.last_checked,
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
    safetyDecision:row.safety_decision||"REVIEW",
    safetyReason:row.safety_reason||null,
    safetyCode:row.safety_code||null,
    priceConfidence:row.price_confidence,
    dataConfidence:row.data_confidence,
    confidenceScore:Number(row.confidence_score)||0,
    latitude:row.latitude,
    longitude:row.longitude,
    locationPrecision:row.location_precision||"unknown",
    nearbyServices:row.nearby_services||[],
  };
}

async function load(silent=false){
  try{
    const [{data:rows,error},{data:health,error:healthError}]=await Promise.all([
      db.from("properties")
        .select("*, listing_sources(provider,url,image_url,published_at,active), nearby_services(category,name,distance_m,latitude,longitude,checked_at)")
        .in("status",["candidate","verified"])
        .lte("price",HARD_MAX_PRICE)
        .gte("bedrooms",MIN_BEDROOMS)
        .order("published_at",{ascending:false,nullsFirst:false}),
      db.from("source_health").select("*").order("provider")
    ]);
    if(error)throw error;
    if(healthError)throw healthError;

    const listings=(rows||[]).map(transformProperty).filter(candidate);
    const validCompareIds=new Set(listings.map(x=>x.dbId));
    const cleanedCompare=new Set([...compareSelected].filter(id=>validCompareIds.has(id)));
    if(cleanedCompare.size!==compareSelected.size){
      compareSelected=cleanedCompare;
      persistCompare();
    }
    const ids=new Set(listings.map(x=>x.id));
    if(silent&&known.size){
      const added=[...ids].filter(x=>!known.has(x));
      if(added.length){
        const homes=listings.filter(x=>added.includes(x.id));
        toast("🏠 "+added.length+" nueva"+(added.length>1?"s":"")+" candidata"+(added.length>1?"s":""));
        notifyHomes(homes);
      }
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
    els.empty.textContent="No se ha podido cargar el catálogo seguro. Reintentaremos automáticamente.";
  }
}

async function ensureFamilyMember({askName=false}={}){
  if(!familyCode)return false;
  if(!familyMemberId){
    familyMemberId=crypto.randomUUID();
    localStorage.setItem("familyMemberId",familyMemberId);
  }
  if(!familyMemberName&&askName){
    const name=prompt("¿Qué nombre quieres usar para identificar tus votos y notas familiares?");
    if(!name?.trim())return false;
    familyMemberName=name.trim().slice(0,40);
    localStorage.setItem("familyMemberName",familyMemberName);
  }
  if(!familyMemberName)return false;

  const {error}=await db.rpc("family_member_upsert",{
    p_code:familyCode,p_member_id:familyMemberId,p_display_name:familyMemberName
  });
  if(error){
    console.error("family_member_upsert",error);
    toast("No se pudo registrar este dispositivo en el espacio familiar.");
    return false;
  }
  return true;
}

async function loadFamilyStatus(code,{quiet=false}={}){
  if(!code)return false;
  const {data,error}=await db.rpc("family_overview",{p_code:code});
  if(error){
    if(!quiet)toast("Código familiar no válido o sincronización no disponible.");
    return false;
  }
  familyOverview=new Map((data||[]).map(x=>[x.property_id,x]));
  familySaved=new Set((data||[]).filter(x=>x.favorite).map(x=>x.property_id));
  familyCode=code;
  localStorage.setItem("familyCode",code);
  updateFamilyButton();
  render();
  return true;
}

function updateFamilyButton(){
  if(!els.familyBtn)return;
  els.familyBtn.textContent=familyCode
    ? "✓ Familia"+(familyMemberName?" · "+familyMemberName:"")
    : "Conectar familia";
  els.familyBtn.classList.toggle("connected",!!familyCode);
}

async function connectFamily(){
  if(familyCode){
    const choice=confirm("¿Quieres desconectar el espacio familiar en este dispositivo?");
    if(choice){
      familyCode="";
      familySaved=new Set();
      familyOverview=new Map();
      localStorage.removeItem("familyCode");
      updateFamilyButton();
      render();
    }
    return;
  }
  const code=prompt("Introduce el código familiar de Casa Cataluña:");
  if(!code)return;
  const ok=await loadFamilyStatus(code.trim());
  if(!ok)return;
  await ensureFamilyMember({askName:true});
  updateFamilyButton();
}

function subscribeRealtime(){
  if(realtimeChannel)db.removeChannel(realtimeChannel);
  realtimeChannel=db.channel("casas-catalunya-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"properties"},()=>load(true))
    .on("postgres_changes",{event:"*",schema:"public",table:"listing_sources"},()=>load(true))
    .on("postgres_changes",{event:"*",schema:"public",table:"nearby_services"},()=>load(false))
    .on("postgres_changes",{event:"*",schema:"public",table:"source_health"},()=>load(false))
    .subscribe();
}

[els.search,els.province,els.budget,els.status,els.sort,els.bedrooms,els.drive,els.confidence,els.extra].filter(Boolean).forEach(x=>x.addEventListener(x===els.search?"input":"change",()=>{
  visibleLimit=PAGE_SIZE;
  render();
}));
els.loadMore.addEventListener("click",()=>{visibleLimit+=PAGE_SIZE;render()});
document.querySelectorAll("[data-safety-view]").forEach(btn=>btn.addEventListener("click",()=>{
  safetyView=btn.dataset.safetyView||"all";
  localStorage.setItem("safetyView",safetyView);
  visibleLimit=PAGE_SIZE;
  render();
}));
els.familyBtn?.addEventListener("click",connectFamily);
els.alertBtn?.addEventListener("click",enableAlerts);
els.toggleMap?.addEventListener("click",()=>{
  mapHidden=!mapHidden;
  localStorage.setItem("mapHidden",mapHidden?"1":"0");
  els.toggleMap.setAttribute("aria-expanded",mapHidden?"false":"true");
  render();
});
els.clearCompare?.addEventListener("click",()=>{compareSelected.clear();persistCompare();render()});
els.openCompare?.addEventListener("click",openCompare);
document.querySelectorAll("[data-close-compare]").forEach(x=>x.addEventListener("click",closeCompare));
document.addEventListener("keydown",e=>{
  if(els.compareModal.hidden)return;
  if(e.key==="Escape"){closeCompare();return}
  if(e.key!=="Tab")return;
  const focusable=[...els.compareModal.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(x=>!x.hasAttribute("hidden"));
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
updateFamilyButton();
updateAlertButton();
updateCompareDock();

load().then(async()=>{
  subscribeRealtime();
  if(familyCode){
    const ok=await loadFamilyStatus(familyCode,{quiet:true});
    if(!ok){
      familyCode="";
      familySaved=new Set();
      familyOverview=new Map();
      localStorage.removeItem("familyCode");
      updateFamilyButton();
      render();
    }
  }
});
setInterval(()=>load(true),60000);
setInterval(()=>{if(familyCode)loadFamilyStatus(familyCode,{quiet:true})},15000);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(e=>console.warn("PWA service worker",e)));
}
