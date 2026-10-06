import assert from "node:assert/strict";
import {evaluateSafetyText,SAFETY_DECISIONS} from "../lib/safety-engine.mjs";
import {safetyV2Cases} from "./fixtures/safety-v2-cases.mjs";

for(const fixture of safetyV2Cases){
  const result=evaluateSafetyText(fixture.title+" "+fixture.text);
  assert.equal(
    result.decision,
    fixture.expected,
    fixture.id+" expected "+fixture.expected+" but got "+result.decision+" ("+result.code+")"
  );
}

assert.equal(evaluateSafetyText("Obra nueva en construcción, lista para entrar algún día").decision,SAFETY_DECISIONS.REJECT);
assert.equal(evaluateSafetyText("Casa semireformada y reformada hace años").decision,SAFETY_DECISIONS.REVIEW);
assert.equal(evaluateSafetyText("Inmueble actualmente ocupadodescubre tu nuevo hogar").decision,SAFETY_DECISIONS.REJECT);
assert.equal(evaluateSafetyText("Vivienda sobre parcela rústica").decision,SAFETY_DECISIONS.REJECT);
assert.equal(evaluateSafetyText("Casa totalmente reformada y lista para entrar a vivir").decision,SAFETY_DECISIONS.ACCEPT);

console.log("SafetyEngine v2 regression corpus: OK");
