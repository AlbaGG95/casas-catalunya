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

assert.match(
  edge,
  /selectByUrls\(supabase,"listing_security_text","canonical_url",urls\)/,
  "Discovery planning must know which listings already have private security text"
);

assert.match(
  edge,
  /const needsSecurityBackfill=!!source&&!securityMap\.has\(item\.url\)/,
  "Existing listings without security text must be marked for backfill"
);

assert.match(
  edge,
  /nowMs-checkedMs<knownFreshMs&&!needsSecurityBackfill/,
  "Freshness must not suppress the one-time security-text backfill"
);

assert.match(
  edge,
  /a\.needsSecurityBackfill!==b\.needsSecurityBackfill/,
  "Security backfill must be prioritised before normal discovery work"
);

console.log("Discovery ledger rejection reasons contract: OK");
