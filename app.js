import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import * as L from "https://esm.sh/leaflet@1.9.4";

const SUPABASE_URL="https://ethtlpnvqyxkoeudtcsj.supabase.co";
const SUPABASE_KEY="sb_publishable_RAi269FvaP67ITZDNLi_bg_O-56BiRu";
const HARD_MAX_PRICE=185000;
const TARGET_PRICE=180000;
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
  compareModal:$("#compareModal"),compareWrap:$("#compareTableWrap")
};

let payload={listings:[],sourceStatus:{}};
let known=new Set();
let localSaved=new Set(JSON.parse(localStorage.getItem("savedHomes")||"[]"));
let familySaved=new Set();
let familyCode=localStorage.getItem("familyCode")||"";
let realtimeChannel=null;
let visibleLimit=PAGE_SIZE;
let candidateMap=null;
let markerLayer=null;
let mapHidden=localStorage.getItem("mapHidden")==="1";
let compareSelected=new Set(JSON.parse(localStorage.getItem("compareHomes")||"[]"));
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
  Number(h.bedrooms)>=3 &&
  h.occupancyStatus!=="blocked" &&
  h.financingStatus!=="blocked";

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
  const ts=[];
  ts.push(h.status==="verified"?tag("Documentación verificada","verified"):tag("Candidata","candidate"));
  const fresh=freshnessBadge(h);if(fresh)ts.push(fresh);
  if((h.score||0)>=84)ts.push(tag("Buen encaje","fit"));
  if(stretch(h))ts.push(tag("180–185k","stretch"));
  if(h.registryStatus!=="verified_clear")ts.push(tag("Nota simple pendiente","pending"));

  const img=safe(h.imageUrl);
  const media=img
    ? '<div class="card-media"><img loading="lazy" referrerpolicy="no-referrer" src="'+esc(img)+'" alt=""><span class="media-badge">'+esc(h.provider||"Fuente")+'</span></div>'
    : '<div class="card-media"><div class="photo-fallback">Foto disponible en el anuncio original</div><span class="media-badge">'+esc(h.provider||"Fuente")+'</span></div>';

  const travel=h.driveMinutes!=null?Math.round(h.driveMinutes)+" min aprox.":"Distancia pendiente";
  const link=safe(h.url);
  const sv=isSaved(h);
  const place=cleanPlace(h.place)||"Localidad por confirmar";
  const sourceCount=(h.sources||[]).length||1;

  const timing=h.publishedAt
    ? "Publicado "+fmt(h.publishedAt)
    : "Publicación desconocida · detectado "+fmt(h.firstSeen);

  return '<article class="card">'+media+'<div class="card-body">'+
    '<div class="card-top"><div class="tags">'+ts.join("")+'</div><div class="card-tools"><button class="compare-chip '+(compareSelected.has(h.dbId)?"selected":"")+'" data-compare="'+esc(h.dbId)+'">'+(compareSelected.has(h.dbId)?"✓ Comparar":"+ Comparar")+'</button><span class="score" title="Puntuación de encaje, no verificación legal">'+esc(h.score||0)+'/100</span></div></div>'+
    '<div><div class="price">'+euro(h.price)+(stretch(h)?'<small>margen</small>':"")+'</div><h2>'+esc(h.title)+'</h2><div class="place">'+esc(place)+' · '+esc(h.province||"Cataluña")+'</div></div>'+
    '<div class="features"><span>'+esc(h.bedrooms)+' hab.</span>'+(h.houseM2?'<span>'+esc(h.houseM2)+' m² casa</span>':"")+(h.plotM2?'<span>'+esc(h.plotM2)+' m² parcela</span>':"")+'<span>'+esc(travel)+'</span>'+(h.hasGarage?'<span>Garaje</span>':"")+(h.hasPool?'<span>Piscina</span>':"")+'</div>'+
    '<p>'+esc(h.summary||"Candidata detectada automáticamente.")+'</p>'+
    '<div class="checks">'+
      check("Jardín/parcela detectado","ok")+
      check(h.independentStatus==="confirmed"?"Independiente confirmada":h.independentStatus==="probable"?"Probablemente independiente":"Independencia por confirmar",h.independentStatus==="confirmed"?"ok":"pending")+
      check(h.conditionStatus==="confirmed"?"Estado para entrar indicado":"Estado por confirmar",h.conditionStatus==="confirmed"?"ok":"pending")+
      check(h.occupancyStatus==="confirmed_free"?"Entrega libre indicada":"Sin señales de ocupación; confirmar",h.occupancyStatus==="confirmed_free"?"ok":"pending")+
      check(h.financingStatus==="compatible"?"Financiación compatible confirmada":"Sin restricción bancaria detectada",h.financingStatus==="compatible"?"ok":"pending")+
      check(h.registryStatus==="verified_clear"?"Cargas verificadas":h.registryStatus==="claimed_clear"?"Anuncio afirma libre de cargas":"Nota simple pendiente",h.registryStatus==="verified_clear"?"ok":"pending")+
    '</div>'+
    '<div class="meta"><span>'+esc(timing)+'</span><span>Revisada '+fmt(h.lastSeen||h.lastChecked)+'</span><span>'+sourceCount+' fuente'+(sourceCount>1?"s":"")+'</span></div>'+
    '<div class="actions"><button class="'+(sv?"saved":"")+'" data-save="'+esc(h.id)+'" data-db="'+esc(h.dbId)+'">'+(sv?"★ Guardada":"☆ Guardar")+'</button><a class="detail-link" href="/property.html?id='+encodeURIComponent(h.dbId)+'">Ver ficha</a>'+(link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">Anuncio ↗</a>':"")+'</div>'+
    '</div></article>';
}

function filteredList(){
  let a=dedupeListings((payload.listings||[]).filter(candidate));
  const q=els.search.value.toLowerCase().trim(),p=els.province.value,b=els.budget.value,s=els.status.value;
  const minBeds=Number(els.bedrooms?.value||3),maxDrive=Number(els.drive?.value||0);
  const confidence=els.confidence?.value||"",extra=els.extra?.value||"";

  if(q)a=a.filter(h=>(h.title+" "+(cleanPlace(h.place)||"")).toLowerCase().includes(q));
  if(p)a=a.filter(h=>h.province===p);
  a=a.filter(h=>h.bedrooms>=minBeds);

  if(b==="180")a=a.filter(h=>h.price<=TARGET_PRICE);
  else if(b==="185"||b==="smart185")a=a.filter(h=>h.price<=HARD_MAX_PRICE);

  if(maxDrive)a=a.filter(h=>h.driveMinutes!=null&&Number(h.driveMinutes)<=maxDrive);
  if(confidence==="high")a=a.filter(h=>h.dataConfidence==="high");
  if(confidence==="medium")a=a.filter(h=>["high","medium"].includes(h.dataConfidence));

  if(extra==="garage")a=a.filter(h=>h.hasGarage);
  if(extra==="pool")a=a.filter(h=>h.hasPool);
  if(extra==="services")a=a.filter(servicesKnown);
  if(extra==="mapped")a=a.filter(hasCoords);

  if(s==="new")a=a.filter(isRecent);
  if(s==="since-visit")a=a.filter(newSinceVisit);
  if(s==="best")a=a.filter(h=>(h.score||0)>=84);
  if(s==="verified")a=a.filter(h=>h.status==="verified");
  if(s==="independent")a=a.filter(h=>["confirmed","probable"].includes(h.independentStatus));
  if(s==="pending")a=a.filter(h=>h.conditionStatus!=="confirmed"||h.independentStatus!=="confirmed"||h.registryStatus!=="verified_clear");
  if(s==="saved")a=a.filter(isSaved);

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
  if(key==="score")return h.score+"/100";
  return "—";
}
function openCompare(){
  const homes=[...compareSelected].map(id=>payload.listings.find(h=>h.dbId===id)).filter(Boolean).slice(0,4);
  if(homes.length<2){toast("Selecciona al menos 2 viviendas.");return}
  const rows=[
    ["Precio","price"],["Habitaciones","bedrooms"],["Vivienda","houseM2"],["Parcela","plotM2"],
    ["Trayecto","driveMinutes"],["Independencia","independent"],["Estado","condition"],
    ["Servicios","services"],["Confianza de datos","confidence"],["Encaje","score"]
  ];
  const head='<tr><th>Dato</th>'+homes.map(h=>'<th><a href="/property.html?id='+encodeURIComponent(h.dbId)+'">'+esc(cleanPlace(h.place)||h.title)+'</a><small>'+esc(euro(h.price))+'</small></th>').join("")+'</tr>';
  const body=rows.map(([label,key])=>'<tr><th>'+esc(label)+'</th>'+homes.map(h=>'<td>'+esc(comparisonValue(h,key))+'</td>').join("")+'</tr>').join("");
  els.compareWrap.innerHTML='<table class="compare-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table>';
  els.compareModal.hidden=false;
  document.body.classList.add("modal-open");
}
function closeCompare(){
  els.compareModal.hidden=true;
  document.body.classList.remove("modal-open");
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
  const bootstrapping=all.length===0&&Object.keys(payload.sourceStatus||{}).length===0;

  els.visible.textContent=bootstrapping?"—":a.length;
  els.newCount.textContent=bootstrapping?"—":all.filter(isRecent).length;
  els.under180.textContent=bootstrapping?"—":all.filter(h=>h.price<=TARGET_PRICE).length;
  els.savedCount.textContent=familyCode?familySaved.size:localSaved.size;

  if(bootstrapping){
    els.empty.hidden=false;
    els.empty.textContent="Sincronizando el catálogo seguro por primera vez.";
  }else if(!a.length){
    els.empty.textContent="No hay viviendas que coincidan con estos filtros. El rastreador seguirá buscando.";
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

async function loadFamilyStatus(code,{quiet=false}={}){
  if(!code)return false;
  const {data,error}=await db.rpc("family_status_list",{p_code:code});
  if(error){
    if(!quiet)toast("Código familiar no válido o sincronización no disponible.");
    return false;
  }
  familySaved=new Set((data||[]).filter(x=>x.favorite).map(x=>x.property_id));
  familyCode=code;
  localStorage.setItem("familyCode",code);
  updateFamilyButton();
  render();
  return true;
}

function updateFamilyButton(){
  if(!els.familyBtn)return;
  els.familyBtn.textContent=familyCode?"✓ Favoritos familiares":"Conectar familia";
  els.familyBtn.classList.toggle("connected",!!familyCode);
}

async function connectFamily(){
  if(familyCode){
    if(confirm("¿Desconectar los favoritos familiares en este dispositivo?")){
      familyCode="";
      familySaved=new Set();
      localStorage.removeItem("familyCode");
      updateFamilyButton();
      render();
    }
    return;
  }
  const code=prompt("Introduce el código familiar de Casa Cataluña:");
  if(!code)return;
  await loadFamilyStatus(code.trim());
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
els.familyBtn?.addEventListener("click",connectFamily);
els.alertBtn?.addEventListener("click",enableAlerts);
els.toggleMap?.addEventListener("click",()=>{
  mapHidden=!mapHidden;
  localStorage.setItem("mapHidden",mapHidden?"1":"0");
  render();
});
els.clearCompare?.addEventListener("click",()=>{compareSelected.clear();persistCompare();render()});
els.openCompare?.addEventListener("click",openCompare);
document.querySelectorAll("[data-close-compare]").forEach(x=>x.addEventListener("click",closeCompare));
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!els.compareModal.hidden)closeCompare()});
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
      localStorage.removeItem("familyCode");
      updateFamilyButton();
      render();
    }
  }
});
setInterval(()=>load(true),60000);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(e=>console.warn("PWA service worker",e)));
}
