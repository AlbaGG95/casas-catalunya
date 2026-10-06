import assert from "node:assert/strict";
import {safetyV2Cases,baselineKnownActiveFalsePositives} from "./fixtures/safety-v2-cases.mjs";

assert.ok(safetyV2Cases.length>=10,"Safety baseline needs a meaningful regression corpus");
assert.ok(safetyV2Cases.some(x=>x.expected==="ACCEPT"),"Baseline must contain ACCEPT");
assert.ok(safetyV2Cases.some(x=>x.expected==="REVIEW"),"Baseline must contain REVIEW");
assert.ok(safetyV2Cases.some(x=>x.expected==="REJECT"),"Baseline must contain REJECT");

for(const c of safetyV2Cases){
  assert.ok(c.id&&c.title&&c.text&&c.expected&&c.reason,"Malformed safety fixture: "+JSON.stringify(c));
  assert.ok(["ACCEPT","REVIEW","REJECT"].includes(c.expected),"Invalid expected decision for "+c.id);
}

assert.equal(new Set(safetyV2Cases.map(x=>x.id)).size,safetyV2Cases.length,"Duplicate safety fixture ids");
assert.ok(baselineKnownActiveFalsePositives.length>=10,"Known false-positive baseline unexpectedly small");
assert.equal(new Set(baselineKnownActiveFalsePositives).size,baselineKnownActiveFalsePositives.length,"Duplicate baseline property ids");

console.log("Step 6A baseline fixtures: OK");
