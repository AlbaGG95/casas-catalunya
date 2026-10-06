import assert from "node:assert/strict";
import {nextSourceHealthState} from "../../supabase/functions/ingest-listings/source-health.mjs";

const now="2026-10-06T12:00:00.000Z";

{
  const state=nextSourceHealthState("Indomio",{ok:false,pages:0,discovered:0,errors:["HTTP 403"]},{consecutive_failures:2,ingestion_enabled:true,status:"down"},now);
  assert.equal(state.disabled,true);
  assert.equal(state.row.status,"quarantined");
  assert.match(state.row.quarantine_reason,/consecutive_failures:3/);
  assert.ok(state.row.cooldown_until);
}

{
  const state=nextSourceHealthState("Indomio",{ok:true,pages:1,discovered:12,priceConflicts:0,errors:[]},{
    consecutive_failures:4,ingestion_enabled:false,status:"quarantined",
    cooldown_until:"2026-10-06T11:59:00.000Z",recovery_count:1,
    quarantine_reason:"consecutive_failures:4"
  },now);
  assert.equal(state.disabled,false);
  assert.equal(state.recovered,true);
  assert.equal(state.row.status,"ok");
  assert.equal(state.row.recovery_count,2);
  assert.equal(state.row.quarantine_reason,null);
}

{
  const state=nextSourceHealthState("Fotocasa",{ok:true,pages:1,discovered:10,priceConflicts:3,errors:[]},{
    ingestion_enabled:false,status:"quarantined",cooldown_until:"2026-10-06T11:00:00.000Z",
    quarantine_reason:"price_conflicts:3/10"
  },now);
  assert.equal(state.disabled,true,"price-conflict source must not auto-recover");
}

{
  const state=nextSourceHealthState("Yaencontre",{ok:true,pages:1,discovered:5,priceConflicts:0,errors:[]},{
    ingestion_enabled:false,status:"quarantined",cooldown_until:"2026-10-06T13:00:00.000Z",
    quarantine_reason:"previous_quarantine"
  },now);
  assert.equal(state.disabled,true,"cooldown must be respected");
}

console.log("Source recovery state tests: OK");
