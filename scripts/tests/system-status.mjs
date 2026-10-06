import assert from "node:assert/strict";
import fs from "node:fs";

const html=fs.readFileSync("system.html","utf8");
const js=fs.readFileSync("system.js","utf8");
const edge=fs.readFileSync("supabase/functions/system-status/index.ts","utf8");

for(const id of ["systemContent","systemError","sysActive","sysCompatible","sysReview","sysNew24","sysHealthy","sysQuarantined","invariantGrid","catalogueGrid","sourceRows"]){
  assert.ok(html.includes(`id="${id}"`),"Missing system UI id: "+id);
}
assert.match(js,/functions\/v1\/system-status/);
assert.doesNotMatch(edge,/family_/i,"System status endpoint must not read family tables");
assert.doesNotMatch(edge,/title,summary|url,canonical_url|raw_payload/i,"System status endpoint must not return listing content or URLs");
assert.match(edge,/overBudget/);
assert.match(edge,/rejectLeakOk/);

console.log("System observability privacy contract: OK");
