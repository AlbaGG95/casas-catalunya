import assert from "node:assert/strict";
import {buildSourceDefinitions,sourceDefinitionKey} from "../lib/source-catalog.mjs";

const all=buildSourceDefinitions({mode:"deep"});
assert.equal(all.length,36,"Expected 9 search seeds × 4 provinces");
assert.equal(new Set(all.map(sourceDefinitionKey)).size,all.length,"Every source seed needs a unique key");

const barcelonaHabitaclia=buildSourceDefinitions({mode:"deep",scanProvider:"Habitaclia",scanProvince:"Barcelona"});
assert.equal(barcelonaHabitaclia.length,2);
assert.deepEqual(new Set(barcelonaHabitaclia.map(x=>x.variant)),new Set(["chalets","casas"]));
assert.ok(barcelonaHabitaclia.every(x=>x.pages===12));

const pisos=buildSourceDefinitions({mode:"recent",scanProvider:"Pisos.com",scanProvince:"Girona"});
assert.equal(pisos.length,1);
assert.equal(pisos[0].pages,4);
assert.match(pisos[0].base,/hasta-185000/);

const ya=buildSourceDefinitions({mode:"recent",scanProvider:"Yaencontre",scanProvince:"Lleida"});
assert.equal(ya.length,2);
assert.ok(ya.some(x=>x.variant==="casas"));
assert.ok(ya.some(x=>x.variant==="chalets"));

for(const src of all){
  assert.match(src.base,/^https:\/\//);
  assert.ok(src.pages>=1);
  assert.ok(src.maxDetails>=1);
}

console.log("Coverage source catalogue tests: OK");
