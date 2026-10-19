"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {fifoConsume,reorderSuggestion,transactionProfit,hotp,verifyTotp}=require("../domain");

test("FIFO takes the oldest received lot first and snapshots all cost layers",()=>{
  const result=fifoConsume([
    {id:"old",itemId:"ring",receivedAt:"2026-01-01",quantityRemaining:2,unitCost:100,unitMakingCost:10},
    {id:"new",itemId:"ring",receivedAt:"2026-02-01",quantityRemaining:2,unitCost:150,unitMakingCost:0}
  ],"ring",3);
  assert.equal(result.cost,370);
  assert.equal(result.completeCost,true);
  assert.deepEqual(result.layers.map(x=>x.lotId),["old","new"]);
  assert.deepEqual(result.lots.map(x=>x.quantityRemaining),[0,1]);
});

test("FIFO does not claim a complete cost when a legacy lot has no cost",()=>{
  const result=fifoConsume([{id:"legacy",itemId:"x",quantityRemaining:2,unitCost:null}], "x", 1);
  assert.equal(result.consumed,1);
  assert.equal(result.completeCost,false);
});

test("reorder suggestion uses only dated outbound movements in the selected period",()=>{
  const now=Date.parse("2026-10-12T12:00:00Z");
  const result=reorderSuggestion({quantity:3,minimum:2,periodDays:10,leadDays:5,safetyDays:2,now,movements:[
    {direction:"out",quantity:20,date:"2026-10-08T12:00:00Z"},
    {direction:"in",quantity:5,date:"2026-10-08T12:00:00Z"},
    {direction:"out",quantity:100,date:"2026-09-01T12:00:00Z"}
  ]});
  assert.equal(result.dailyRate,2);
  assert.equal(result.suggestedOrder,13);
});

test("profit is reported only for fully costed approved sales",()=>{
  assert.deepEqual(transactionProfit({type:"sell",status:"approved",items:[{subtotal:1000,tax:100,inventoryCost:{cost:650,completeCost:true}}]}),{
    eligible:true,reason:"تكلفة FIFO مكتملة",profit:250,revenueBeforeTax:1000,tax:100,cost:650,items:[{name:"صنف غير معروف",quantity:1,eligible:true,reason:"تكلفة FIFO مكتملة",profit:250,revenueBeforeTax:1000,tax:100,cost:650}]
  });
  assert.equal(transactionProfit({type:"sell",items:[{subtotal:1000}]}).eligible,false);
  const partial=transactionProfit({type:"sell",items:[{name:"موثق",quantity:1,subtotal:1000,inventoryCost:{cost:500,completeCost:true}},{name:"قديم",quantity:1,subtotal:700}]});
  assert.equal(partial.eligible,false);
  assert.equal(partial.items[0].profit,500);
  assert.equal(partial.items[1].profit,null);
  const discounted=transactionProfit({type:"sell",amount:990,items:[{name:"صنف بخصم",quantity:1,subtotal:1000,tax:100,total:1100,inventoryCost:{cost:650,completeCost:true}}]});
  assert.equal(discounted.profit,160);
  assert.equal(discounted.items[0].revenueBeforeTax,900);
  assert.equal(discounted.items[0].tax,90);
  assert.equal(transactionProfit({type:"buy",items:[]}).profit,null);
});

test("TOTP accepts the current window and rejects malformed or incorrect codes",()=>{
  const secret="0123456789abcdef0123456789abcdef01234567",now=Date.parse("2026-10-12T18:00:00Z"),code=hotp(secret,Math.floor(now/30000));
  assert.equal(verifyTotp(secret,code,now),true);
  assert.equal(verifyTotp(secret,"12345",now),false);
  assert.equal(verifyTotp(secret,"000000",now),false);
});
