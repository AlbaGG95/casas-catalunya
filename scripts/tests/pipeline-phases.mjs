import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";

const dir=await fs.mkdtemp(path.join(os.tmpdir(),"casas-pipeline-"));
const plan=path.join(dir,"plan.json");
const out=path.join(dir,"out.json");

await fs.writeFile(plan,JSON.stringify({
  ok:true,
  generatedAt:new Date().toISOString(),
  scanMode:"recent",
  sourceStatus:{},
  items:[]
}));

await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,["scripts/update-listings.mjs"],{
    cwd:process.cwd(),
    env:{
      ...process.env,
      PIPELINE_PHASE:"classify",
      PLAN_PATH:plan,
      OUTPUT_PATH:out,
      SCAN_MODE:"recent",
      INCREMENTAL_ONLY:"true"
    },
    stdio:"pipe"
  });
  let stderr="";
  child.stderr.on("data",d=>stderr+=d);
  child.on("error",reject);
  child.on("exit",code=>code===0?resolve():reject(new Error("classify phase failed: "+stderr)));
});

const payload=JSON.parse(await fs.readFile(out,"utf8"));
assert.equal(payload.pipelinePhase,"classify");
assert.equal(payload.rules.maxPrice,185000);
assert.deepEqual(payload.listings,[]);
assert.deepEqual(payload.pipelineResults,[]);
assert.equal(payload.stats.checkedDetails,0);

await fs.rm(dir,{recursive:true,force:true});
console.log("Discovery/classification pipeline smoke test: OK");
