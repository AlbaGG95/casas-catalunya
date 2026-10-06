export const SAFETY_DECISIONS=Object.freeze({
  ACCEPT:"ACCEPT",
  REVIEW:"REVIEW",
  REJECT:"REJECT"
});

export const HARD_REJECT_RULES=[
  {code:"occupied",reason:"ocupada",rx:/inmueble\s+actualmente\s+ocupad[oa]|vivienda\s+actualmente\s+ocupad[oa]|\bocupad[oa]s?\b|ocupad[oa](?=descubre|casa|vivienda|inmueble)|ocupaci[oó]n\s+ilegal|okupad[oa]/i},
  {code:"no_possession",reason:"sin posesión",rx:/sin\s+posesi[oó]n|sin\s+acceso\s+al\s+interior|situaci[oó]n\s+posesoria/i},
  {code:"tenanted",reason:"inquilinos/alquilada",rx:/\binquilin[oa]s?\b|con\s+arrendatari|arrendamiento\s+vigente|\balquilad[ao]s?\b|\barrendad[ao]s?\b|en\s+rentabilidad|contrato\s+de\s+arrendamiento/i},
  {code:"not_visitable",reason:"no visitable",rx:/no\s+(?:se\s+puede\s+)?visitar|no\s+visitable|sin\s+posibilidad\s+de\s+visita/i},
  {code:"bare_ownership",reason:"nuda propiedad",rx:/nuda\s+propiedad/i},
  {code:"proindiviso",reason:"proindiviso",rx:/proindiviso|pro-indiviso|participaci[oó]n\s+indivisa/i},
  {code:"auction_or_debt",reason:"subasta/cesión",rx:/\bsubasta\b|cesi[oó]n\s+de\s+remate|ejecuci[oó]n\s+hipotecaria|venta\s+de\s+deuda|cesi[oó]n\s+de\s+cr[eé]dito/i},
  {code:"investors_only",reason:"solo inversores",rx:/s[oó]lo\s+(?:para\s+)?inversores|especial\s+inversores/i},
  {code:"non_mortgageable",reason:"no hipotecable",rx:/no\s+hipotecable|no\s+admite\s+hipoteca|no\s+es\s+viable\s+la\s+financiaci[oó]n|requiere\s+fondos\s+propios|impedimento\s+para\s+obtener\s+financiaci[oó]n\s+hipotecaria/i},
  {code:"restricted_housing",reason:"vpo/restricción",rx:/vivienda\s+de\s+protecci[oó]n\s+oficial|\bVPO\b/i},
  {code:"charges",reason:"cargas indicadas",rx:/con\s+cargas\s+registrales|cargas\s+pendientes|gravamen\s+pendiente/i},
  {code:"no_habitability",reason:"sin cédula",rx:/sin\s+c[eé]dula(?:\s+de\s+habitabilidad)?/i},
  {code:"attached_terraced",reason:"adosada",rx:/\badosad[ao]s?\b|casa\s+adosada/i},
  {code:"attached_semi",reason:"pareada",rx:/\bparead[ao]s?\b|casa\s+pareada/i},
  {code:"attached_party_wall",reason:"entre medianeras",rx:/entre\s+medianeras|casa\s+medianera/i},
  {code:"rustic",reason:"rústica",rx:/(?:finca|casa|mas[ií]a|parcela)\s+r[uú]stica|suelo\s+r[uú]stico|terreno\s+r[uú]stico/i},
  {code:"camping_bungalow",reason:"camping/bungalow",rx:/\bbungalow\b|\bcamping\b|mobil[ -]?home|mobile[ -]?home/i},
  {code:"non_habitual_use",reason:"uso no habitual",rx:/no\s+es\s+posible\s+como\s+vivienda\s+habitual|uso\s+temporal/i},
  {code:"missing_services",reason:"sin servicios básicos",rx:/sin\s+alcantarillado|sin\s+agua\s+de\s+red|sin\s+luz\s+de\s+red|sin\s+suministros/i},
  {code:"preemption",reason:"tanteo/retracto",rx:/derecho\s+de\s+tanteo\s+y\s+retracto|decreto\s+ley\s+1\/2015/i},
  {code:"special_situation",reason:"situación especial",rx:/en\s+situaci[oó]n\s+especial/i}
];

export const CONDITION_REJECT_RULES=[
  {code:"unfinished_construction",reason:"obra/construcción sin terminar",rx:/obra\s+nueva\s+en\s+construcci[oó]n|(?:casa|vivienda|inmueble|obra)\s+(?:en|en\s+proceso\s+de)\s+construcci[oó]n|proceso\s+de\s+construcci[oó]n|inscrit[ao][^.!?]{0,60}en\s+construcci[oó]n|para\s+terminar|pendiente\s+de\s+terminar|falta\s+(?:la\s+)?finalizaci[oó]n|estructura\s+(?:ya\s+)?construida|obra\s+inacabada|obra\s+parada|sin\s+terminar|a\s+medio\s+construir|medio\s+construid[ao]/i},
  {code:"major_renovation",reason:"reforma importante",rx:/reforma\s+integral|para\s+reformar|a\s+reformar|necesita\s+reforma(?:\s+integral|s\s+importantes?)?|requiere\s+reforma(?:\s+integral|s\s+importantes?)?|precisa\s+reformas\s+importantes|reformas\s+importantes/i},
  {code:"ruin_or_uninhabitable",reason:"ruina/mal estado",rx:/\bruina\b|para\s+derribar|derribo|estado\s+ruinoso|inhabitable|muy\s+deteriorad[ao]|\bmal\s+estado\b/i}
];

export const CONDITION_REVIEW_RULES=[
  {code:"needs_improvements",reason:"necesita mejoras",rx:/necesita\s+mejoras?|requiere\s+mejoras?|precisa\s+mejoras?/i},
  {code:"semi_renovated",reason:"semireformada",rx:/semi\s*-?\s*reformad[ao]/i},
  {code:"needs_updating",reason:"para actualizar",rx:/para\s+actualizar|a\s+actualizar|por\s+actualizar|necesita\s+actualizaci[oó]n/i},
  {code:"partial_renovation",reason:"reforma parcial",rx:/reforma\s+parcial|parcialmente\s+reformad[ao]|parcialmente\s+rehabilitad[ao]/i},
  {code:"original_condition",reason:"estado de origen",rx:/(?:estado\s+de\s+origen|de\s+origen)(?![^.!?]{0,60}(?:impecable|excelente|muy\s+buen\s+estado))/i}
];

export const READY_RULES=[
  {code:"ready_to_move",reason:"para entrar a vivir",rx:/para\s+entrar\s+a\s+vivir|list[oa]\s+para\s+entrar(?:\s+a\s+vivir)?/i},
  {code:"excellent_condition",reason:"muy buen/excelente estado",rx:/muy\s+buen\s+estado|excelente\s+estado|perfecto\s+estado|estado\s+impecable|\bimpecable\b/i},
  {code:"recently_renovated",reason:"reformada recientemente",rx:/totalmente\s+reformad[ao]|reformad[ao]\s+integralmente|reformad[ao]\s+(?:por\s+completo|completamente|recientemente)|reci[eé]n\s+reformad[ao]/i},
  {code:"good_condition",reason:"buen estado",rx:/\ben\s+buen\s+estado\b|estado\s*:\s*bien/i},
  {code:"brand_new_finished",reason:"a estrenar/obra nueva terminada",rx:/\ba\s+estrenar\b|obra\s+nueva\s+(?:terminada|finalizada|lista\s+para\s+entrar)/i}
];

function firstMatch(text,rules){
  const value=String(text||"");
  for(const rule of rules){
    const match=value.match(rule.rx);
    if(match)return {...rule,match:match[0]};
  }
  return null;
}

export function evaluateSafetyText(text,{partial=false}={}){
  const value=String(text||"");

  const hard=firstMatch(value,HARD_REJECT_RULES);
  if(hard){
    return {decision:SAFETY_DECISIONS.REJECT,reason:hard.reason,code:hard.code,evidence:hard.match};
  }

  const conditionReject=firstMatch(value,CONDITION_REJECT_RULES);
  if(conditionReject){
    return {decision:SAFETY_DECISIONS.REJECT,reason:conditionReject.reason,code:conditionReject.code,evidence:conditionReject.match};
  }

  const conditionReview=firstMatch(value,CONDITION_REVIEW_RULES);
  if(conditionReview){
    return {decision:SAFETY_DECISIONS.REVIEW,reason:conditionReview.reason,code:conditionReview.code,evidence:conditionReview.match};
  }

  const ready=firstMatch(value,READY_RULES);
  if(ready){
    return {decision:SAFETY_DECISIONS.ACCEPT,reason:ready.reason,code:ready.code,evidence:ready.match};
  }

  return {
    decision:SAFETY_DECISIONS.REVIEW,
    reason:partial?"sin señal negativa en texto parcial":"estado para entrar no confirmado",
    code:partial?"partial_unknown":"condition_unknown",
    evidence:null
  };
}

export function isSafetyReject(text){
  return evaluateSafetyText(text).decision===SAFETY_DECISIONS.REJECT;
}
