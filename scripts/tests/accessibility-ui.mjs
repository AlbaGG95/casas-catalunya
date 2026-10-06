import assert from "node:assert/strict";
import fs from "node:fs";

const index=fs.readFileSync("index.html","utf8");
const property=fs.readFileSync("property.html","utf8");
const app=fs.readFileSync("app.js","utf8");
const propertyJs=fs.readFileSync("property.js","utf8");
const css=fs.readFileSync("accessibility.css","utf8");

for(const html of [index,property]){
  assert.match(html,/class="skip-link"/,"Skip link required");
  assert.match(html,/href="\/accessibility\.css"/,"Accessibility layer must load");
  assert.match(html,/role="status" aria-live="polite"/,"Live status required");
  assert.match(html,/id="toast"[^>]*role="status"[^>]*aria-live="polite"/,"Toast must be announced");
}

assert.match(index,/id="listingGrid"[^>]*tabindex="-1"/);
assert.match(property,/id="propertyDetail"[^>]*tabindex="-1"/);
assert.match(property,/id="detailError"[^>]*role="alert"/);

assert.match(index,/Recomendadas/);
assert.match(index,/Falta confirmar/);
assert.doesNotMatch(index,/>Compatibles </);
assert.doesNotMatch(index,/>Por verificar </);
assert.match(index,/Cómo usar esta página/);
assert.match(index,/Nivel de información/);

assert.match(index,/data-safety-view="all"[^>]*aria-pressed="true"/);
assert.match(index,/data-safety-view="compatible"[^>]*aria-pressed="false"/);
assert.match(app,/setAttribute\("aria-pressed",selected\?"true":"false"\)/);

assert.match(index,/id="toggleMap"[^>]*aria-expanded="false"[^>]*aria-controls="candidateMap"/);
assert.match(app,/setAttribute\("aria-expanded",mapHidden\?"false":"true"\)/);

assert.match(app,/compareReturnFocus/);
assert.match(app,/requestAnimationFrame\(\(\)=>closeButton\?\.focus\(\)\)/);
assert.match(app,/e\.key!=="Tab"/);
assert.match(app,/compareReturnFocus\?\.focus\?\.\(\)/);

assert.match(css,/:focus-visible/);
assert.match(css,/outline:3px solid var\(--a11y-focus\)/);
assert.match(css,/min-height:44px/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(css,/@media\(prefers-contrast:more\)/);
assert.match(css,/\.detail-side\{order:-1\}/);

assert.match(app,/alt="Foto del anuncio de /);
assert.match(propertyJs,/alt="Foto del anuncio de /);
assert.doesNotMatch(app,/alt="" referrerpolicy/);
assert.doesNotMatch(propertyJs,/alt="" referrerpolicy/);

assert.doesNotMatch(app,/;\\nlet compareReturnFocus/);
assert.match(property,/id="familyOfferAmount"[^>]*max="190000"/);

console.log("Accessible family UI contract: OK");
