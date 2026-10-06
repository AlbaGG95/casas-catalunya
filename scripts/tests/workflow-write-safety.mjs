import assert from "node:assert/strict";
import fs from "node:fs";

const workflow=fs.readFileSync(".github/workflows/refresh-listings.yml","utf8");

assert.match(workflow,/cron: "\*\/5 \* \* \* \*"/);
assert.match(workflow,/cron: "2 \* \* \* \*"/);

assert.match(
  workflow,
  /reclassify:\n\s+if: github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule'/,
  "Reclassification must never run from a normal push"
);

assert.match(
  workflow,
  /scan:\n\s+if: github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule'/,
  "Scans must never run from a normal push"
);

assert.match(
  workflow,
  /revalidate:\n\s+if: github\.event_name == 'workflow_dispatch' \|\| github\.event\.schedule == '2 \* \* \* \*'/,
  "Revalidation must run manually or on the hourly deep schedule only"
);

assert.match(
  workflow,
  /services:\n\s+if: always\(\) && \(github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule'\)/,
  "Service enrichment must run only for manual/scheduled catalogue work"
);

assert.ok(!fs.existsSync(".github/workflows/step10-main-canary.yml"),"One-time canary workflow must be removed");
assert.ok(!fs.existsSync(".github/workflows/step10-full-activation.yml"),"One-time activation workflow must be removed");

console.log("Scheduled workflow write-safety contract: OK");
