import assert from "node:assert/strict";
import fs from "node:fs";
import {evaluateSafetyDocument,SAFETY_DECISIONS} from "../lib/safety-engine.mjs";

const occupied=evaluateSafetyDocument({
  title:"Chalet independiente con jardín",
  metaDescription:"Oportunidad familiar. Vivienda actualmente ocupada y no visitable.",
  structuredText:"",
  bodyText:"Casa en buen estado y lista para entrar a vivir.",
  safetyText:""
});
assert.equal(occupied.decision,SAFETY_DECISIONS.REJECT);
assert.equal(occupied.code,"occupied");
assert.equal(occupied.evidenceDetail?.source,"meta_description");
assert.match(occupied.evidenceDetail?.match||"",/ocupada/i);
assert.match(occupied.evidenceDetail?.excerpt||"",/actualmente ocupada/i);
assert.ok((occupied.evidenceDetail?.excerpt||"").length<=260);

const structured=evaluateSafetyDocument({
  title:"Casa reformada",
  metaDescription:"Muy buen estado",
  structuredText:"Venta sin posesión. Operación destinada a inversores.",
  bodyText:"Lista para entrar a vivir.",
  safetyText:""
});
assert.equal(structured.decision,SAFETY_DECISIONS.REJECT);
assert.equal(structured.code,"no_possession");
assert.equal(structured.evidenceDetail?.source,"structured");

const negativeWins=evaluateSafetyDocument({
  title:"Casa lista para entrar a vivir",
  metaDescription:"",
  structuredText:"",
  bodyText:"Necesita reforma integral antes de ser habitable.",
  safetyText:""
});
assert.equal(negativeWins.decision,SAFETY_DECISIONS.REJECT);
assert.equal(negativeWins.code,"major_renovation");
assert.equal(negativeWins.evidenceDetail?.source,"body");

const unknown=evaluateSafetyDocument({
  title:"Chalet independiente con jardín",
  metaDescription:"",
  structuredText:"",
  bodyText:"Cuatro habitaciones y garaje.",
  safetyText:""
});
assert.equal(unknown.decision,SAFETY_DECISIONS.REVIEW);
assert.equal(unknown.evidenceDetail,null);

const migration=fs.readFileSync("supabase/migrations/20261006134500_step3_listing_security_text.sql","utf8");
const ingest=fs.readFileSync("supabase/functions/ingest-listings/index.ts","utf8");
const reclassify=fs.readFileSync("supabase/functions/reclassify-safety/index.ts","utf8");
const discovery=fs.readFileSync("supabase/functions/discovery-plan/index.ts","utf8");
const updater=fs.readFileSync("scripts/update-listings.mjs","utf8");
const app=fs.readFileSync("app.js","utf8");
const property=fs.readFileSync("property.js","utf8");
const nodeEngine=fs.readFileSync("scripts/lib/safety-engine.mjs","utf8");
const ingestEngine=fs.readFileSync("supabase/functions/ingest-listings/safety-engine.ts","utf8");
const reclassEngine=fs.readFileSync("supabase/functions/reclassify-safety/safety-engine.ts","utf8");

assert.match(migration,/evidence_source text/);
assert.match(migration,/evidence_match text/);
assert.match(migration,/evidence_excerpt text/);
assert.match(migration,/listing_security_text_excerpt_size/);
assert.equal((migration.match(/alter table public\.listing_security_text enable row level security/g)||[]).length,1);
assert.equal((migration.match(/create index if not exists listing_security_text_property_idx/g)||[]).length,1);
assert.ok(migration.indexOf(");")<migration.indexOf("alter table public.listing_security_text"));
assert.match(migration,/update public\.properties[\s\S]*#- '\\{safety,evidence\\}'/);
assert.match(migration,/update public\.listing_sources[\s\S]*#- '\\{condition,evidenceDetail\\}'/);

assert.match(ingest,/evaluateSafetyDocument/);
assert.match(ingest,/evidence_excerpt:/);
assert.match(ingest,/evidence: publicEvidence\(l\.evidence\)/);
assert.equal((ingest.match(/evidence: publicEvidence\(l\.evidence\)/g)||[]).length,2);
assert.doesNotMatch(ingest,/evidence: l\.evidence \|\| \{\}/);

assert.match(reclassify,/evaluateSafetyDocument/);
assert.match(reclassify,/evidence_source:/);
assert.match(reclassify,/evidence_excerpt:/);
assert.doesNotMatch(reclassify,/privateText=securityByProperty\.get\(p\.id\);\\n/);

assert.match(discovery,/rejectionAuditText/);
assert.match(discovery,/safetyEvidence/);
assert.match(updater,/safetyEvidence:parsed\.safety\?\.evidenceDetail/);

assert.doesNotMatch(app,/evidence_excerpt|evidence_match|listing_security_text/);
assert.doesNotMatch(property,/evidence_excerpt|evidence_match|listing_security_text/);
assert.equal(ingestEngine,nodeEngine,"ingest SafetyEngine drift");
assert.equal(reclassEngine,nodeEngine,"reclassify SafetyEngine drift");

console.log("Structured safety decision evidence: OK");
