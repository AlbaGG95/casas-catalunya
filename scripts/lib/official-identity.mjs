export function normalizeCadastralRef(raw){
  if(!raw)return null;
  const value=String(raw).toUpperCase().replace(/[^A-Z0-9]/g,"");
  return [14,18,20].includes(value.length)?value:null;
}

export function extractExplicitCadastralRef(text){
  const source=String(text||"");
  const patterns=[
    /refer(?:encia|ència)\s+catastral\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{12,28})/i,
    /ref\.?\s*catastral\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{12,28})/i
  ];
  for(const rx of patterns){
    const m=source.match(rx);
    const value=normalizeCadastralRef(m?.[1]);
    if(value)return value;
  }
  return null;
}

function clean(v){
  return String(v||"").replace(/\s+/g," ").trim();
}

export function extractStructuredIdentity(items){
  let best=null;
  for(const x of items||[]){
    const a=x?.address||x?.location?.address;
    if(!a||typeof a!=="object")continue;
    const street=clean(a.streetAddress);
    const locality=clean(a.addressLocality);
    const region=clean(a.addressRegion);
    const postalCode=clean(a.postalCode);
    if(!street&&!locality&&!postalCode)continue;

    const exactStreet=street&&/\d/.test(street);
    const exactPostal=/^\d{5}$/.test(postalCode);
    const score=(exactStreet?4:street?2:0)+(locality?2:0)+(exactPostal?2:postalCode?1:0)+(region?1:0);
    const candidate={
      streetAddress:street||null,
      locality:locality||null,
      region:region||null,
      postalCode:postalCode||null,
      exact:!!(exactStreet&&locality&&exactPostal),
      score
    };
    if(!best||candidate.score>best.score)best=candidate;
  }
  return best;
}

export function identityPrecision({cadastralRef,address,geo,place}){
  if(cadastralRef)return "cadastral";
  if(address?.exact)return "exact_address";
  if(geo)return "approximate";
  if(place)return "locality";
  return "unknown";
}
