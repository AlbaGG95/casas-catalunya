import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {MAX_PRICE as HARD_MAX_PRICE,PREFERRED_PRICE as TARGET_PRICE,MIN_BEDROOMS} from "./search-criteria.js";

const SUPABASE_URL="https://ethtlpnvqyxkoeudtcsj.supabase.co";
const SUPABASE_KEY="sb_publishable_RAi269FvaP67ITZDNLi_bg_O-56BiRu";

const db=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const $=s=>document.querySelector(s);
const euro=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(Number(n)||0);
const fmt=v=>v?new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const safe=u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.toString():""}catch{return""}};
const uuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s||"");
const detail=$("#propertyDetail"),errorBox=$("#detailError"),toastEl=$("#toast");

let property=null;
let familyCode=localStorage.getItem("familyCode")||"";
let familyMemberId=localStorage.getItem("familyMemberId")||"";
let familyMemberName=localStorage.getItem("familyMemberName")||"";
let familyWorkspaceData=null;
let familySaved=false;
let localSaved=new Set(JSON.parse(localStorage.getItem("savedHomes")||"[]"));

function toast(text){
  toastEl.textContent=text;
  toastEl.hidden=false;
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>toastEl.hidden=true,3500);
}

function tag(text,kind=""){return '<span class="tag '+kind+'">'+esc(text)+'</span>'}
function stateRow(label,value,state="pending",hint=""){
  const icon=state==="ok"?"✓":state==="warn"?"⚠":"•";
  return '<div class="detail-check '+state+'"><span class="detail-check-icon">'+icon+'</span><div><strong>'+esc(label)+'</strong><span>'+esc(value)+'</span>'+(hint?'<small>'+esc(hint)+'</small>':"")+'</div></div>';
}
function fact(label,value,hint=""){
  return '<article class="fact"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(hint?'<small>'+esc(hint)+'</small>':"")+'</article>';
}
function confidenceText(v){
  return v==="high"?"Alta":v==="medium"?"Media":v==="low"?"Baja":"Desconocida";
}
function statusText(v){
  return ({
    confirmed:"Confirmado",probable:"Probable",pending:"Pendiente",
    confirmed_free:"Entrega libre indicada",no_signals:"Sin señales detectadas",
    compatible:"Compatible",no_restrictions_detected:"Sin restricciones detectadas",
    claimed_clear:"Anuncio afirma libre de cargas",verified_clear:"Verificado libre de cargas",
    likely:"Probable",verified:"Verificado",
    pending_identity:"Falta identidad precisa",ready_to_check:"Preparado para comprobar",
    checked:"Comprobado",warning:"Revisar",not_found:"Sin coincidencia exacta",
    manual:"Revisión manual",error:"Consulta no disponible"
  })[v]||"Pendiente";
}
function cleanPlace(value){
  let s=String(value||"").replace(/\bCentro Urbano\b/ig,"").replace(/\bCasco Urbano\b/ig,"").replace(/\s+/g," ").trim();
  if(!s)return "";
  if(/casa unifamiliar|urbanitzacions|construcci[oó]n|carrer|calle|avenida|cam[ií]|junio park/i.test(s)&&s.length>35)return "";
  return s;
}

function familyStageLabel(stage){
  return ({
    new:"Nueva",contact:"Contactar",visit_requested:"Visita solicitada",visited:"Visitada",
    negotiating:"Negociando",offer:"Oferta realizada",discarded:"Descartada"
  })[stage]||"Nueva";
}
function familyVerdictLabel(v){
  return ({yes:"Sí",maybe:"Duda",no:"No"})[v]||"Sin veredicto";
}
function toLocalInput(v){
  if(!v)return "";
  const d=new Date(v);
  if(Number.isNaN(d.getTime()))return "";
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}
function updateFamilyConnectionUI(){
  const btn=$("#familyConnectDetail");
  if(!btn)return;
  btn.textContent=familyCode?"✓ Conectada":"Conectar";
  btn.classList.toggle("connected",!!familyCode);
  $("#familyDisconnected").hidden=!!familyCode;
  $("#familyWorkspace").hidden=!familyCode;
  $("#familyMemberLabel").textContent=familyMemberName||"Sin nombre en este dispositivo";
}
function updateFamilyConditionalFields(){
  const stage=$("#familyStage")?.value||"new";
  $("#familyVisitField").hidden=!["visit_requested","visited","negotiating","offer"].includes(stage);
  $("#familyOfferField").hidden=stage!=="offer";
  $("#familyDiscardField").hidden=stage!=="discarded";
}
async function ensureFamilyMember({askName=false}={}){
  if(!familyCode)return false;
  if(!familyMemberId){
    familyMemberId=crypto.randomUUID();
    localStorage.setItem("familyMemberId",familyMemberId);
  }
  if(!familyMemberName&&askName){
    const name=prompt("¿Qué nombre quieres usar para identificar tus votos y notas?");
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
    toast("No se pudo registrar tu perfil familiar.");
    return false;
  }
  updateFamilyConnectionUI();
  return true;
}
function renderFamilyWorkspace(data){
  familyWorkspaceData=data||{status:{stage:"new"},feedback:[]};
  const status=familyWorkspaceData.status||{};
  const feedback=Array.isArray(familyWorkspaceData.feedback)?familyWorkspaceData.feedback:[];

  $("#familyStage").value=status.stage||"new";
  $("#familySharedNotes").value=status.notes||"";
  $("#familyVisitAt").value=toLocalInput(status.visit_at);
  $("#familyOfferAmount").value=status.offer_amount||"";
  $("#familyDiscardReason").value=status.discard_reason||"";
  updateFamilyConditionalFields();

  const mine=feedback.find(x=>x.member_id===familyMemberId);
  $("#familyRating").value=mine?.rating??"";
  $("#familyVerdict").value=mine?.verdict||"";
  $("#familyPersonalNote").value=mine?.note||"";

  const ratings=feedback.map(x=>Number(x.rating)).filter(x=>Number.isFinite(x)&&x>=1&&x<=5);
  const avg=ratings.length?ratings.reduce((a,b)=>a+b,0)/ratings.length:null;
  $("#familyAverage").textContent=avg?avg.toFixed(1)+"/5 · "+ratings.length+" voto"+(ratings.length===1?"":"s"):"Sin votos";

  $("#familyFeedbackList").innerHTML=feedback.length?feedback.map(x=>
    '<article class="family-feedback-item '+(x.member_id===familyMemberId?"mine":"")+'">'+
      '<div><strong>'+esc(x.display_name||"Familia")+'</strong><span>'+esc(x.rating?x.rating+"/5":"Sin nota")+' · '+esc(familyVerdictLabel(x.verdict))+'</span></div>'+
      (x.note?'<p>'+esc(x.note)+'</p>':"")+
      '<small>Actualizado '+fmt(x.updated_at)+'</small>'+
    '</article>'
  ).join(""):'<p class="detail-muted">Todavía no hay opiniones familiares sobre esta vivienda.</p>';

  const activity=Array.isArray(familyWorkspaceData.activity)?familyWorkspaceData.activity:[];
  $("#familyActivityList").innerHTML=activity.length?activity.map(x=>{
    const who=x.display_name||"Familia";
    let message="Actualización familiar";
    if(x.event_type==="status"){
      const from=x.from_stage?familyStageLabel(x.from_stage):null;
      const to=familyStageLabel(x.to_stage);
      message=from&&from!==to?"cambió "+from+" → "+to:"marcó "+to;
    }else if(x.event_type==="feedback"){
      const rating=x.payload?.rating?x.payload.rating+"/5":"sin nota";
      message="actualizó su opinión · "+rating+" · "+familyVerdictLabel(x.payload?.verdict);
    }else if(x.event_type==="feedback_removed"){
      message="borró su opinión";
    }
    return '<article class="family-activity-item"><span class="family-activity-dot"></span><div><strong>'+esc(who)+'</strong><p>'+esc(message)+'</p><small>'+fmt(x.created_at)+'</small></div></article>';
  }).join(""):'<p class="detail-muted">Todavía no hay actividad registrada.</p>';

  $("#familyMemberLabel").textContent=familyMemberName||"Sin nombre en este dispositivo";
  familySaved=!!status.favorite;
  const saveBtn=$("#detailSave");
  if(saveBtn){
    saveBtn.textContent=familySaved?"★ Guardada":"☆ Guardar";
    saveBtn.classList.toggle("saved",familySaved);
  }
}
async function loadFamilyWorkspace({quiet=false}={}){
  updateFamilyConnectionUI();
  if(!familyCode||!property)return false;

  const {data,error}=await db.rpc("family_property_workspace",{
    p_code:familyCode,p_property_id:property.id
  });
  if(error){
    console.error("family_property_workspace",error);
    if(!quiet)toast("No se pudo cargar el espacio familiar.");
    return false;
  }
  renderFamilyWorkspace(data);
  return true;
}
async function connectFamilyDetail(){
  if(familyCode){
    if(confirm("¿Desconectar el espacio familiar en este dispositivo?")){
      familyCode="";
      familyWorkspaceData=null;
      familySaved=false;
      localStorage.removeItem("familyCode");
      updateFamilyConnectionUI();
      await loadSavedState(property);
    }
    return;
  }

  const code=prompt("Introduce el código familiar de Casa Cataluña:");
  if(!code?.trim())return;
  familyCode=code.trim();
  localStorage.setItem("familyCode",familyCode);
  const ok=await loadFamilyWorkspace();
  if(!ok){
    familyCode="";
    localStorage.removeItem("familyCode");
    updateFamilyConnectionUI();
    return;
  }
  await ensureFamilyMember({askName:true});
  await loadFamilyWorkspace({quiet:true});
}
async function renameFamilyMember(){
  if(!familyCode){await connectFamilyDetail();return}
  const name=prompt("Nombre que aparecerá en tus votos y notas:",familyMemberName||"");
  if(!name?.trim())return;
  familyMemberName=name.trim().slice(0,40);
  localStorage.setItem("familyMemberName",familyMemberName);
  await ensureFamilyMember();
  await loadFamilyWorkspace({quiet:true});
}
async function saveFamilyProgress(){
  if(!property||!familyCode){await connectFamilyDetail();if(!familyCode)return}
  if(!await ensureFamilyMember({askName:true}))return;

  const stage=$("#familyStage").value;
  const offerRaw=$("#familyOfferAmount").value.trim();
  const offer=offerRaw?Number(offerRaw):null;
  if(offer!=null&&(!Number.isInteger(offer)||offer<1||offer>HARD_MAX_PRICE)){
    toast("La oferta debe estar entre 1 € y "+euro(HARD_MAX_PRICE)+".");
    return;
  }
  const visitRaw=$("#familyVisitAt").value;
  const visitAt=visitRaw?new Date(visitRaw).toISOString():null;

  $("#familySaveProgress").disabled=true;
  const {data,error}=await db.rpc("family_status_update",{
    p_code:familyCode,
    p_property_id:property.id,
    p_member_id:familyMemberId,
    p_stage:stage,
    p_notes:$("#familySharedNotes").value.trim()||null,
    p_visit_at:visitAt,
    p_offer_amount:offer,
    p_discard_reason:$("#familyDiscardReason").value.trim()||null
  });
  $("#familySaveProgress").disabled=false;
  if(error){
    console.error("family_status_update",error);
    toast("No se pudo guardar el seguimiento familiar.");
    return;
  }
  renderFamilyWorkspace(data);
  toast("Seguimiento familiar actualizado.");
}
async function saveFamilyFeedback(){
  if(!property||!familyCode){await connectFamilyDetail();if(!familyCode)return}
  if(!await ensureFamilyMember({askName:true}))return;

  const ratingRaw=$("#familyRating").value;
  const rating=ratingRaw?Number(ratingRaw):null;
  const verdict=$("#familyVerdict").value||null;
  const note=$("#familyPersonalNote").value.trim()||null;

  $("#familySaveFeedback").disabled=true;
  const {data,error}=await db.rpc("family_feedback_upsert",{
    p_code:familyCode,p_property_id:property.id,p_member_id:familyMemberId,
    p_rating:rating,p_verdict:verdict,p_note:note
  });
  $("#familySaveFeedback").disabled=false;
  if(error){
    console.error("family_feedback_upsert",error);
    toast("No se pudo guardar tu opinión.");
    return;
  }
  renderFamilyWorkspace(data);
  toast("Tu opinión se ha compartido con la familia.");
}
async function deleteFamilyFeedback(){
  if(!property||!familyCode||!familyMemberId)return;
  if(!confirm("¿Borrar tu valoración y comentario de esta vivienda?"))return;
  const {data,error}=await db.rpc("family_feedback_delete",{
    p_code:familyCode,p_property_id:property.id,p_member_id:familyMemberId
  });
  if(error){
    console.error("family_feedback_delete",error);
    toast("No se pudo borrar tu opinión.");
    return;
  }
  renderFamilyWorkspace(data);
  toast("Tu opinión se ha borrado.");
}

function buildScoreBreakdown(p){
  const stored=Array.isArray(p.evidence?.scoreBreakdown)?p.evidence.scoreBreakdown:null;
  if(stored?.length)return stored;

  const parts=[{label:"Base de encaje",points:28}];
  parts.push({label:p.price<=TARGET_PRICE?"Precio ≤180.000 €":"Precio dentro del margen 180–190k",points:p.price<=TARGET_PRICE?12:4});
  parts.push({label:p.bedrooms>=4?"4+ habitaciones":"3 habitaciones",points:p.bedrooms>=4?7:4});
  parts.push({
    label:p.independent_status==="confirmed"?"Independiente confirmada":p.independent_status==="probable"?"Probablemente independiente":"Independencia pendiente",
    points:p.independent_status==="confirmed"?16:p.independent_status==="probable"?11:5
  });
  if(p.condition_status==="confirmed")parts.push({label:"Estado para entrar indicado",points:13});
  parts.push({label:p.occupancy_status==="confirmed_free"?"Entrega libre indicada":"Sin señales de ocupación",points:p.occupancy_status==="confirmed_free"?6:2});
  if(["claimed_clear","verified_clear"].includes(p.registry_status))parts.push({label:p.registry_status==="verified_clear"?"Cargas verificadas":"Anuncio afirma libre de cargas",points:4});
  if(p.fiber_status==="confirmed")parts.push({label:"Fibra mencionada",points:4});
  if(p.services_status==="confirmed")parts.push({label:"Servicios cercanos indicados",points:4});
  if(p.travel_status==="confirmed"&&p.drive_minutes!=null){
    parts.push({label:"Trayecto aproximado "+Math.round(p.drive_minutes)+" min",points:p.drive_minutes<=60?8:p.drive_minutes<=75?5:2});
  }
  if(p.plot_m2>=400)parts.push({label:"Parcela ≥400 m²",points:5});
  if(p.house_m2>=90)parts.push({label:"Vivienda ≥90 m²",points:3});
  if(p.has_garage)parts.push({label:"Garaje",points:2});
  if(p.has_pool)parts.push({label:"Piscina",points:1});
  return parts;
}

function renderScore(p){
  const parts=buildScoreBreakdown(p);
  const total=parts.reduce((s,x)=>s+(Number(x.points)||0),0);
  $("#scoreBreakdown").innerHTML=
    '<div class="score-total"><span>Coincidencia con tu búsqueda</span><strong>'+esc(p.score)+'/100</strong><small>'+parts.length+' criterios revisados</small></div>'+
    '<div class="score-parts">'+parts.map(x=>
      '<div><span>'+esc(x.label)+'</span><strong>+'+esc(x.points)+'</strong></div>'
    ).join("")+'</div>'+
    (total>100?'<p class="detail-muted">La suma bruta supera 100; el score final se limita a 100.</p>':"");
}

function renderEvidence(p){
  const evidence=p.evidence||{};
  const items=[
    ["Precio",p.price_confidence,evidence.price?.evidence||"Información pendiente",euro(p.price)],
    ["Habitaciones",evidence.bedrooms?.confidence||"unknown","Origen del dato",String(p.bedrooms)],
    ["Jardín/parcela",evidence.garden?.confidence||"unknown",evidence.garden?.matched?"Detectado en el anuncio":"Pendiente",""],
    ["Independencia",evidence.independent?.confidence||"unknown",statusText(p.independent_status),""],
    ["Estado",evidence.condition?.confidence||"unknown",statusText(p.condition_status),""],
    ["Ocupación",evidence.occupancy?.confidence||"unknown",statusText(p.occupancy_status),""],
    ["Localidad",evidence.locality?.confidence||"unknown",cleanPlace(p.locality)||"Pendiente",""]
  ];
  $("#evidenceGrid").innerHTML=items.map(([name,conf,description,value])=>
    '<article class="evidence-card '+esc(conf)+'"><div><span>'+esc(name)+'</span><strong>'+esc(confidenceText(conf))+'</strong></div><p>'+esc(description)+'</p>'+(value?'<small>'+esc(value)+'</small>':"")+'</article>'
  ).join("");
}

function renderPriceHistory(p){
  const rows=[...(p.price_history||[])].sort((a,b)=>new Date(a.observed_at)-new Date(b.observed_at));
  const normalized=rows.length?rows:[{price:p.price,observed_at:p.first_seen}];
  const min=Math.min(...normalized.map(x=>Number(x.price))),max=Math.max(...normalized.map(x=>Number(x.price)));
  const range=Math.max(1,max-min);
  const current=Number(p.price);
  const first=Number(normalized[0].price);
  const diff=current-first;
  const change=diff===0?"Sin cambio detectado":(diff<0?"Bajada de ":"Subida de ")+euro(Math.abs(diff));
  $("#priceHistory").innerHTML=
    '<div class="price-history-summary"><strong>'+esc(change)+'</strong><span>Desde '+fmt(normalized[0].observed_at)+'</span></div>'+
    '<div class="price-history-chart">'+normalized.map(x=>{
      const width=25+Math.round(((Number(x.price)-min)/range)*75);
      return '<div class="price-history-row"><span>'+fmt(x.observed_at)+'</span><div><i style="width:'+width+'%"></i></div><strong>'+euro(x.price)+'</strong></div>';
    }).join("")+'</div>';
}

function renderSources(p){
  const sources=[...(p.listing_sources||[])].filter(x=>x.active!==false);
  $("#sourcesList").innerHTML=sources.length?sources.map(s=>{
    const url=safe(s.url);
    return '<article class="source-card"><div><span>'+esc(s.provider||"Fuente")+'</span><strong>'+euro(s.raw_price||p.price)+'</strong></div>'+
      '<p>Precio: '+esc(confidenceText(s.price_confidence))+(s.price_evidence?' · '+esc(s.price_evidence):"")+'</p>'+
      '<small>Visto '+fmt(s.last_seen||s.last_checked)+' · publicado '+fmt(s.published_at)+'</small>'+
      (url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Abrir en '+esc(s.provider||"portal")+' ↗</a>':"")+
      '</article>';
  }).join(""):'<p class="detail-muted">No hay fuentes activas disponibles.</p>';
}

function renderNearbyServices(p){
  const rows=[...(p.nearby_services||[])].sort((a,b)=>(a.distance_m??999999)-(b.distance_m??999999));
  const labels={
    supermarket:"Supermercado / compra",
    pharmacy:"Farmacia",
    health:"Centro sanitario",
    school:"Colegio / instituto",
    fuel:"Gasolinera",
    transport:"Transporte público"
  };
  const order=["supermarket","pharmacy","health","school","fuel","transport"];
  const byCategory=new Map(rows.map(x=>[x.category,x]));
  $("#nearbyServices").innerHTML=order.map(category=>{
    const x=byCategory.get(category);
    if(!x)return '<article class="nearby-card"><span>'+esc(labels[category])+'</span><strong>Pendiente</strong><small>No detectado todavía en el radio de búsqueda.</small></article>';
    const km=x.distance_m<1000?Math.round(x.distance_m)+" m":(x.distance_m/1000).toFixed(1)+" km";
    return '<article class="nearby-card"><span>'+esc(labels[category])+'</span><strong>'+esc(x.name||labels[category])+'</strong><em>'+esc(km)+'</em><small>Distancia aprox. en línea recta · OpenStreetMap</small></article>';
  }).join("");
}

function renderVerification(p){
  const v=Array.isArray(p.verification)?p.verification[0]:(p.verification||{});
  const row=(label,value,okValue="verified")=>stateRow(label,statusText(value),value===okValue||value==="verified_clear"||value==="confirmed_free"?"ok":"pending");
  $("#verificationList").innerHTML=[
    row("Entrega libre",v.possession_status,"confirmed_free"),
    row("Nota simple / cargas",v.registry_check,"verified_clear"),
    row("Cédula de habitabilidad",v.habitability_check),
    row("Urbanismo",v.urbanism_check),
    row("Suministros",v.utilities_check),
    row("Fibra por dirección",v.fiber_check)
  ].join("");
}

function officialState(status){
  if(status==="verified")return "ok";
  if(["warning","error","not_found"].includes(status))return "warn";
  return "pending";
}

function officialTitle(source){
  return ({
    catastro:"Catastro",
    habitability:"Cédula de habitabilidad",
    energy:"Certificado energético",
    urbanism:"Mapa Urbanístico (MUC)",
    flood:"Inundabilidad (ACA)"
  })[source]||source;
}

function renderOfficialChecks(p){
  const checks=[...(p.official_checks||[])];
  const bySource=new Map(checks.map(x=>[x.source,x]));
  const order=["catastro","habitability","energy","urbanism","flood"];
  const cards=order.map(source=>{
    const x=bySource.get(source)||{
      source,status:"pending_identity",
      summary:"Todavía no hay una comprobación oficial disponible.",
      official_url:null,evidence:{}
    };
    const url=safe(x.official_url);
    const grades=x.source==="energy"&&x.evidence?.grades
      ? Object.entries(x.evidence.grades).filter(([,v])=>v).map(([k,v])=>(k==="emissions"?"Emisiones":"Energía")+": "+v).join(" · ")
      : "";
    return '<article class="official-card '+officialState(x.status)+'">'+
      '<div class="official-card-head"><div><span>'+esc(officialTitle(source))+'</span><strong>'+esc(statusText(x.status))+'</strong></div><span class="official-dot"></span></div>'+
      '<p>'+esc(x.summary||"")+'</p>'+
      (grades?'<small class="official-extra">'+esc(grades)+'</small>':"")+
      (x.checked_at?'<small>Comprobado '+fmt(x.checked_at)+'</small>':"")+
      (url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Abrir fuente oficial ↗</a>':"")+
      '</article>';
  }).join("");

  const identity=[];
  if(p.cadastral_ref)identity.push('<span><b>Referencia catastral</b> '+esc(p.cadastral_ref)+'</span>');
  if(p.address_text)identity.push('<span><b>Dirección detectada</b> '+esc(p.address_text)+(p.postal_code?' · '+esc(p.postal_code):"")+'</span>');
  identity.push('<span><b>Precisión</b> '+esc(({
    cadastral:"Referencia catastral",
    exact_address:"Dirección estructurada",
    approximate:"Ubicación aproximada",
    locality:"Solo localidad",
    unknown:"No determinada"
  })[p.location_precision]||"No determinada")+'</span>');
  $("#officialIdentity").innerHTML=identity.join("");
  $("#officialChecks").innerHTML=cards;
}

function renderChecklist(p){
  const withinBudget=Number(p.price)<=HARD_MAX_PRICE;
  const underTarget=Number(p.price)<=TARGET_PRICE;
  const rows=[
    stateRow("Presupuesto",underTarget?"Dentro del objetivo ≤180.000 €":"Dentro del margen máximo ≤190.000 €",withinBudget?"ok":"warn"),
    stateRow("Habitaciones",p.bedrooms+" habitaciones",p.bedrooms>=3?"ok":"warn"),
    stateRow("Jardín/parcela",statusText(p.garden_status),p.garden_status==="confirmed"?"ok":"pending"),
    stateRow("Independencia",statusText(p.independent_status),p.independent_status==="confirmed"?"ok":"pending"),
    stateRow("Estado de la vivienda",statusText(p.condition_status),p.condition_status==="confirmed"?"ok":"pending"),
    stateRow("Ocupación",statusText(p.occupancy_status),p.occupancy_status==="confirmed_free"?"ok":"pending"),
    stateRow("Financiación",statusText(p.financing_status),p.financing_status==="compatible"?"ok":"pending"),
    stateRow("Cargas registrales",statusText(p.registry_status),p.registry_status==="verified_clear"?"ok":"pending"),
    stateRow("Trayecto desde 08032",p.drive_minutes!=null?Math.round(p.drive_minutes)+" min aprox.":"Pendiente",p.travel_status==="confirmed"?"ok":"pending"),
    stateRow("Fibra",statusText(p.fiber_status),p.fiber_status==="confirmed"?"ok":"pending"),
    stateRow("Servicios cercanos",statusText(p.services_status),p.services_status==="confirmed"?"ok":"pending")
  ];
  $("#purchaseChecklist").innerHTML=rows.join("");
}

function renderFacts(p){
  $("#factsGrid").innerHTML=[
    fact("Precio",euro(p.price),p.price<=TARGET_PRICE?"Dentro del objetivo":"Margen excepcional"),
    fact("Habitaciones",String(p.bedrooms)),
    fact("Baños",p.bathrooms!=null?String(p.bathrooms):"Pendiente"),
    fact("Vivienda",p.house_m2?String(p.house_m2)+" m²":"Pendiente"),
    fact("Parcela",p.plot_m2?String(p.plot_m2)+" m²":"Pendiente"),
    fact("Trayecto",p.drive_minutes!=null?Math.round(p.drive_minutes)+" min":"Pendiente","aprox. desde 08032"),
    fact("Garaje",p.has_garage?"Sí":"No detectado"),
    fact("Piscina",p.has_pool?"Sí":"No detectada"),
    fact("Ref. catastral",p.cadastral_ref||"Pendiente",p.cadastral_ref?"Detectada en el anuncio":"No se inventa"),
    fact("Dirección",p.address_text||"Pendiente",p.postal_code||""),
    fact("Publicación",p.published_at?fmt(p.published_at):"Fecha desconocida"),
    fact("Detectada",fmt(p.first_seen))
  ].join("");
}

async function loadSavedState(p){
  const btn=$("#detailSave");
  if(familyCode){
    const {data,error}=await db.rpc("family_status_list",{p_code:familyCode});
    if(!error){
      familySaved=(data||[]).some(x=>x.property_id===p.id&&x.favorite);
      btn.textContent=familySaved?"★ Guardada":"☆ Guardar";
      btn.classList.toggle("saved",familySaved);
      return;
    }
  }
  const saved=localSaved.has(p.fingerprint||p.id);
  btn.textContent=saved?"★ Guardada":"☆ Guardar";
  btn.classList.toggle("saved",saved);
}

async function toggleSaved(){
  if(!property)return;
  const btn=$("#detailSave");
  if(familyCode){
    const next=!familySaved;
    btn.disabled=true;
    const {error}=await db.rpc("family_toggle_favorite",{p_code:familyCode,p_property_id:property.id,p_favorite:next});
    btn.disabled=false;
    if(error){toast("No se pudo sincronizar el favorito familiar.");return}
    familySaved=next;
    btn.textContent=next?"★ Guardada":"☆ Guardar";
    btn.classList.toggle("saved",next);
    toast(next?"Guardada para la familia":"Eliminada de favoritos");
    await loadFamilyWorkspace({quiet:true});
    return;
  }
  const key=property.fingerprint||property.id;
  localSaved.has(key)?localSaved.delete(key):localSaved.add(key);
  localStorage.setItem("savedHomes",JSON.stringify([...localSaved]));
  const saved=localSaved.has(key);
  btn.textContent=saved?"★ Guardada":"☆ Guardar";
  btn.classList.toggle("saved",saved);
}

function render(p){
  property=p;
  document.title=(p.title||"Vivienda")+" · Casa Cataluña";
  $("#detailUpdatedAt").textContent="Revisada "+fmt(p.last_checked||p.last_seen);
  $("#detailPrice").textContent=euro(p.price);
  $("#detailTitle").textContent=p.title||"Vivienda candidata";
  $("#detailPlace").textContent=(cleanPlace(p.locality)||"Localidad por confirmar")+" · "+(p.province||"Cataluña");
  $("#detailDescription").textContent=p.summary||"Sin descripción resumida disponible.";

  const tags=[];
  tags.push(p.status==="verified"?tag("Documentación verificada","verified"):tag("Candidata","candidate"));
  tags.push(tag("Precio "+confidenceText(p.price_confidence),p.price_confidence==="high"?"verified":p.price_confidence==="medium"?"candidate":"pending"));
  if(p.price>TARGET_PRICE)tags.push(tag("Margen 180–190k","stretch"));
  if(p.registry_status!=="verified_clear")tags.push(tag("Nota simple pendiente","pending"));
  $("#detailTags").innerHTML=tags.join("");

  const image=safe(p.image_url)||(p.listing_sources||[]).map(x=>safe(x.image_url)).find(Boolean);
  $("#detailMedia").innerHTML=image?'<img src="'+esc(image)+'" alt="Foto del anuncio de '+esc(p.title||"la vivienda")+'" referrerpolicy="no-referrer">':'<div class="detail-photo-fallback">Foto disponible en el anuncio original</div>';

  const source=(p.listing_sources||[]).find(x=>x.active!==false&&safe(x.url));
  if(source){
    $("#primarySourceLink").href=safe(source.url);
    $("#primarySourceLink").hidden=false;
  }else{
    $("#primarySourceLink").hidden=true;
  }

  $("#fitScore").textContent=(Number(p.score)||0)+"/100";
  $("#confidenceScore").textContent=(Number(p.confidence_score)||0)+"/100";
  $("#confidenceLabel").textContent=confidenceText(p.data_confidence);
  $("#verifiedAt").textContent=p.last_verified_at?fmt(p.last_verified_at):"Pendiente";

  renderFacts(p);
  renderScore(p);
  renderEvidence(p);
  renderOfficialChecks(p);
  renderNearbyServices(p);
  renderPriceHistory(p);
  renderSources(p);
  renderChecklist(p);
  renderVerification(p);
  loadSavedState(p);
  updateFamilyConnectionUI();

  detail.hidden=false;
  errorBox.hidden=true;
}

async function load(){
  const id=new URLSearchParams(location.search).get("id")||"";
  if(!uuid(id)){
    errorBox.hidden=false;
    errorBox.textContent="La ficha solicitada no es válida.";
    return;
  }

  const {data,error}=await db.from("properties")
    .select(`
      *,
      listing_sources(
        provider,url,raw_title,raw_price,image_url,published_at,last_seen,last_checked,active,
        metadata,price_evidence,price_confidence,data_confidence,evidence
      ),
      price_history(price,observed_at),
      verification(
        possession_status,registry_check,habitability_check,urbanism_check,utilities_check,fiber_check,notes,updated_at
      ),
      official_checks(
        source,status,summary,official_url,evidence,checked_at,updated_at
      ),
      nearby_services(
        category,name,distance_m,latitude,longitude,checked_at
      )
    `)
    .eq("id",id)
    .in("status",["candidate","verified"])
    .lte("price",HARD_MAX_PRICE)
    .gte("bedrooms",MIN_BEDROOMS)
    .maybeSingle();

  if(error){
    console.error(error);
    errorBox.hidden=false;
    errorBox.textContent="No se ha podido cargar esta vivienda.";
    return;
  }
  if(!data){
    errorBox.hidden=false;
    errorBox.textContent="Esta vivienda ya no está disponible como candidata o no cumple los filtros actuales.";
    return;
  }

  render(data);
  if(familyCode){
    const ok=await loadFamilyWorkspace({quiet:true});
    if(!ok){
      familyCode="";
      familyWorkspaceData=null;
      familySaved=false;
      localStorage.removeItem("familyCode");
      updateFamilyConnectionUI();
      await loadSavedState(data);
    }
  }
}

$("#detailSave").addEventListener("click",toggleSaved);
$("#familyConnectDetail")?.addEventListener("click",connectFamilyDetail);
$("#familyRenameMember")?.addEventListener("click",renameFamilyMember);
$("#familyStage")?.addEventListener("change",updateFamilyConditionalFields);
$("#familySaveProgress")?.addEventListener("click",saveFamilyProgress);
$("#familySaveFeedback")?.addEventListener("click",saveFamilyFeedback);
$("#familyDeleteFeedback")?.addEventListener("click",deleteFamilyFeedback);

updateFamilyConnectionUI();
load();
setInterval(()=>{if(familyCode&&property)loadFamilyWorkspace({quiet:true})},15000);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
}
