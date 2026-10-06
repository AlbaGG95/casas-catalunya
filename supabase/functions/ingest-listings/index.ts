
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { evaluateSafetyText, SAFETY_DECISIONS } from "./safety-engine.ts";
import { nextSourceHealthState } from "./source-health.mjs";

const ALLOWED_REPO = "AlbaGG95/casas-catalunya";
const ALLOWED_REF = "refs/heads/main";
const AUDIENCE = "casas-catalunya-supabase";
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

function normalizeUrl(input: string) {
  try {
    const u = new URL(input);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(from|utm_|source|campaign|medium|ref)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return input;
  }
}

function nullableNumber(v: any) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hardReasons(l: any) {
  const reasons: string[] = [];
  const price = Number(l?.price);
  const beds = Number(l?.bedrooms);
  const text = `${l?.title ?? ""} ${l?.summary ?? ""}`;
  if (!Number.isInteger(price) || price < 1 || price > 185000) reasons.push("price");
  if (!Number.isInteger(beds) || beds < 3 || beds > 20) reasons.push("bedrooms");
  if (!["Barcelona","Girona","Tarragona","Lleida"].includes(l?.province)) reasons.push("province");
  if (l?.active === false) reasons.push("inactive");

  const edgeSafety = evaluateSafetyText(text);
  if (edgeSafety.decision === SAFETY_DECISIONS.REJECT) reasons.push("safety:"+edgeSafety.code);
  if (l?.safetyDecision === SAFETY_DECISIONS.REJECT) reasons.push("crawler_safety:"+String(l?.safetyCode||"reject"));

  if (l?.travelStatus === "too_far" || Number(l?.driveMinutes) > 90) reasons.push("too_far");
  return reasons;
}

function confidenceDecision(l: any) {
  const provider = String(l?.provider || "");
  const priceConfidence = ["high","medium","low","unknown"].includes(l?.priceConfidence) ? l.priceConfidence : "unknown";
  const dataConfidence = ["high","medium","low","unknown"].includes(l?.dataConfidence) ? l.dataConfidence : "unknown";
  const reasons: string[] = [];

  if (provider === "Fotocasa" && priceConfidence !== "high") reasons.push("fotocasa_price_not_high_confidence");
  else if (priceConfidence === "low" || priceConfidence === "unknown") reasons.push("price_not_verified");

  if (dataConfidence === "low") reasons.push("data_confidence_low");
  return { priceConfidence, dataConfidence, quarantine: reasons.length > 0, reasons };
}

async function verifyGithub(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("missing bearer token");
  const token = auth.slice(7);
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: "https://token.actions.githubusercontent.com",
    audience: AUDIENCE,
  });
  if (payload.repository !== ALLOWED_REPO) throw new Error("repository not allowed");
  if (payload.ref !== ALLOWED_REF) throw new Error("ref not allowed");
  return payload;
}

function aggregateSourceStatus(sourceStatus: Record<string, any>) {
  const byProvider = new Map<string, any>();
  for (const [key, s] of Object.entries(sourceStatus || {})) {
    const provider = String(key).split(" ")[0];
    const cur = byProvider.get(provider) || {
      pages: 0, discovered: 0, accepted: 0, rejected: 0, priceConflicts: 0, ok: true, errors: []
    };
    const v: any = s;
    cur.pages += Number(v?.pages || 0);
    cur.discovered += Number(v?.discovered || 0);
    cur.accepted += Number(v?.accepted || 0);
    const rejected = v?.rejected || {};
    for (const [reason, count] of Object.entries(rejected)) {
      const n = Number(count || 0);
      cur.rejected += n;
      if (/precio\s+conflictivo|precio.*no\s+verificado|price.*conflict/i.test(String(reason))) cur.priceConflicts += n;
    }
    cur.ok = cur.ok && v?.ok !== false;
    if (v?.error) cur.errors.push(String(v.error));
    byProvider.set(provider, cur);
  }
  return byProvider;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const claims = await verifyGithub(req);
    const body = await req.json();
    const listings = Array.isArray(body?.listings) ? body.listings : [];
    const generatedAt = body?.generatedAt || new Date().toISOString();

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const secret = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret) throw new Error("missing server key");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, secret, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const sourceSummary = aggregateSourceStatus(body?.sourceStatus || {});
    const skipSourceHealth = body?.revalidation === true;
    const providers = skipSourceHealth ? [] : [...new Set([
      ...[...sourceSummary.keys()],
      ...listings.map((l:any) => String(l?.provider || "")).filter(Boolean)
    ])];

    const { data: priorHealth, error: healthReadError } = providers.length
      ? await supabase.from("source_health")
          .select("provider,status,ingestion_enabled,conflict_count,consecutive_failures,quarantine_reason,last_conflict_at,last_success_at,auto_disabled_at,cooldown_until,last_recovered_at,recovery_count")
          .in("provider", providers)
      : { data: [], error: null };
    if (healthReadError) throw healthReadError;

    const priorHealthMap = new Map((priorHealth || []).map((x:any) => [x.provider, x]));
    const disabledProviders = new Set<string>();
    const healthRows:any[] = [];

    for (const provider of providers) {
      const s = sourceSummary.get(provider) || { pages:0,discovered:0,accepted:0,rejected:0,priceConflicts:0,ok:true,errors:[] };
      const prev:any = priorHealthMap.get(provider) || {};
      const state = nextSourceHealthState(provider,s,prev,generatedAt);
      if (state.disabled) disabledProviders.add(provider);
      healthRows.push(state.row);
    }

    if (healthRows.length) {
      const { error } = await supabase.from("source_health").upsert(healthRows, { onConflict: "provider" });
      if (error) throw error;
    }

    const candidates:any[] = [];
    const quarantine:any[] = [];
    const inactiveFingerprints:string[] = [];
    const rejected:any[] = [];

    for (const l of listings) {
      if (l?.active === false) {
        if (l?.id) inactiveFingerprints.push(String(l.id));
        continue;
      }

      const reasons = hardReasons(l);
      if (reasons.length) {
        rejected.push({
          provider: l?.provider || null,
          url: l?.url || null,
          canonical_url: l?.url ? normalizeUrl(l.url) : null,
          reason: reasons.join(","),
          evidence: "edge_hard_validation",
          raw_price: Number.isFinite(Number(l?.price)) ? Number(l.price) : null,
          raw_bedrooms: Number.isFinite(Number(l?.bedrooms)) ? Number(l.bedrooms) : null,
          raw_payload: l ?? {},
        });
        continue;
      }

      const confidence = confidenceDecision(l);
      const providerDisabled = disabledProviders.has(String(l?.provider || ""));
      if (providerDisabled || confidence.quarantine) {
        quarantine.push({
          ...l,
          _quarantineReason: providerDisabled
            ? "source_quarantined"
            : confidence.reasons.join(","),
          _priceConfidence: confidence.priceConfidence,
          _dataConfidence: confidence.dataConfidence,
        });
      } else {
        candidates.push({
          ...l,
          _priceConfidence: confidence.priceConfidence,
          _dataConfidence: confidence.dataConfidence,
        });
      }
    }

    const persistable = [...candidates, ...quarantine];
    const fingerprints = persistable.map((l:any) => String(l.id));
    let existingMap = new Map<string, any>();
    if (fingerprints.length) {
      const { data: existing, error } = await supabase
        .from("properties")
        .select("id,fingerprint,price,status")
        .in("fingerprint", fingerprints);
      if (error) throw error;
      existingMap = new Map((existing || []).map((x:any) => [x.fingerprint, x]));
    }

    const propertyRows = persistable.map((l:any) => {
      const isQuarantine = "_quarantineReason" in l;
      const confidenceScore = Math.max(0, Math.min(100, Number(l.confidenceScore) || 0));
      const safetyDecision = l.safetyDecision === SAFETY_DECISIONS.ACCEPT ? SAFETY_DECISIONS.ACCEPT : SAFETY_DECISIONS.REVIEW;
      return {
        fingerprint: String(l.id),
        title: String(l.title || "Casa detectada").slice(0, 300),
        locality: l.place || null,
        province: l.province,
        address_text: l.addressText || null,
        postal_code: l.postalCode || null,
        cadastral_ref: l.cadastralRef || null,
        latitude: nullableNumber(l?.geo?.lat),
        longitude: nullableNumber(l?.geo?.lon),
        location_precision: ["cadastral","exact_address","approximate","locality","unknown"].includes(l.locationPrecision) ? l.locationPrecision : "unknown",
        price: Number(l.price),
        bedrooms: Number(l.bedrooms),
        bathrooms: nullableNumber(l.bathrooms),
        house_m2: nullableNumber(l.houseM2),
        plot_m2: nullableNumber(l.plotM2),
        image_url: l.imageUrl || null,
        summary: l.summary || null,
        status: isQuarantine ? "quarantine" : "candidate",
        occupancy_status: l.occupancyStatus === "confirmed_free" ? "confirmed_free" : "no_signals",
        financing_status: l.financingStatus === "compatible" ? "compatible" : "no_restrictions_detected",
        registry_status: ["pending","claimed_clear","verified_clear"].includes(l.registryStatus) ? l.registryStatus : "pending",
        independent_status: l.independentStatus === "confirmed" ? "confirmed" : (l.independentStatus === "probable" ? "probable" : "pending"),
        condition_status: safetyDecision === SAFETY_DECISIONS.ACCEPT && l.conditionStatus === "confirmed" ? "confirmed" : "pending",
        safety_decision: safetyDecision,
        safety_reason: l.safetyReason || l?.evidence?.safety?.reason || null,
        safety_code: l?.evidence?.safety?.code || null,
        garden_status: "confirmed",
        fiber_status: l.fiberStatus === "confirmed" ? "confirmed" : (l.fiberStatus === "likely" ? "likely" : "pending"),
        services_status: l.servicesStatus === "confirmed" ? "confirmed" : (l.servicesStatus === "likely" ? "likely" : "pending"),
        travel_status: l.travelStatus === "confirmed" ? "confirmed" : "pending",
        drive_minutes: nullableNumber(l.driveMinutes),
        has_garage: !!l.hasGarage,
        has_pool: !!l.hasPool,
        score: Math.max(0, Math.min(100, Number(l.score) || 0)),
        price_confidence: l._priceConfidence || l.priceConfidence || "unknown",
        data_confidence: l._dataConfidence || l.dataConfidence || "unknown",
        confidence_score: confidenceScore,
        evidence: l.evidence || {},
        quarantine_reason: isQuarantine ? String(l._quarantineReason || "confidence") : null,
        last_verified_at: isQuarantine ? null : generatedAt,
        published_at: l.publishedAt || null,
        first_seen: l.firstSeen || generatedAt,
        last_seen: l.lastSeen || generatedAt,
        last_checked: l.lastChecked || generatedAt,
      };
    });

    let propertyMap = new Map<string, string>();
    if (propertyRows.length) {
      const { data, error } = await supabase
        .from("properties")
        .upsert(propertyRows, { onConflict: "fingerprint" })
        .select("id,fingerprint,price,status");
      if (error) throw error;
      propertyMap = new Map((data || []).map((x:any) => [x.fingerprint, x.id]));
    }

    if (inactiveFingerprints.length) {
      const { error } = await supabase
        .from("properties")
        .update({ status: "withdrawn", last_checked: generatedAt })
        .in("fingerprint", inactiveFingerprints);
      if (error) throw error;
    }

    const sourceRows = persistable
      .filter((l:any) => propertyMap.has(String(l.id)) && l.url)
      .map((l:any) => ({
        property_id: propertyMap.get(String(l.id)),
        provider: l.provider || "unknown",
        source_id: String(l.id),
        url: l.url,
        canonical_url: normalizeUrl(l.url),
        raw_title: l.title || null,
        raw_price: Number(l.price),
        image_url: l.imageUrl || null,
        published_at: l.publishedAt || null,
        first_seen: l.firstSeen || generatedAt,
        last_seen: l.lastSeen || generatedAt,
        last_checked: l.lastChecked || generatedAt,
        active: true,
        price_evidence: l.priceEvidence || null,
        price_confidence: l._priceConfidence || l.priceConfidence || "unknown",
        data_confidence: l._dataConfidence || l.dataConfidence || "unknown",
        safety_decision: l.safetyDecision === SAFETY_DECISIONS.ACCEPT ? SAFETY_DECISIONS.ACCEPT : SAFETY_DECISIONS.REVIEW,
        safety_reason: l.safetyReason || l?.evidence?.safety?.reason || null,
        safety_code: l?.evidence?.safety?.code || null,
        evidence: l.evidence || {},
        metadata: {
          freshnessStatus: l.freshnessStatus ?? null,
          freshnessEvidence: l.freshnessEvidence ?? null,
          discoveredVia: l.discoveredVia ?? null
        }
      }));

    if (sourceRows.length) {
      const { error } = await supabase
        .from("listing_sources")
        .upsert(sourceRows, { onConflict: "canonical_url" });
      if (error) throw error;
    }

    const priceRows:any[] = [];
    for (const l of persistable) {
      const old = existingMap.get(String(l.id));
      const pid = propertyMap.get(String(l.id));
      if (pid && (!old || Number(old.price) !== Number(l.price))) {
        priceRows.push({ property_id: pid, price: Number(l.price), observed_at: generatedAt });
      }
    }
    if (priceRows.length) {
      const { error } = await supabase.from("price_history").insert(priceRows);
      if (error) throw error;
    }

    const verificationRows = candidates
      .map((l:any) => propertyMap.get(String(l.id)))
      .filter(Boolean)
      .map((property_id) => ({ property_id }));
    if (verificationRows.length) {
      const { error } = await supabase
        .from("verification")
        .upsert(verificationRows, { onConflict: "property_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    const officialUrls:Record<string,string> = {
      catastro:"https://www.sedecatastro.gob.es/",
      habitability:"https://habitatge.gencat.cat/ca/ambits/cedules-habitabilitat/index.html",
      energy:"https://certificacioenergetica.gencat.cat/icaen-visor/AppJava/services/certificats/show",
      urbanism:"https://territori.gencat.cat/ca/06_territori_i_urbanisme/observatori_territori/mapa_urbanistic_de_catalunya/index.html",
      flood:"https://aca.gencat.cat/es/laigua/consulta-de-dades/cartografia-geoserveis/"
    };
    const officialRows:any[] = [];
    for (const l of persistable) {
      const property_id = propertyMap.get(String(l.id));
      if (!property_id) continue;
      const hasRef = !!l.cadastralRef;
      const exactAddress = l.locationPrecision === "exact_address";
      for (const source of ["catastro","habitability","energy","urbanism","flood"]) {
        let status = "pending_identity";
        let summary = "Falta una referencia catastral o una identidad suficientemente precisa.";
        if (hasRef && ["catastro","habitability","energy"].includes(source)) {
          status = "ready_to_check";
          summary = "Referencia catastral detectada en el anuncio; preparada para comprobación oficial.";
        } else if (source === "catastro" && exactAddress) {
          status = "manual";
          summary = "Dirección estructurada disponible; Catastro permite localizar la referencia por dirección.";
        } else if (["urbanism","flood"].includes(source) && (hasRef || exactAddress)) {
          status = "manual";
          summary = "Identidad suficiente para revisión cartográfica oficial, pero no se marca como verificada automáticamente.";
        } else if (source === "energy" && exactAddress) {
          status = "manual";
          summary = "ICAEN permite búsqueda por dirección; la coincidencia debe revisarse antes de verificar.";
        } else if (source === "habitability" && exactAddress) {
          status = "manual";
          summary = "La cédula se consulta por referencia catastral; primero hay que confirmar la referencia en Catastro.";
        }
        officialRows.push({
          property_id, source, status, summary,
          official_url: officialUrls[source],
          evidence: {
            cadastralRef: l.cadastralRef || null,
            addressText: l.addressText || null,
            postalCode: l.postalCode || null,
            locationPrecision: l.locationPrecision || "unknown"
          },
          updated_at: generatedAt
        });
      }
    }
    if (officialRows.length) {
      const { error } = await supabase
        .from("official_checks")
        .upsert(officialRows, { onConflict: "property_id,source" });
      if (error) throw error;
    }

    if (rejected.length) {
      const { error } = await supabase.from("rejections").insert(rejected.slice(0, 1000));
      if (error) throw error;
    }

    return Response.json({
      ok: true,
      repository: claims.repository,
      received: listings.length,
      accepted: candidates.length,
      quarantined: quarantine.length,
      rejected: rejected.length,
      withdrawn: inactiveFingerprints.length,
      disabledProviders: [...disabledProviders],
      generatedAt,
    });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
});
