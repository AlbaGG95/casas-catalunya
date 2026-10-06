export function nextSourceHealthState(provider,s,prev,generatedAt){
  const current=s||{};
  const previous=prev||{};
  const nowMs=new Date(generatedAt).getTime();
  const previousFailures=Number(previous.consecutive_failures||0);
  let failures=current.ok===false?previousFailures+1:0;
  const discovered=Number(current.discovered||0);
  const pages=Number(current.pages||0);
  const priceConflicts=Number(current.priceConflicts||0);
  const conflictRate=discovered>0?priceConflicts/discovered:0;
  const priceKill=priceConflicts>=3||(discovered>=10&&conflictRate>=0.20);
  const failureKill=failures>=3;
  const wasDisabled=previous.ingestion_enabled===false||previous.status==="quarantined";
  const cooldownMs=previous.cooldown_until?new Date(previous.cooldown_until).getTime():0;
  const cooldownExpired=!cooldownMs||nowMs>=cooldownMs;
  const healthyProbe=current.ok===true&&pages>0;
  const canRecover=wasDisabled&&cooldownExpired&&healthyProbe&&!priceKill;

  let disabled=false;
  let recovered=false;
  let reason=null;
  let cooldownUntil=previous.cooldown_until||null;

  if(canRecover){
    recovered=true;
    failures=0;
    disabled=false;
    cooldownUntil=null;
  }else if(wasDisabled){
    disabled=true;
    reason=previous.quarantine_reason||"previous_quarantine";
    if(cooldownExpired&&!healthyProbe){
      cooldownUntil=new Date(nowMs+60*60*1000).toISOString();
    }
  }else if(priceKill||failureKill){
    disabled=true;
    reason=priceKill
      ? `price_conflicts:${priceConflicts}/${discovered}`
      : `consecutive_failures:${failures}`;
    cooldownUntil=new Date(nowMs+30*60*1000).toISOString();
  }

  return {
    disabled,
    recovered,
    row:{
      provider,
      last_run_at:generatedAt,
      last_success_at:current.ok===true?generatedAt:(previous.last_success_at||null),
      status:disabled?"quarantined":(current.ok===true?"ok":(pages>0?"degraded":"down")),
      discovered_count:discovered,
      accepted_count:Number(current.accepted||0),
      rejected_count:Number(current.rejected||0),
      error_message:(current.errors||[]).length?current.errors.join("; ").slice(0,500):null,
      ingestion_enabled:!disabled,
      conflict_count:Number(previous.conflict_count||0)+priceConflicts,
      consecutive_failures:failures,
      auto_disabled_at:disabled?(previous.auto_disabled_at||generatedAt):null,
      quarantine_reason:disabled?reason:null,
      last_conflict_at:priceConflicts>0?generatedAt:(previous.last_conflict_at||null),
      cooldown_until:cooldownUntil,
      last_recovered_at:recovered?generatedAt:(previous.last_recovered_at||null),
      recovery_count:Number(previous.recovery_count||0)+(recovered?1:0)
    }
  };
}
