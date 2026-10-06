import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import {isDetailUrl,embeddedDetailPatterns} from "../lib/provider-adapters.mjs";

const url="https://www.fotocasa.es/es/comprar/chalets/barcelona-provincia/todas-las-zonas/l?priceMax=185000&bedroomsMin=3";
const response=await fetch(url,{
  headers:{
    "user-agent":"Mozilla/5.0 (compatible; CasasCatalunyaSourceProbe/1.0; +https://github.com/AlbaGG95/casas-catalunya)",
    "accept-language":"es-ES,es;q=.9"
  },
  redirect:"follow"
});
assert.equal(response.status,200,"Fotocasa full catalogue must respond HTTP 200");
const html=await response.text();
assert.match(response.headers.get("content-type")||"",/text\/html/i);

const found=new Set();
const $=cheerio.load(html);
$("a[href]").each((_,a)=>{
  try{
    const u=new URL($(a).attr("href")||"",url).toString();
    if(isDetailUrl("Fotocasa",u))found.add(u);
  }catch{}
});
for(const rx of embeddedDetailPatterns("Fotocasa")){
  for(const m of html.matchAll(rx)){
    const raw=m[0].replace(/\\\//g,"/").replace(/\\u002F/g,"/");
    try{
      const u=new URL(raw,url).toString();
      if(isDetailUrl("Fotocasa",u))found.add(u);
    }catch{}
  }
}
assert.ok(found.size>0,"Fotocasa full catalogue must expose at least one valid detail URL");
console.log(JSON.stringify({ok:true,status:response.status,detailUrls:found.size}));
