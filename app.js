const RAW_DATA_URL="https://raw.githubusercontent.com/AlbaGG95/casas-catalunya/main/data/listings.json";
const els={
  grid:document.querySelector("#listingGrid"),empty:document.querySelector("#emptyState"),
  search:document.querySelector("#searchInput"),province:document.querySelector("#provinceFilter"),
  budget:document.querySelector("#budgetFilter"),status:document.querySelector("#statusFilter"),
  sort:document.querySelector("#sortFilter"),visible:document.querySelector("#visibleCount"),
  newCount:document.querySelector("#newCount"),under180:document.querySelector("#under180Count"),
  savedCount:document.querySelector("#savedCount"),updatedAt:document.querySelector("#updatedAt"),
  lastScan:document.querySelector("#lastScan"),sourceHealth:document.querySelector("#sourceHealth"),
  toast:document.querySelector("#toast")
};
let payload={generatedAt:null,listings:[],sourceStatus:{}};
let saved=new Set(JSON.parse(localStorage.getItem("savedHomes")||"[]"));
let knownIds=new Set();

const euro=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const fmtDate=v=>v?new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";
const hoursSince=v=>v?Math.max(0,(Date.now()-new Date(v).getTime())/3600000):Infinity;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const safeUrl=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.toString():""}catch{return ""}};
const evidenceDate=h=>h.publishedAt||((h.freshnessEvidence==="recent_source")?h.firstSeen:null);
const isRecent=h=>h.freshnessStatus==="recent"||hoursSince(evidenceDate(h))<=168;
const isNew48=h=>h.freshnessStatus==="recent"&&hoursSince(evidenceDate(h))<=48;
const isStretch=h=>h.price>180000&&h.price<=185000;
const isCandidate=h=>h.active!==false&&h.freshnessStatus!=="old"&&h.conditionStatus!=="rejected"&&h.occupancyStatus!=="blocked"&&h.financingStatus!=="blocked";

function showToast(message){
  els.toast.textContent=message;els.toast.hidden=false;
  clearTimeout(showToast.t);showToast.t=setTimeout(()=>els.toast.hidden=true,5000);
}
function tag(text,cls=""){return '<span class="tag '+cls+'">'+esc(text)+'</span>'}
function check(label,state){
  const map={ok:["ok","✓ "],pending:["pending","⚠ "],info:["info","• "],bad:["bad","✕ "]};
  const [cls,icon]=map[state]||map.pending;
  return '<span class="check '+cls+'">'+icon+esc(label)+'</span>';
}
function freshnessLabel(h){
  const d=evidenceDate(h);
  if(isNew48(h))return "Nueva ≤48 h";
  if(isRecent(h))return "Reciente";
  if(d)return "Publicación "+fmtDate(d);
  return "Fecha de publicación pendiente";
}
function card(h){
  const t=[];
  if(isNew48(h))t.push(tag("Nueva ≤48 h","new")); else if(isRecent(h))t.push(tag("Reciente","new"));
  if((h.score||0)>=86)t.push(tag("Muy buen encaje","fit"));
  if(h.occupancyStatus==="confirmed_free")t.push(tag("Libre indicada","free"));
  if(isStretch(h))t.push(tag("180–185k","stretch"));
  if(h.registryStatus==="claimed_clear")t.push(tag("Anuncio dice libre de cargas","free"));
  else t.push(tag("Nota simple pendiente","pending"));

  const img=safeUrl(h.imageUrl);
  const media=img
    ? '<div class="card-media"><img loading="lazy" referrerpolicy="no-referrer" src="'+esc(img)+'" alt=""><span class="media-badge">'+esc(freshnessLabel(h))+'</span></div>'
    : '<div class="card-media"><div class="photo-fallback">Foto disponible en el anuncio original</div><span class="media-badge">'+esc(freshnessLabel(h))+'</span></div>';

  const travel=h.driveMinutes!=null?Math.round(h.driveMinutes)+" min aprox.":null;
  const finance=h.financingStatus==="no_restrictions_detected"?"Sin restricciones bancarias detectadas":"Financiación pendiente";
  const registry=h.registryStatus==="claimed_clear"?"Anuncio afirma libre de cargas":"Nota simple pendiente";
  const occupancy=h.occupancyStatus==="confirmed_free"?"Entrega/libre indicada":"Sin señales de ocupación; confirmar";
  const savedClass=saved.has(h.id)?" saved":"";
  const savedText=saved.has(h.id)?"Quitar guardada":"Guardar casa";
  const houseLink=safeUrl(h.url);

  return '<article class="card">'+media+'<div class="card-body">'+
    '<div class="card-top"><div class="tags">'+t.join("")+'</div><span class="score">'+esc(h.score||0)+'/100</span></div>'+
    '<div><div class="price">'+euro(h.price)+(isStretch(h)?'<small>margen excepcional</small>':"")+'</div>'+
    '<h2>'+esc(h.title)+'</h2><div class="place">'+esc(h.place||"Localidad pendiente")+' · '+esc(h.province||"Cataluña")+'</div></div>'+
    '<div class="features"><span>'+esc(h.bedrooms||"3+")+' hab.</span><span>Jardín/parcela</span>'+
      (h.plotM2?'<span>'+esc(h.plotM2)+' m² parcela</span>':"")+
      (h.houseM2?'<span>'+esc(h.houseM2)+' m² vivienda</span>':"")+
      (travel?'<span>'+esc(travel)+'</span>':"")+
    '</div>'+
    '<p>'+esc(h.summary||"Candidata detectada automáticamente.")+'</p>'+
    '<div class="checks">'+
      check("Casa independiente",h.independentStatus==="confirmed"?"ok":"pending")+
      check("Estado para entrar",h.conditionStatus==="confirmed"?"ok":"pending")+
      check(occupancy,h.occupancyStatus==="confirmed_free"?"ok":"pending")+
      check(finance,h.financingStatus==="no_restrictions_detected"?"ok":"pending")+
      check(registry,h.registryStatus==="claimed_clear"?"ok":"pending")+
      check(h.fiberStatus==="confirmed"?"Fibra indicada":"Fibra por verificar",h.fiberStatus==="confirmed"?"ok":"pending")+
      check(travel||"Distancia por verificar",h.travelStatus==="confirmed"?"ok":"pending")+
      check(h.servicesStatus==="confirmed"?"Servicios cercanos indicados":"Servicios por verificar",h.servicesStatus==="confirmed"?"ok":"info")+
    '</div>'+
    '<div class="meta"><span>'+esc(h.provider)+'</span><span>Detectada: '+esc(fmtDate(h.firstSeen))+'</span><span>Revisada: '+esc(fmtDate(h.lastSeen||h.lastChecked))+'</span></div>'+
    '<div class="actions"><button class="'+savedClass+'" data-save="'+esc(h.id)+'">'+savedText+'</button>'+
      (houseLink?'<a href="'+esc(houseLink)+'" target="_blank" rel="noopener noreferrer">Ver anuncio original</a>':"")+
    '</div></div></article>';
}
function render(){
  let list=[...(payload.listings||[])].filter(isCandidate);
  const q=els.search.value.trim().toLowerCase(),province=els.province.value,status=els.status.value,budget=els.budget.value;
  if(q)list=list.filter(h=>(String(h.title)+" "+String(h.place||"")+" "+String(h.area||"")).toLowerCase().includes(q));
  if(province)list=list.filter(h=>h.province===province);
  if(budget==="180")list=list.filter(h=>h.price<=180000);
  if(budget==="185")list=list.filter(h=>h.price<=185000);
  if(budget==="smart185")list=list.filter(h=>h.price<=180000||(h.price<=185000&&(h.score||0)>=84));
  if(status==="new")list=list.filter(isRecent);
  if(status==="best")list=list.filter(h=>(h.score||0)>=86);
  if(status==="independent")list=list.filter(h=>h.independentStatus==="confirmed");
  if(status==="free")list=list.filter(h=>h.occupancyStatus==="confirmed_free");
  if(status==="pending")list=list.filter(h=>h.registryStatus!=="verified"||h.fiberStatus!=="confirmed"||h.independentStatus!=="confirmed");
  if(status==="saved")list=list.filter(h=>saved.has(h.id));

  const sort=els.sort.value;
  const dateOf=h=>new Date(evidenceDate(h)||h.firstSeen||0).getTime();
  if(sort==="recent")list.sort((a,b)=>dateOf(b)-dateOf(a)||(b.score||0)-(a.score||0));
  else if(sort==="price-asc")list.sort((a,b)=>a.price-b.price);
  else if(sort==="price-desc")list.sort((a,b)=>b.price-a.price);
  else list.sort((a,b)=>(b.score||0)-(a.score||0)||dateOf(b)-dateOf(a));

  els.grid.innerHTML=list.map(card).join("");
  els.empty.hidden=list.length>0;
  const candidates=(payload.listings||[]).filter(isCandidate);
  els.visible.textContent=list.length;
  els.newCount.textContent=candidates.filter(isRecent).length;
  els.under180.textContent=candidates.filter(h=>h.price<=180000).length;
  els.savedCount.textContent=saved.size;
  els.updatedAt.textContent="Datos: "+fmtDate(payload.generatedAt);
  els.lastScan.textContent=fmtDate(payload.generatedAt);
  const statuses=Object.values(payload.sourceStatus||{});
  const ok=statuses.filter(x=>x&&x.ok).length;
  els.sourceHealth.textContent=statuses.length?(ok+" de "+statuses.length+" OK"):"sin datos";

  document.querySelectorAll("[data-save]").forEach(btn=>btn.addEventListener("click",()=>{
    const id=btn.dataset.save;saved.has(id)?saved.delete(id):saved.add(id);
    localStorage.setItem("savedHomes",JSON.stringify([...saved]));render();
  }));
}
async function loadData({silent=false}={}){
  let next=null;
  try{
    const r=await fetch(RAW_DATA_URL+"?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw new Error("raw "+r.status);
    next=await r.json();
  }catch(e){
    try{
      const r=await fetch("/data/listings.json?ts="+Date.now(),{cache:"no-store"});
      next=await r.json();
    }catch(e2){console.error(e,e2);return}
  }
  const nextIds=new Set((next.listings||[]).filter(isCandidate).map(x=>x.id));
  if(silent&&knownIds.size){
    const added=[...nextIds].filter(id=>!knownIds.has(id));
    if(added.length)showToast("🏠 "+added.length+" vivienda"+(added.length===1?" nueva":"s nuevas")+" añadida"+(added.length===1?"":"s")+".");
  }
  payload=next;knownIds=nextIds;render();
}
[els.search,els.province,els.budget,els.status,els.sort].forEach(el=>el.addEventListener(el===els.search?"input":"change",render));
loadData();
setInterval(()=>loadData({silent:true}),60000);
