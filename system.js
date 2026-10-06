const ENDPOINT="https://ethtlpnvqyxkoeudtcsj.supabase.co/functions/v1/system-status";
const $=s=>document.querySelector(s);
const fmt=v=>v?new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"—";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function invariant(label,ok,detail){
  return '<article class="invariant '+(ok?"ok":"bad")+'"><span>'+(ok?"✓":"⚠")+'</span><div><strong>'+esc(label)+'</strong><small>'+esc(detail)+'</small></div></article>';
}
function metric(label,value,detail=""){
  return '<article class="catalogue-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':"")+'</article>';
}
function sourceState(p){
  if(p.status==="ok"&&p.enabled)return '<span class="source-status ok">Operativa</span>';
  if(p.status==="quarantined"||!p.enabled)return '<span class="source-status warn">Cuarentena</span>';
  if(p.status==="degraded")return '<span class="source-status warn">Degradada</span>';
  return '<span class="source-status down">Caída</span>';
}

function render(data){
  const c=data.catalogue||{},inv=data.invariants||{},sources=data.sources||{};
  $("#systemTimestamp").textContent="Actualizado "+fmt(data.generatedAt);
  $("#sysActive").textContent=c.active??"—";
  $("#sysCompatible").textContent=c.compatible??"—";
  $("#sysReview").textContent=c.review??"—";
  $("#sysNew24").textContent=c.new24h??"—";
  $("#sysHealthy").textContent=sources.healthy??"—";
  $("#sysQuarantined").textContent=sources.quarantined??"—";

  $("#invariantGrid").innerHTML=[
    invariant("Presupuesto ≤185.000 €",!!inv.budgetOk,(c.overBudget||0)+" viviendas fuera de presupuesto · máximo visible "+(c.maxVisiblePrice??"—")+" €"),
    invariant("Mínimo 3 habitaciones",!!inv.bedroomsOk,(c.underBedroomMinimum||0)+" incumplimientos visibles"),
    invariant("REJECT nunca visible",!!inv.rejectLeakOk,"SafetyEngine REJECT debe permanecer fuera del catálogo activo")
  ].join("");

  $("#catalogueGrid").innerHTML=[
    metric("Activas",c.active??0),
    metric("Compatibles",c.compatible??0,"SafetyEngine ACCEPT"),
    metric("Por verificar",c.review??0,"SafetyEngine REVIEW"),
    metric("Cuarentena SafetyEngine",c.rejectedQuarantine??0),
    metric("Retiradas",c.withdrawn??0),
    metric("Stale",c.stale??0,"Sin revalidación reciente"),
    metric("Nuevas 24 h",c.new24h??0),
    metric("Precio máximo",c.maxVisiblePrice!=null?Number(c.maxVisiblePrice).toLocaleString("es-ES")+" €":"—")
  ].join("");

  $("#sourceRows").innerHTML=(sources.providers||[]).map(p=>{
    const d=p.discovery||{};
    return '<tr>'+
      '<th>'+esc(p.provider)+'</th>'+
      '<td>'+sourceState(p)+(p.cooldownUntil?'<small>Reintento tras '+esc(fmt(p.cooldownUntil))+'</small>':"")+'</td>'+
      '<td>'+esc(p.discoveredLastRun??0)+'</td>'+
      '<td>'+esc(d.accepted??0)+'</td>'+
      '<td>'+esc(d.error??0)+'</td>'+
      '<td>'+esc(fmt(p.lastRunAt))+'</td>'+
      '<td>'+esc(fmt(p.lastSuccessAt))+'</td>'+
    '</tr>';
  }).join("");

  $("#systemContent").hidden=false;
  $("#systemError").hidden=true;
}

async function load(){
  try{
    const r=await fetch(ENDPOINT,{cache:"no-store",headers:{accept:"application/json"}});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const data=await r.json();
    if(data?.ok===false)throw new Error("status unavailable");
    render(data);
  }catch(e){
    console.error(e);
    $("#systemError").hidden=false;
    $("#systemError").textContent="No se ha podido cargar el estado del sistema. Reintenta en unos minutos.";
  }
}
load();
setInterval(load,60000);
