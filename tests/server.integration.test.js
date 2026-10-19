"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const {spawn}=require("node:child_process");
const {hotp}=require("../domain");

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
function base32ToHex(value){const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="",hex="";for(const c of value)bits+=alphabet.indexOf(c).toString(2).padStart(5,"0");for(let i=0;i+4<=bits.length;i+=4)hex+=parseInt(bits.slice(i,i+4),2).toString(16);return hex;}

test("server integrates gold history, TOTP, employee password policy, FIFO profit and lifecycle records",{timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gca-test-")),port=await freePort(),proc=spawn(process.execPath,[path.resolve(__dirname,"../server.js")],{cwd:path.resolve(__dirname,".."),env:{...process.env,PORT:String(port),GCA_DATA_DIR:path.join(dir,"data"),GCA_BACKUP_DIR:path.join(dir,"backups"),GCA_DISABLE_EXTERNAL_REFRESH:"1"},stdio:["ignore","pipe","pipe"]});
  let output="";
  proc.stdout.on("data",x=>output+=x);proc.stderr.on("data",x=>output+=x);
  t.after(async()=>{proc.kill("SIGTERM");await new Promise(resolve=>{if(proc.exitCode!==null)return resolve();proc.once("exit",resolve);setTimeout(resolve,1000);});fs.rmSync(dir,{recursive:true,force:true});});
  const url="http://127.0.0.1:"+port;
  for(let i=0;i<100;i++){try{const r=await fetch(url+"/api/status");if(r.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
  const status=await fetch(url+"/api/status");assert.equal(status.status,200,output);
  async function request(route,method="GET",body,token){const response=await fetch(url+route,{method,headers:{...(body!==undefined?{"Content-Type":"application/json"}:{}),...(token?{Cookie:token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const json=await response.json();return{response,json,token:response.headers.get("set-cookie")?.split(";")[0]||token};}
  let r=await request("/api/setup","POST",{name:"مدير الاختبار",username:"testadmin",password:"StrongTestPassword1"});assert.equal(r.response.status,201);let managerCookie=r.token;
  assert.equal((await fetch(url+"/")).status,200);assert.equal((await fetch(url+"/vault/index.html")).status,200);assert.equal((await fetch(url+"/data/accounts.json")).status,404);assert.equal((await fetch(url+"/data/.secret-key")).status,404);assert.equal((await fetch(url+"/server.js")).status,404);
  r=await request("/api/gold-prices","PUT",{mode:"manual",prices:{24:7000,21:6125,18:5250}},managerCookie);assert.equal(r.response.status,200);
  r=await request("/api/gold-prices","PUT",{mode:"manual",prices:{24:7500,21:6562.5,18:5625}},managerCookie);assert.equal(r.response.status,200);
  r=await request("/api/advanced","GET",undefined,managerCookie);assert.equal(r.response.status,200);assert.ok(r.json.goldPriceHistory.length>=2);assert.ok(r.json.alerts.some(a=>a.type==="gold-move"));

  r=await request("/api/two-factor/setup","POST",{},managerCookie);assert.equal(r.response.status,200);const secret=base32ToHex(r.json.secret),code=hotp(secret,Math.floor(Date.now()/30000));
  const confirm=await request("/api/two-factor/confirm","POST",{code},managerCookie);assert.equal(confirm.response.status,200);const stored=JSON.parse(fs.readFileSync(path.join(dir,"data","accounts.json"),"utf8"));assert.match(stored.users.find(x=>x.username==="testadmin").twoFactorSecret,/^v1:/);assert.notEqual(stored.users.find(x=>x.username==="testadmin").twoFactorSecret,secret);
  r=await request("/api/logout","POST",{},managerCookie);assert.equal(r.response.status,200);
  r=await request("/api/login","POST",{username:"testadmin",password:"StrongTestPassword1",otp:"000000"});assert.equal(r.response.status,401);
  r=await request("/api/login","POST",{username:"testadmin",password:"StrongTestPassword1",otp:hotp(secret,Math.floor(Date.now()/30000))});assert.equal(r.response.status,200);managerCookie=r.token;

  r=await request("/api/users","POST",{name:"موظف الاختبار",username:"testworker",password:"TemporaryPassword1"},managerCookie);assert.equal(r.response.status,201);assert.equal(r.json.user.mustChangePassword,true);
  let worker=await request("/api/login","POST",{username:"testworker",password:"TemporaryPassword1"});assert.equal(worker.response.status,200);let workerCookie=worker.token;
  r=await request("/api/state","GET",undefined,workerCookie);assert.equal(r.response.status,428);
  r=await request("/api/password","POST",{currentPassword:"TemporaryPassword1",password:"NewWorkerPassword1"},workerCookie);assert.equal(r.response.status,200);
  r=await request("/api/state","GET",undefined,workerCookie);assert.equal(r.response.status,200);

  r=await request("/api/state","GET",undefined,managerCookie);assert.equal(r.response.status,200);const state=r.json;
  const invalidStock=JSON.parse(JSON.stringify(state));invalidStock.inventoryItems.push({id:"bad-stock",name:"مخزون غير صالح",karat:"21",weight:1,quantity:2,minimum:0});invalidStock.inventoryMovements.push({id:"bad-receipt",itemId:"bad-stock",direction:"in",quantity:2,date:new Date().toISOString()});invalidStock.inventoryLots.push({id:"bad-lot",itemId:"bad-stock",receivedAt:new Date().toISOString(),quantityReceived:2,quantityRemaining:1,unitCost:10});r=await request("/api/state","PUT",{version:state.version,state:invalidStock},managerCookie);assert.equal(r.response.status,400);r=await request("/api/state","GET",undefined,managerCookie);assert.equal(r.json.inventoryItems.some(i=>i.id==="bad-stock"),false);
  state.customers.push({id:"customer-fixture",code:"C-TEST",name:"عميل اختبار",phone:"",createdAt:new Date().toISOString()});
  state.inventoryItems.push({id:"legacy-stock-fixture",name:"مخزون افتتاحي",sku:"LEGACY",karat:"21",weight:4,quantity:1,minimum:0,createdAt:new Date().toISOString()});
  state.inventoryMovements.push({id:"legacy-receipt-fixture",itemId:"legacy-stock-fixture",direction:"in",quantity:1,date:new Date().toISOString(),notes:"رصيد قديم"});
  state.inventoryLots.push({id:"legacy-lot-fixture",itemId:"legacy-stock-fixture",receivedAt:"2025-01-01T00:00:00.000Z",quantityReceived:1,quantityRemaining:1,unitCost:null,unitMakingCost:null,legacy:true});
  state.inventoryItems.push({id:"stock-fixture",name:"خاتم اختبار",sku:"TEST",karat:"21",weight:5,quantity:2,minimum:0,createdAt:new Date().toISOString()});
  state.inventoryMovements.push({id:"receipt-fixture",itemId:"stock-fixture",direction:"in",quantity:2,date:new Date().toISOString(),notes:"استلام اختبار"});
  state.inventoryLots.push({id:"lot-fixture",itemId:"stock-fixture",receivedAt:"2026-01-01T00:00:00.000Z",quantityReceived:2,quantityRemaining:2,unitCost:1000,unitMakingCost:50});
  state.transactions.push({id:"sale-fixture",number:"TX-TEST",customerId:"customer-fixture",type:"sell",status:"approved",date:new Date().toISOString(),amount:1800,paid:1800,weight:5,karat:"21",items:[{name:"خاتم اختبار",karat:"21",weight:5,quantity:1,subtotal:1800,tax:0,total:1800,inventoryItemId:"stock-fixture"}]});
  r=await request("/api/state","PUT",{version:state.version,state},managerCookie);assert.equal(r.response.status,200,r.json.error);assert.equal(r.json.state.inventoryItems.find(i=>i.id==="stock-fixture").quantity,1);
  r=await request("/api/inventory-lots/legacy-lot-fixture/cost","PUT",{unitCost:1100,unitMakingCost:30},managerCookie);assert.equal(r.response.status,200);r=await request("/api/inventory-lots/legacy-lot-fixture/cost","PUT",{unitCost:1},managerCookie);assert.equal(r.response.status,409);
  let legacySaleState=(await request("/api/state","GET",undefined,managerCookie)).json;legacySaleState.transactions.push({id:"legacy-sale-fixture",number:"TX-LEGACY",customerId:"customer-fixture",type:"sell",status:"approved",date:new Date().toISOString(),amount:1600,paid:1600,weight:4,karat:"21",items:[{name:"مخزون افتتاحي",karat:"21",weight:4,quantity:1,subtotal:1600,tax:0,total:1600,inventoryItemId:"legacy-stock-fixture"}]});r=await request("/api/state","PUT",{version:legacySaleState.version,state:legacySaleState},managerCookie);assert.equal(r.response.status,200,r.json.error);
  r=await request("/api/profit-report","GET",undefined,managerCookie);assert.equal(r.response.status,200);assert.equal(r.json.eligibleProfit,1220);assert.equal(r.json.eligibleCount,2);

  r=await request("/api/pieces","POST",{name:"صورة غير صالحة",weight:1,karat:"21",image:"data:image/png;base64,AA=="},managerCookie);assert.equal(r.response.status,400);
  r=await request("/api/pieces","POST",{name:"قطعة اختبار",weight:2.5,karat:"21",source:"مورد اختبار",unitCost:1150,unitMakingCost:50},managerCookie);assert.equal(r.response.status,201);const piece=r.json.piece;assert.match(piece.serial,/^AZ-\d{8}-\d{4}$/);
  r=await request("/api/pieces/"+piece.id,"PATCH",{action:"sell",customerName:"عميل الاختبار"},managerCookie);assert.equal(r.response.status,409);
  r=await request("/api/audit","GET",undefined,managerCookie);const auditCount=r.json.entries.length;
  let invalidSaleState=(await request("/api/state","GET",undefined,managerCookie)).json;invalidSaleState.customers.push({id:"rolled-back-customer",code:"C-ROLLBACK",name:"عميل يجب التراجع عنه",createdAt:new Date().toISOString()});invalidSaleState.transactions.push({id:"bad-serial-sale",number:"TX-BAD-SERIAL",type:"sell",status:"approved",date:new Date().toISOString(),amount:10,items:[{name:"قطعة",quantity:1,subtotal:10,tax:0,total:10,serialPieceId:"piece-does-not-exist"}]});r=await request("/api/state","PUT",{version:invalidSaleState.version,state:invalidSaleState},managerCookie);assert.equal(r.response.status,400);r=await request("/api/state","GET",undefined,managerCookie);assert.equal(r.json.customers.some(c=>c.id==="rolled-back-customer"),false);r=await request("/api/audit","GET",undefined,managerCookie);assert.equal(r.json.entries.length,auditCount);
  let serialSaleState=(await request("/api/state","GET",undefined,managerCookie)).json;serialSaleState.transactions.push({id:"serial-sale-fixture",number:"TX-SERIAL",customerId:"customer-fixture",type:"sell",status:"approved",date:new Date().toISOString(),amount:2000,paid:2000,weight:2.5,karat:"21",items:[{name:piece.name,karat:"21",weight:2.5,quantity:1,subtotal:2000,tax:0,total:2000,serialPieceId:piece.id}]});r=await request("/api/state","PUT",{version:serialSaleState.version,state:serialSaleState},managerCookie);assert.equal(r.response.status,200,r.json.error);
  r=await request("/api/advanced","GET",undefined,managerCookie);assert.equal(r.json.pieces.find(p=>p.id===piece.id).status,"sold");
  r=await request("/api/profit-report","GET",undefined,managerCookie);assert.equal(r.json.eligibleProfit,2020);assert.equal(r.json.eligibleCount,3);
  r=await request("/api/pieces","POST",{name:"قطعة بديلة",weight:2.6,karat:"21",unitCost:900},managerCookie);assert.equal(r.response.status,201);const replacement=r.json.piece;
  let replacementState=(await request("/api/state","GET",undefined,managerCookie)).json;replacementState.transactions.push({id:"replacement-sale-fixture",number:"TX-REPLACEMENT",customerId:"customer-fixture",type:"sell",status:"approved",date:new Date().toISOString(),amount:1800,paid:1800,weight:2.6,karat:"21",items:[{name:replacement.name,karat:"21",weight:2.6,quantity:1,subtotal:1800,tax:0,total:1800,serialPieceId:replacement.id}]});r=await request("/api/state","PUT",{version:replacementState.version,state:replacementState},managerCookie);assert.equal(r.response.status,200,r.json.error);
  r=await request("/api/pieces/"+piece.id,"PATCH",{action:"return-request",reason:"فحص"},managerCookie);assert.equal(r.response.status,200);r=await request("/api/pieces/"+piece.id,"PATCH",{action:"return-approve",replacementSerial:replacement.serial},managerCookie);assert.equal(r.response.status,200);assert.equal(r.json.piece.status,"in-stock");r=await request("/api/advanced","GET",undefined,managerCookie);assert.ok(r.json.pieces.find(p=>p.id===replacement.id).history.some(h=>h.type==="exchange-linked"));

  r=await request("/api/manufacturing-orders","POST",{customerName:"عميل تصنيع",specification:"خاتم مخصص",totalPrice:5000,deposit:1000,workshop:"ورشة اختبار",workshopMakingCost:300},managerCookie);assert.equal(r.response.status,201);assert.equal(r.json.order.remaining,4000);const orderId=r.json.order.id;
  r=await request("/api/manufacturing-orders/"+orderId,"PATCH",{status:"ready"},managerCookie);assert.equal(r.response.status,409);
  r=await request("/api/manufacturing-orders/"+orderId,"PATCH",{status:"in-progress"},managerCookie);assert.equal(r.response.status,200);
  r=await request("/api/pledges","POST",{customerName:"عميل رهن",amount:2000,weight:3,karat:"21",date:"2026-10-11",dueDate:"2026-10-12"},managerCookie);assert.equal(r.response.status,201);assert.equal(r.json.pledge.totalDue,2000);const pledgeId=r.json.pledge.id;r=await request("/api/advanced","GET",undefined,managerCookie);assert.ok(r.json.alerts.some(a=>a.type==="pledge-due"&&a.details.pledgeId===pledgeId));
  r=await request("/api/backups","POST",{},managerCookie);assert.equal(r.response.status,201);const backup=JSON.parse(fs.readFileSync(path.join(dir,"backups",r.json.name),"utf8"));assert.ok(backup.pieces.length);assert.ok(backup.manufacturingOrders.length);assert.ok(backup.pledges.length);
});
