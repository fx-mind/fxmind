"use strict";
const {describe,it,beforeEach,afterEach}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const {learnAfterGate,topicFor}=require("./auto-memory");
let root;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),"fxmind-auto-learn-"));fs.mkdirSync(path.join(root,"resources","[ecco]","robberys","server-side"),{recursive:true});});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
const rel="resources/[ecco]/robberys/server-side/server.lua";
const body='RegisterNetEvent("robberys:ready")\nlocal function verifyRobbery() return true end\n';
function session(){
 fs.writeFileSync(path.join(root,rel),body);
 const hash=crypto.createHash("sha256").update(body).digest("hex");
 return {kind:"mechanic",gates:{C:{complete:true},V:{complete:true,snapshot:{[rel]:hash},evidence:{independentReview:{verdict:"verified"},checks:[{kind:"test",status:"passed"}]}}}};
}
const config={enabled:true,memoryEnabled:true,apiKey:"example-test-key",minConfidence:.75,timeoutMs:400,model:"jev-latest"};
const reply=(choice="save",confidence=.92)=>({ok:true,json:async()=>({answers:{preserve:{choice,confidence}}})});
describe("verified auto-memory learning",()=>{
 it("selects resource topic and never creates from a missing or unverified Gate V",async()=>{
   assert.equal(topicFor([rel]),"robberys");
   const s=session();s.gates.V.complete=false;
   const got=await learnAfterGate(root,s,{config,fetch:async()=>reply()});
   assert.equal(got.reason,"no_verified_gate_v");
   assert.equal(fs.existsSync(path.join(root,".fxmind","memory","robberys.md")),false);
 });
 it("uses Jev only for value decision; creates local-source-verified memory, never sends code/path",async()=>{
   const s=session();let sent;
   const result=await learnAfterGate(root,s,{config,fetch:async(_,init)=>{sent=JSON.parse(init.body);return reply();}});
   assert.equal(result.status,"learned");
   assert.equal(result.created,true);
   assert.equal(sent.state.resource,"robberys");
   assert.equal(JSON.stringify(sent).includes("server-side"),false);
   assert.equal(JSON.stringify(sent).includes("robberys:ready"),false);
   const text=fs.readFileSync(path.join(root,".fxmind","memory","robberys.md"),"utf8");
   assert.match(text,/RegisterNetEvent|robberys:ready/);
   assert.match(text,/sha256 rechecked/);
   assert.match(text,/server-side\/server.lua/);
   const validation=require("../fxmind-tools").validateMemory(root,{filePath:path.join(root,".fxmind","memory","robberys.md")});
   assert.equal(validation.ok,true,JSON.stringify(validation.errors));
   assert.equal((await learnAfterGate(root,s,{config,fetch:async()=>reply()})).reason,"duplicate");
 });
 it("appends new verified facts but preserves manually maintained memories",async()=>{
   const s=session();const target=path.join(root,".fxmind","memory","robberys.md");
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,"---\ntopic: robberys\n---\n# Human-verified facts\n");
   const got=await learnAfterGate(root,s,{config,fetch:async()=>reply()});
   assert.equal(got.created,false);
   assert.match(fs.readFileSync(target,"utf8"),/# Human-verified facts/);
 });
 it("rejects stale snapshot and low confidence, even when Jev wants save",async()=>{
   const s=session();fs.appendFileSync(path.join(root,rel),"-- edited after gate V\n");
   assert.equal((await learnAfterGate(root,s,{config,fetch:async()=>reply()})).reason,"stale_or_unsupported_files");
   fs.writeFileSync(path.join(root,rel),body);
   const low=await learnAfterGate(root,s,{config,fetch:async()=>reply("save",.34)});
   assert.equal(low.reason,"jev_low_value_or_unavailable");
 });
 it("accepts a 0.72 learning recommendation without lowering task routing threshold",async()=>{
   const s=session();
   const r=await learnAfterGate(root,s,{config,fetch:async()=>reply("save",.72)});
   assert.equal(r.status,"learned");
 });
 it("never learns without Jev opt-in or from failed checks",async()=>{
   const s=session();const off={...config,enabled:false};
   assert.equal((await learnAfterGate(root,s,{config:off})).reason,"jev_unavailable");
   s.gates.V.evidence.checks[0].status="blocked";
   assert.equal((await learnAfterGate(root,s,{config,fetch:async()=>reply()})).reason,"no_verified_gate_v");
 });
});
