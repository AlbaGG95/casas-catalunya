import assert from "node:assert/strict";
import fs from "node:fs";

const edge=fs.readFileSync("supabase/functions/discovery-plan/index.ts","utf8");

assert.match(
  edge,
  /function rejectionAuditText\(x:any,outcome:string\)/,
  "Rejected discovery outcomes must build a bounded audit reason"
);

assert.match(
  edge,
  /last_error:outcome==="accepted"\?null:rejectionAuditText\(x,outcome\)/,
  "Rejected discovery outcomes must preserve their reason and bounded evidence in the ledger"
);

assert.match(
  edge,
  /return \(evidence\?\`\$\{base\} \| \$\{evidence\}\`:base\)\.slice\(0,500\)/,
  "Discovery audit evidence must stay bounded to 500 characters"
);

assert.match(
  edge,
  /const outcome=\["accepted","rejected","error"\]\.includes\(x\?\.outcome\)\?x\.outcome:"error"/,
  "Completion must keep the accepted/rejected/error state contract"
);

console.log("Discovery ledger rejection reasons contract: OK");
