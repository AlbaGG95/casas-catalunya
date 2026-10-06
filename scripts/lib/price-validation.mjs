export function firstNumber(v){
  if(v==null)return null;
  const raw=String(v).replace(/[^0-9.,]/g,"");
  const n=Number(raw.replace(/\./g,"").replace(",","."));
  return Number.isFinite(n)&&n>0?n:null;
}

export function parseEuro(raw){
  if(!raw)return null;
  const n=Number(String(raw).replace(/[^0-9]/g,""));
  return Number.isFinite(n)&&n>=10000&&n<=5000000?n:null;
}

function structuredPrices(items){
  const out=[];
  for(const x of items||[]){
    for(const p of [x?.offers?.price,x?.price,x?.offers?.lowPrice]){
      const n=firstNumber(p);
      if(n&&n>=10000&&n<=5000000)out.push(Math.round(n));
    }
  }
  return [...new Set(out)];
}

function labeledPropertyPrice(text){
  const patterns=[
    /precio\s+del\s+inmueble\s*:?\s*(\d{1,3}(?:[.\s]\d{3})+|\d{5,7})\s*€/i,
    /precio\s+de\s+venta\s*:?\s*(\d{1,3}(?:[.\s]\d{3})+|\d{5,7})\s*€/i
  ];
  for(const rx of patterns){
    const m=String(text||"").match(rx);
    const n=parseEuro(m?.[1]);
    if(n)return n;
  }
  return null;
}

function extractProminentPrice($){
  const candidates=[];
  const selectors=['h1','[data-testid*="price" i]','[class*="price" i]','[class*="precio" i]','main','article'];
  for(const sel of selectors){
    const node=$(sel).first();
    if(!node.length)continue;
    const raw=sel==="h1"?node.parent().text():node.text();
    const txt=String(raw||"").replace(/\s+/g," ").trim().slice(0,3500);
    for(const m of txt.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d{5,7})\s*€/g)){
      const n=parseEuro(m[1]);
      if(n)candidates.push(n);
      if(candidates.length>=8)break;
    }
    if(candidates.length)break;
  }
  return candidates[0]||null;
}

export function priceConfidence(provider,evidence,conflict=false){
  if(conflict||!evidence||evidence==="none")return "unknown";
  if(provider==="Fotocasa"){
    if(["fotocasa_labeled_property_price","structured_consensus"].includes(evidence))return "high";
    if(evidence==="structured")return "medium";
    return "low";
  }
  if(["labeled","structured","structured_consensus"].includes(evidence))return "high";
  if(evidence==="prominent")return "medium";
  if(evidence==="generic")return "low";
  return "unknown";
}

export function extractPrice(text,items,$,provider){
  const labeled=labeledPropertyPrice(text);
  const structured=structuredPrices(items);

  if(provider==="Fotocasa"){
    if(labeled){
      const disagree=structured.find(n=>Math.abs(n-labeled)/Math.max(n,labeled)>.08);
      const result={price:labeled,conflict:!!disagree,evidence:"fotocasa_labeled_property_price"};
      return {...result,confidence:priceConfidence(provider,result.evidence,result.conflict)};
    }
    if(structured.length===1){
      const result={price:structured[0],conflict:false,evidence:"structured"};
      return {...result,confidence:priceConfidence(provider,result.evidence,false)};
    }
    if(structured.length>1){
      const min=Math.min(...structured),max=Math.max(...structured);
      if(max/min>1.08)return {price:null,conflict:true,evidence:"structured_conflict",confidence:"unknown"};
      const result={price:Math.round(structured.reduce((a,b)=>a+b,0)/structured.length),conflict:false,evidence:"structured_consensus"};
      return {...result,confidence:priceConfidence(provider,result.evidence,false)};
    }
    return {price:null,conflict:true,evidence:"fotocasa_unverified_price",confidence:"unknown"};
  }

  if(labeled){
    const result={price:labeled,conflict:false,evidence:"labeled"};
    return {...result,confidence:priceConfidence(provider,result.evidence,false)};
  }
  if(structured.length){
    const result={price:structured[0],conflict:false,evidence:"structured"};
    return {...result,confidence:priceConfidence(provider,result.evidence,false)};
  }

  const prominent=extractProminentPrice($);
  if(prominent){
    const result={price:prominent,conflict:false,evidence:"prominent"};
    return {...result,confidence:priceConfidence(provider,result.evidence,false)};
  }

  const m=String(text||"").match(/(?:precio[^0-9]{0,20})?(\d{1,3}(?:[.\s]\d{3})+|\d{5,7})\s*€/i);
  const fallback=parseEuro(m?.[1]);
  const result={price:fallback,conflict:false,evidence:fallback?"generic":"none"};
  return {...result,confidence:priceConfidence(provider,result.evidence,false)};
}
