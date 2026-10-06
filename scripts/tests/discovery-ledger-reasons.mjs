import assert from "node:assert/strict";
import fs from "node:fs";

const edge=fs.readFileSync("supabase/functions/discovery-plan/index.ts","utf8");

assert.match(
  edge,
  /last_error:outcome==="accepted"\?null:String\(x\?\.reason\|\|\(outcome==="error"\?"detail_error":"rejected"\)\)\.slice\(0,500\)/,
  "Rejected discovery outcomes must preserve their reason in the ledger"
);

assert.match(
  edge,
  /const outcome=\["accepted","rejected","error"\]\.includes\(x\?\.outcome\)\?x\.outcome:"error"/,
  "Completion must keep the accepted/rejected/error state contract"
);

console.log("Discovery ledger rejection reasons contract: OK");
