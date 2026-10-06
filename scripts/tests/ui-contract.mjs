import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("index.html","utf8");
const required=[
  "searchInput","provinceFilter","budgetFilter","statusFilter","sortFilter",
  "bedroomFilter","driveFilter","confidenceFilter","extraFilter",
  "visibleCount","newCount","under180Count","savedCount","lastScan","sourceHealth",
  "candidateMap","toggleMap","mapMeta","listingGrid","emptyState","loadMore",
  "familyButton","alertButton","compareDock","compareCount","openCompare","clearCompare",
  "compareModal","compareTableWrap","toast"
];
for(const id of required){
  assert.ok(html.includes(`id="${id}"`)||html.includes(`id='${id}'`),"Missing UI contract id: "+id);
}
assert.match(html,/ui-v2\.css/,"Frontend v2 stylesheet must be loaded");
assert.doesNotMatch(html,/class="checks"/,"Technical checklist should not clutter the home screen");
console.log("Frontend v2 DOM contract: OK");

assert.match(app,/h\.safetyDecision==="ACCEPT"/,"Public results must fail closed unless safety is ACCEPT");
assert.match(app,/h\.conditionStatus==="confirmed"/,"Public results must require confirmed ready-to-live condition");
assert.doesNotMatch(app,/h\.safetyDecision!==["']REJECT["']/,"REVIEW/unknown safety must never be visible by default");
