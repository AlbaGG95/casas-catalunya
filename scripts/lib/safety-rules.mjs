export const MAX_PRICE=185000;
export const MIN_BEDROOMS=3;
export const MAX_DRIVE_MINUTES=90;

export const BLOCK_PATTERNS=[
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
  ["rústica",/(?:finca|casa|mas[ií]a)\s+r[uú]stica|suelo\s+r[uú]stico|terreno\s+r[uú]stico/i],
  ["uso no habitual",/no\s+es\s+posible\s+como\s+vivienda\s+habitual|uso\s+temporal/i],
  ["sin servicios",/sin\s+alcantarillado|sin\s+agua\s+de\s+red|sin\s+luz\s+de\s+red|sin\s+suministros/i],
  ["en rentabilidad",/en\s+rentabilidad|contrato\s+de\s+arrendamiento|arrendatario/i],
  ["tanteo/retracto",/derecho\s+de\s+tanteo\s+y\s+retracto|decreto\s+ley\s+1\/2015/i],
  ["restricción hipotecaria",/impedimento\s+para\s+obtener\s+financiaci[oó]n\s+hipotecaria|condiciones\s+del\s+inmueble\s+pueden\s+suponer\s+un\s+impedimento/i],
  ["situación especial",/en\s+situaci[oó]n\s+especial/i]
];

export const BAD_CONDITION=[
  ["reforma integral",/reforma\s+integral|para\s+reformar|a\s+reformar|necesita\s+reforma|requiere\s+reforma/i],
  ["estado de origen deteriorado",/(?:estado\s+de\s+origen|de\s+origen)[^.!?]{0,80}(?:requiere|necesita|reforma|actualizar)|para\s+actualizar/i],
  ["ruina/derribo",/\bruina\b|para\s+derribar|derribo|estado\s+ruinoso/i],
  ["sin terminar",/sin\s+terminar|obra\s+inacabada|obra\s+parada|por\s+terminar|a\s+medio\s+construir|medio\s+construida/i],
  ["mal estado",/mal\s+estado|muy\s+deteriorad|inhabitable|precisa\s+reformas\s+importantes|parcialmente\s+rehabilitad/i]
];

export function blockReason(text){
  for(const [reason,rx] of BLOCK_PATTERNS)if(rx.test(String(text||"")))return reason;
  return null;
}

export function badConditionReason(text){
  for(const [reason,rx] of BAD_CONDITION)if(rx.test(String(text||"")))return reason;
  return null;
}

export function coreValidation(listing){
  const reasons=[];
  const price=Number(listing?.price);
  const bedrooms=Number(listing?.bedrooms);
  const text=`${listing?.title||""} ${listing?.summary||""}`;
  if(!Number.isInteger(price)||price<1||price>MAX_PRICE)reasons.push("price");
  if(!Number.isInteger(bedrooms)||bedrooms<MIN_BEDROOMS||bedrooms>20)reasons.push("bedrooms");
  if(listing?.active===false)reasons.push("inactive");
  const blocked=blockReason(text);if(blocked)reasons.push(blocked);
  const bad=badConditionReason(text);if(bad)reasons.push(bad);
  if(listing?.travelStatus==="too_far"||Number(listing?.driveMinutes)>MAX_DRIVE_MINUTES)reasons.push("too_far");
  return reasons;
}
