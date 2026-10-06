import assert from "node:assert/strict";
import {normalizeCadastralRef,extractExplicitCadastralRef,extractStructuredIdentity,identityPrecision} from "../lib/official-identity.mjs";

assert.equal(normalizeCadastralRef("1234567AB1234C0001DE"),"1234567AB1234C0001DE");
assert.equal(normalizeCadastralRef("1234"),null);
assert.equal(extractExplicitCadastralRef("Referencia catastral: 1234567AB1234C0001DE. Superficie 120 m²"),"1234567AB1234C0001DE");
assert.equal(extractExplicitCadastralRef("Precio 179.000 €. Código anuncio 12345678901234567890"),null);

const id=extractStructuredIdentity([
  {address:{streetAddress:"Carrer Major 12",addressLocality:"Vidreres",addressRegion:"Girona",postalCode:"17411"}}
]);
assert.equal(id.exact,true);
assert.equal(id.streetAddress,"Carrer Major 12");
assert.equal(identityPrecision({cadastralRef:null,address:id,geo:{lat:41.7,lon:2.8},place:"Vidreres"}),"exact_address");
assert.equal(identityPrecision({cadastralRef:"1234567AB1234C0001DE",address:id,geo:null,place:"Vidreres"}),"cadastral");
assert.equal(identityPrecision({cadastralRef:null,address:null,geo:{lat:41.7,lon:2.8},place:"Vidreres"}),"approximate");

console.log("Official identity tests: OK");
