import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MAX_PRICE,PREFERRED_PRICE,MID_PRICE,MIN_BEDROOMS,MAX_DRIVE_MINUTES
} from "../../search-criteria.js";
import {coreValidation} from "../lib/safety-rules.mjs";

assert.equal(MAX_PRICE,195000,"Maximum purchase price must be 195,000 €");
assert.equal(PREFERRED_PRICE,180000);
assert.equal(MID_PRICE,185000);
assert.equal(MIN_BEDROOMS,3);
assert.equal(MAX_DRIVE_MINUTES,90);

assert.deepEqual(
  coreValidation({price:195000,bedrooms:3,title:"Casa independiente",summary:"buen estado",active:true}),
  [],
  "195,000 € must remain inside the hard budget"
);
assert.deepEqual(
  coreValidation({price:195001,bedrooms:3,title:"Casa independiente",summary:"buen estado",active:true}),
  ["price"],
  "195,001 € must be outside the hard budget"
);

const edge=fs.readFileSync("supabase/functions/_shared/search-criteria.ts","utf8");
for(const [name,value] of Object.entries({
  MAX_PRICE,PREFERRED_PRICE,MID_PRICE,MIN_BEDROOMS,MAX_DRIVE_MINUTES
})){
  assert.match(edge,new RegExp(`export const ${name}=${value}\\b`),`Edge mirror drift for ${name}`);
}

const ingest=fs.readFileSync("supabase/functions/ingest-listings/index.ts","utf8");
const reclassify=fs.readFileSync("supabase/functions/reclassify-safety/index.ts","utf8");
const status=fs.readFileSync("supabase/functions/system-status/index.ts","utf8");
const revalidation=fs.readFileSync("supabase/functions/revalidation-plan/index.ts","utf8");
for(const [name,source] of [["ingest",ingest],["reclassify",reclassify],["system-status",status],["revalidation-plan",revalidation]]){
  assert.match(source,/_shared\/search-criteria\.ts/,`${name} must import shared Edge criteria`);
  assert.doesNotMatch(source,/(?:>|<=|lte\("price",)\s*185000/, `${name} still contains legacy 185k hard limit`);
}

assert.match(revalidation,/needsSecurityBackfill:!securityPropertyIds\.has\(row\.property_id\)/);
assert.match(revalidation,/Number\(b\.needsSecurityBackfill\)-Number\(a\.needsSecurityBackfill\)/);

const app=fs.readFileSync("app.js","utf8");
const property=fs.readFileSync("property.js","utf8");
const propertyHtml=fs.readFileSync("property.html","utf8");
assert.match(app,/from "\.\/search-criteria\.js"/);
assert.match(property,/from "\.\/search-criteria\.js"/);
assert.doesNotMatch(app,/const HARD_MAX_PRICE=\d+/);
assert.doesNotMatch(property,/const HARD_MAX_PRICE=\d+/);
assert.match(propertyHtml,/id="familyOfferAmount"[^>]*max="195000"/);
assert.doesNotMatch(propertyHtml,/id="familyOfferAmount"[^>]*max="185000"/);

console.log("Central search criteria contract: OK");
