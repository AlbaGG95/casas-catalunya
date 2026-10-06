import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("index.html","utf8");
const app=fs.readFileSync("app.js","utf8");

for(const id of ["allSafetyCount","compatibleCount","reviewCount"]){
  assert.ok(html.includes(`id="${id}"`),"Missing safety category count: "+id);
}
for(const value of ["all","compatible","review"]){
  assert.ok(html.includes(`data-safety-view="${value}"`),"Missing safety view: "+value);
}
assert.match(app,/safetyDecision:row\.safety_decision\|\|"REVIEW"/);
assert.match(app,/h\.safetyDecision!=="REJECT"/,"Frontend must defensively reject SafetyEngine REJECT rows");
assert.match(app,/safetyView==="compatible"/);
assert.match(app,/safetyView==="review"/);
assert.match(app,/h\.safetyDecision==="ACCEPT"/);
assert.match(app,/h\.safetyDecision==="REVIEW"/);

console.log("Compatible/review UI contract: OK");
