import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import {extractPrice,priceConfidence} from "../lib/price-validation.mjs";
import {blockReason,badConditionReason,coreValidation,MAX_PRICE} from "../lib/safety-rules.mjs";

function jsonLd(price){
  return [{offers:{price}}];
}

{
  const html=`<main><h1>Casa en Lleida</h1><div>Precio del inmueble: 1.000.000 €</div><div>Impuestos y gastos: 103.785 €</div><div>Importe de la hipoteca: 800.000 €</div></main>`;
  const $=cheerio.load(html);
  const r=extractPrice($("main").text(),jsonLd(1000000),$,"Fotocasa");
  assert.equal(r.price,1000000,"Fotocasa debe usar el precio real de venta");
  assert.equal(r.conflict,false);
  assert.equal(r.confidence,"high");
  assert.ok(r.price>MAX_PRICE,"La casa de 1M debe quedar fuera del presupuesto");
}

{
  const html=`<main><h1>Casa</h1><div>Impuestos y gastos: 103.785 €</div><div>Importe de la hipoteca: 800.000 €</div></main>`;
  const $=cheerio.load(html);
  const r=extractPrice($("main").text(),[],$,"Fotocasa");
  assert.equal(r.price,null,"Fotocasa sin precio verificable no puede inventar el precio");
  assert.equal(r.conflict,true);
  assert.equal(r.confidence,"unknown");
}

{
  const html=`<main><h1>Casa</h1></main>`;
  const $=cheerio.load(html);
  const r=extractPrice($("main").text(),jsonLd(179000),$,"Pisos.com");
  assert.equal(r.price,179000);
  assert.equal(priceConfidence("Pisos.com",r.evidence,r.conflict),"high");
}

assert.equal(blockReason("Inmueble ocupado y sin posesión"),"ocupada");
assert.equal(blockReason("Casa adosada con jardín"),"adosada");
assert.equal(badConditionReason("Vivienda para reformar completamente"),"reforma integral");
assert.deepEqual(coreValidation({price:186000,bedrooms:4,title:"Casa",summary:"",active:true}),["price"]);
assert.deepEqual(coreValidation({price:179000,bedrooms:2,title:"Casa",summary:"",active:true}),["bedrooms"]);
assert.ok(coreValidation({price:179000,bedrooms:4,title:"Casa independiente",summary:"buen estado",active:true}).length===0);

console.log("Regression safety tests: OK");
