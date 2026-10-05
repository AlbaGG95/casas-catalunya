const els={
  grid:document.querySelector("#listingGrid"),empty:document.querySelector("#emptyState"),
  search:document.querySelector("#searchInput"),province:document.querySelector("#provinceFilter"),
  status:document.querySelector("#statusFilter"),sort:document.querySelector("#sortFilter"),
  visible:document.querySelector("#visibleCount"),newCount:document.querySelector("#newCount"),
  freeCount:document.querySelector("#freeCount"),savedCount:document.querySelector("#savedCount"),
  updatedAt:document.querySelector("#updatedAt")
};

let payload={generatedAt:null,listings:[]};
let saved=new Set(JSON.parse(localStorage.getItem("savedHomes")||"[]"));
const euro=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const daysSince=date=>Math.floor((Date.now()-new Date(date).getTime())/86400000);
const isNew=h=>h.firstSeen&&daysSince(h.firstSeen)<=7;
const fmtDate=v=>v?new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"sin fecha";

function occupancyTag(h){
  if(h.occupancyStatus==="confirmed_free") return '<span class="tag free">Libre confirmada</span>';
  return '<span class="tag pending">Sin indicios de ocupación</span>';
}
function check(label,status){
  return '<span class="check '+(status==="ok"?"ok":"pending")+'">'+(status==="ok"?"✓ ":"⚠ ")+label+'</span>';
}
function card(h){
  const newTag=isNew(h)?'<span class="tag new">Nueva</span>':"";
  const fitTag=h.score>=80?'<span class="tag fit">Buen encaje</span>':"";
  const savedClass=saved.has(h.id)?" saved":"";
  const savedText=saved.has(h.id)?"Quitar guardada":"Guardar casa";
  return `
  <article class="card">
    <div class="card-top">
      <div class="tags">${newTag}${fitTag}${occupancyTag(h)}</div>
      <span class="score">${h.score||0}/100</span>
    </div>
    <div>
      <div class="price">${euro(h.price)}</div>
      <h2>${h.title}</h2>
      <div class="place">${h.place||"Localidad pendiente"} · ${h.province||"Cataluña"}</div>
    </div>
    <div class="features">
      <span>${h.bedrooms||"3+"} hab.</span>
      <span>Jardín/parcela</span>
      ${h.plotM2?'<span>'+h.plotM2+' m² parcela</span>':""}
      ${h.houseM2?'<span>'+h.houseM2+' m² vivienda</span>':""}
    </div>
    <p>${h.summary||"Candidata detectada automáticamente."}</p>
    <div class="checks">
      ${check("Tipología compatible",h.independentStatus==="confirmed"?"ok":"pending")}
      ${check("Buen estado",h.conditionStatus==="confirmed"?"ok":"pending")}
      ${check("Fibra",h.fiberStatus==="confirmed"?"ok":"pending")}
      ${check("≤ 1h30 aprox.",h.travelStatus==="confirmed"?"ok":"pending")}
    </div>
    <div class="meta">
      <span>${h.provider}</span>
      <span>Detectada: ${fmtDate(h.firstSeen)}</span>
      <span>Revisada: ${fmtDate(h.lastSeen)}</span>
    </div>
    <div class="actions">
      <button class="${savedClass}" data-save="${h.id}">${savedText}</button>
      <a href="${h.url}" target="_blank" rel="noopener noreferrer">Ver anuncio original</a>
    </div>
  </article>`;
}

function render(){
  let list=[...(payload.listings||[])].filter(h=>h.active!==false);
  const q=els.search.value.trim().toLowerCase();
  const province=els.province.value;
  const status=els.status.value;
  if(q) list=list.filter(h=>(h.title+" "+(h.place||"")).toLowerCase().includes(q));
  if(province) list=list.filter(h=>h.province===province);
  if(status==="new") list=list.filter(isNew);
  if(status==="best") list=list.filter(h=>(h.score||0)>=80);
  if(status==="free") list=list.filter(h=>h.occupancyStatus==="confirmed_free");
  if(status==="pending") list=list.filter(h=>h.occupancyStatus!=="confirmed_free"||h.fiberStatus!=="confirmed"||h.independentStatus!=="confirmed");
  const sort=els.sort.value;
  if(sort==="recent") list.sort((a,b)=>new Date(b.firstSeen||0)-new Date(a.firstSeen||0));
  else if(sort==="price-asc") list.sort((a,b)=>a.price-b.price);
  else if(sort==="price-desc") list.sort((a,b)=>b.price-a.price);
  else list.sort((a,b)=>(b.score||0)-(a.score||0)||new Date(b.firstSeen||0)-new Date(a.firstSeen||0));

  els.grid.innerHTML=list.map(card).join("");
  els.empty.hidden=list.length>0;
  els.visible.textContent=list.length;
  els.newCount.textContent=(payload.listings||[]).filter(h=>h.active!==false&&isNew(h)).length;
  els.freeCount.textContent=(payload.listings||[]).filter(h=>h.active!==false&&h.occupancyStatus==="confirmed_free").length;
  els.savedCount.textContent=saved.size;
  els.updatedAt.textContent="Última revisión: "+fmtDate(payload.generatedAt);

  document.querySelectorAll("[data-save]").forEach(btn=>btn.addEventListener("click",()=>{
    const id=btn.dataset.save;
    saved.has(id)?saved.delete(id):saved.add(id);
    localStorage.setItem("savedHomes",JSON.stringify([...saved]));
    render();
  }));
}

async function boot(){
  try{
    const r=await fetch("/data/listings.json?ts="+Date.now(),{cache:"no-store"});
    payload=await r.json();
  }catch(e){
    console.error(e);
    payload={generatedAt:new Date().toISOString(),listings:[]};
  }
  [els.search,els.province,els.status,els.sort].forEach(el=>el.addEventListener(el===els.search?"input":"change",render));
  render();
}
boot();
