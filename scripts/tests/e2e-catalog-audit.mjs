import assert from "node:assert/strict";
import fs from "node:fs";
import {MAX_PRICE,MIN_BEDROOMS} from "../../search-criteria.js";
import {canonicalListingUrl} from "../lib/provider-adapters.mjs";

const payload=JSON.parse(fs.readFileSync("data/listings.json","utf8"));
const active=(payload.listings||[]).filter(x=>x.active!==false);

assert.ok(active.every(x=>Number(x.price)<=MAX_PRICE),"Versioned catalogue contains a listing above the canonical hard cap");
assert.ok(active.every(x=>Number(x.bedrooms)>=MIN_BEDROOMS),"Versioned catalogue contains a listing below the bedroom minimum");

const canonical=active.map(x=>canonicalListingUrl(x.url));
assert.equal(new Set(canonical).size,canonical.length,"Versioned catalogue contains duplicate canonical listing URLs");

const generatedAt=Date.parse(payload.generatedAt||"");
assert.ok(Number.isFinite(generatedAt),"Versioned catalogue must expose a valid generatedAt");

const audit={
  generatedAt:payload.generatedAt,
  active:active.length,
  maxPriceSeen:Math.max(0,...active.map(x=>Number(x.price)||0)),
  conditionPending:active.filter(x=>x.conditionStatus!=="confirmed").length,
  independencePending:active.filter(x=>!["confirmed","probable"].includes(x.independentStatus)).length,
  travelPending:active.filter(x=>x.travelStatus!=="confirmed").length,
  fiberPending:active.filter(x=>x.fiberStatus!=="confirmed").length,
  servicesPending:active.filter(x=>x.servicesStatus!=="confirmed").length
};

console.log("E2E catalogue invariant audit: OK",JSON.stringify(audit));
