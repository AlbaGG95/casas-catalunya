import {
  HARD_REJECT_RULES,
  CONDITION_REJECT_RULES,
  evaluateSafetyText,
  SAFETY_DECISIONS
} from "./safety-engine.mjs";

export const MAX_PRICE=185000;
export const MIN_BEDROOMS=3;
export const MAX_DRIVE_MINUTES=90;

export const BLOCK_PATTERNS=HARD_REJECT_RULES.map(x=>[x.reason,x.rx]);
export const BAD_CONDITION=CONDITION_REJECT_RULES.map(x=>[x.reason,x.rx]);

export function blockReason(text){
  const result=evaluateSafetyText(text,{partial:true});
  if(result.decision!==SAFETY_DECISIONS.REJECT)return null;
  return HARD_REJECT_RULES.some(x=>x.code===result.code)?result.reason:null;
}

export function badConditionReason(text){
  const result=evaluateSafetyText(text,{partial:true});
  if(result.decision!==SAFETY_DECISIONS.REJECT)return null;
  return CONDITION_REJECT_RULES.some(x=>x.code===result.code)?result.reason:null;
}

export function coreValidation(listing){
  const reasons=[];
  const price=Number(listing?.price);
  const bedrooms=Number(listing?.bedrooms);
  const text=`${listing?.title||""} ${listing?.summary||""}`;

  if(!Number.isInteger(price)||price<1||price>MAX_PRICE)reasons.push("price");
  if(!Number.isInteger(bedrooms)||bedrooms<MIN_BEDROOMS||bedrooms>20)reasons.push("bedrooms");
  if(listing?.active===false)reasons.push("inactive");

  const safety=evaluateSafetyText(text);
  if(safety.decision===SAFETY_DECISIONS.REJECT)reasons.push("safety:"+safety.code);

  if(listing?.travelStatus==="too_far"||Number(listing?.driveMinutes)>MAX_DRIVE_MINUTES)reasons.push("too_far");
  return reasons;
}
