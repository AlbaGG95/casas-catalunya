import assert from "node:assert/strict";
import {isDetailUrl,embeddedDetailPatterns,supportedProviders} from "../lib/provider-adapters.mjs";

const cases=[
  ["Fotocasa","https://www.fotocasa.es/es/comprar/vivienda/barcelona/190785132/d",true],
  ["Habitaclia","https://www.habitaclia.com/comprar-casa-girona/d",false],
  ["Habitaclia","https://www.habitaclia.com/comprar/casa/girona/abcdef/d",true],
  ["Pisos.com","https://www.pisos.com/comprar/casa-tordera-123456789/",true],
  ["Pisos.com","https://www.pisos.com/venta/casas-barcelona/",false],
  ["Yaencontre","https://www.yaencontre.com/venta/casa/inmueble-59329-112657066",true],
  ["Servihabitat","https://www.servihabitat.com/es/venta/vivienda-casa/barcelona-altpenedes-mediona/60524491",true],
  ["Idealista","https://www.idealista.com/inmueble/112709688/",true],
  ["Indomio","https://www.indomio.es/anuncios/123456789/",true],
  ["Indomio","https://www.indomio.es/venta-case/barcelona-provincia/",false]
];

for(const [provider,url,expected] of cases){
  assert.equal(isDetailUrl(provider,url),expected,provider+" "+url);
}

assert.ok(supportedProviders().includes("Indomio"));
assert.ok(embeddedDetailPatterns("Indomio").some(rx=>rx.test("/anuncios/123456789/")));
assert.equal(new Set(supportedProviders()).size,7);

console.log("Provider adapter tests: OK");
