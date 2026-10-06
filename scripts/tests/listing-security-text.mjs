import assert from "node:assert/strict";
import fs from "node:fs";
import * as cheerio from "cheerio";
import {
  allJsonLd,extractListingSecurityText,stripPrivateListingFields
} from "../lib/listing-security-text.mjs";

const html=`<!doctype html>
<html><head>
<title>Casa con jardín</title>
<meta name="description" content="Chalet familiar en buen estado">
<script type="application/ld+json">
{"@type":"House","name":"Casa familiar con parcela privada","description":"Venta sin posesión; destinada a inversores"}
</script>
</head><body>
<nav>Casa ocupada de otro anuncio</nav>
<main>
<h1>Casa con jardín</h1>
<section class="description">Vivienda luminosa. Actualmente ocupada y no visitable.</section>
<section class="related-listings">Otra casa para reformar integralmente.</section>
<div class="cookie-banner">Aceptar cookies para reformar</div>
</main>
<footer>Subasta de otra vivienda</footer>
</body></html>`;

const $=cheerio.load(html);
const items=allJsonLd($);
const doc=extractListingSecurityText($,items);

assert.match(doc.safetyText,/actualmente ocupada/i);
assert.match(doc.safetyText,/venta sin posesión/i);
assert.match(doc.metaDescription,/buen estado/i);
assert.match(doc.structuredText,/destinada a inversores/i);
assert.doesNotMatch(doc.bodyText,/otro anuncio/i);
assert.doesNotMatch(doc.bodyText,/otra casa para reformar/i);
assert.doesNotMatch(doc.bodyText,/aceptar cookies/i);
assert.match(doc.contentHash,/^[0-9a-f]{64}$/);
assert.equal(extractListingSecurityText($,items).contentHash,doc.contentHash);

const publicListing=stripPrivateListingFields({
  id:"x",
  title:"Casa",
  securityText:{safetyText:doc.safetyText}
});
assert.equal(publicListing.id,"x");
assert.equal("securityText" in publicListing,false);

const ingest=fs.readFileSync("supabase/functions/ingest-listings/index.ts","utf8");
const reclassify=fs.readFileSync("supabase/functions/reclassify-safety/index.ts","utf8");
const migration=fs.readFileSync("supabase/migrations/20261006134500_step3_listing_security_text.sql","utf8");
const app=fs.readFileSync("app.js","utf8");
const property=fs.readFileSync("property.js","utf8");
const updater=fs.readFileSync("scripts/update-listings.mjs","utf8");
const publicData=fs.readFileSync("data/listings.json","utf8");

assert.match(ingest,/listing_security_text/);
assert.match(ingest,/securityText/);
assert.match(reclassify,/listing_security_text/);
assert.match(reclassify,/safety_text/);
assert.match(migration,/enable row level security/i);
assert.match(migration,/revoke all on table public\.listing_security_text from public, anon, authenticated/i);
assert.match(migration,/grant select, insert, update, delete on table public\.listing_security_text to service_role/i);
assert.doesNotMatch(app,/listing_security_text|securityText/);
assert.doesNotMatch(property,/listing_security_text|securityText/);
assert.doesNotMatch(publicData,/"securityText"\s*:/);
assert.match(updater,/listings:listings\.map\(stripPrivateListingFields\)/);
assert.match(ingest,/raw_payload:\s*publicRawPayload\(l\)/);

console.log("Private listing security text contract: OK");
