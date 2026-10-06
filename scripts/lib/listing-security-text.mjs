import crypto from "node:crypto";

const LIMITS=Object.freeze({
  title:300,
  metaDescription:4000,
  structuredText:12000,
  bodyText:30000,
  safetyText:48000
});

function clean(value){
  return String(value||"")
    .replace(/\u00a0/g," ")
    .replace(/[\t\r\n]+/g," ")
    .replace(/\s{2,}/g," ")
    .trim();
}

function cap(value,limit){
  return clean(value).slice(0,limit);
}

function uniqueChunks(values){
  const seen=new Set();
  const out=[];
  for(const raw of values){
    const value=clean(raw);
    if(!value)continue;
    const key=value.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function allJsonLd($){
  const items=[];
  $('script[type="application/ld+json"]').each((_,node)=>{
    try{
      const value=JSON.parse($(node).text());
      const walk=current=>{
        if(!current)return;
        if(Array.isArray(current))return current.forEach(walk);
        if(typeof current==="object"){
          items.push(current);
          Object.values(current).forEach(walk);
        }
      };
      walk(value);
    }catch{}
  });
  return items;
}

function structuredSafetyText(items){
  const chunks=[];
  const relevantNameTypes=new Set([
    "House","SingleFamilyResidence","Residence","Product","Offer",
    "RealEstateListing","Accommodation","WebPage"
  ]);

  for(const item of items||[]){
    if(!item||typeof item!=="object")continue;
    for(const key of ["description","headline","itemCondition","availability","category"]){
      const value=item[key];
      if(typeof value==="string"&&clean(value).length>2)chunks.push(value);
    }

    const types=Array.isArray(item["@type"])?item["@type"]:[item["@type"]];
    if(types.some(type=>relevantNameTypes.has(String(type)))&&typeof item.name==="string"&&clean(item.name).length>10){
      chunks.push(item.name);
    }

    if(Array.isArray(item.additionalProperty)){
      for(const prop of item.additionalProperty){
        if(!prop||typeof prop!=="object")continue;
        const name=clean(prop.name);
        const value=clean(prop.value);
        if(name&&value)chunks.push(`${name}: ${value}`);
      }
    }
  }

  return cap(uniqueChunks(chunks).join(" "),LIMITS.structuredText);
}

function centralBodyText($){
  const root=$("main").first().length?$("main").first().clone():$("body").clone();
  root.find([
    "nav","footer","header","aside","script","style","noscript","form","dialog",
    "[role='dialog']",
    "[class*='related' i]","[class*='similar' i]","[class*='recommend' i]",
    "[class*='carousel' i]","[class*='suggest' i]","[class*='cookie' i]",
    "[id*='cookie' i]","[class*='advert' i]","[class*='banner' i]"
  ].join(",")).remove();
  return cap(root.text(),LIMITS.bodyText);
}

export function extractListingSecurityText($,items=allJsonLd($)){
  const title=cap(
    $("h1").first().text()||
    $('meta[property="og:title"]').attr("content")||
    $("title").text(),
    LIMITS.title
  );
  const metaDescription=cap($('meta[name="description"]').attr("content"),LIMITS.metaDescription);
  const structuredText=structuredSafetyText(items);
  const bodyText=centralBodyText($);
  const safetyText=cap(
    uniqueChunks([title,metaDescription,structuredText,bodyText]).join(" "),
    LIMITS.safetyText
  );
  const contentHash=crypto.createHash("sha256").update(safetyText,"utf8").digest("hex");

  return {
    version:1,
    title,
    metaDescription,
    structuredText,
    bodyText,
    safetyText,
    contentHash
  };
}

export function relevantText($,items=allJsonLd($)){
  return extractListingSecurityText($,items).safetyText;
}

export function stripPrivateListingFields(listing){
  if(!listing||typeof listing!=="object")return listing;
  const {securityText,...publicListing}=listing;
  return publicListing;
}
