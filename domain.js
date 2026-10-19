"use strict";

function fifoConsume(lots, itemId, quantity) {
  const remaining = lots.map(lot => ({ ...lot }));
  let left = Math.max(0, Number(quantity) || 0), cost = 0, knownQuantity = 0;
  const layers = [];
  const eligible = remaining.filter(lot => lot.itemId === itemId && Number(lot.quantityRemaining) > 0)
    .sort((a, b) => String(a.receivedAt || a.createdAt || "").localeCompare(String(b.receivedAt || b.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
  for (const lot of eligible) {
    if (left <= 0) break;
    const take = Math.min(left, Number(lot.quantityRemaining));
    const unitCost = Number(lot.unitCost), unitMakingCost = Number(lot.unitMakingCost) || 0;
    const known = lot.unitCost != null && Number.isFinite(unitCost) && unitCost >= 0;
    lot.quantityRemaining = Number((Number(lot.quantityRemaining) - take).toFixed(6));
    left = Number((left - take).toFixed(6));
    if (known) { cost += take * (unitCost + unitMakingCost); knownQuantity += take; }
    layers.push({ lotId: lot.id, quantity: take, unitCost: known ? unitCost : null, unitMakingCost: known ? unitMakingCost : null });
  }
  return { lots: remaining, cost: Number(cost.toFixed(2)), knownQuantity, consumed: Number((quantity - left).toFixed(6)), shortfall: Number(left.toFixed(6)), completeCost: left <= 0 && knownQuantity >= quantity, layers };
}

function reorderSuggestion({ quantity, minimum = 0, movements = [], periodDays = 30, leadDays = 7, safetyDays = 7, now = Date.now() }) {
  const days = Math.max(1, Math.floor(Number(periodDays) || 30));
  const start = now - days * 86400000;
  const sold = movements.filter(m => m.direction === "out" && Date.parse(m.date) >= start && Date.parse(m.date) <= now).reduce((sum, m) => sum + Math.max(0, Number(m.quantity) || 0), 0);
  const daily = sold / days;
  const target = Math.ceil(daily * (Math.max(0, Number(leadDays) || 0) + Math.max(0, Number(safetyDays) || 0)) + Math.max(0, Number(minimum) || 0));
  return { soldInPeriod: sold, dailyRate: Number(daily.toFixed(3)), suggestedOrder: Math.max(0, target - Math.max(0, Number(quantity) || 0)), periodDays: days };
}

function transactionProfit(transaction) {
  if (!transaction || transaction.status === "cancelled" || transaction.type !== "sell") return { eligible: false, reason: "ليست عملية بيع معتمدة", profit: null };
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  if (!items.length) return { eligible: false, reason: "لا توجد أصناف مسجلة في الفاتورة", profit: null, items: [] };
  const gross = items.reduce((sum, item) => sum + (Number(item.total) || ((Number(item.subtotal) || 0) + (Number(item.tax) || 0))), 0);
  const charged = Number(transaction.amount) > 0 ? Math.min(Number(transaction.amount), gross || Number(transaction.amount)) : gross;
  const chargeFactor = gross > 0 ? charged / gross : 1;
  const itemRows = items.map(item => {
    const complete = item.inventoryCost?.completeCost === true;
    const subtotal = Number(item.subtotal) || 0, tax = Number(item.tax) || 0, cost = Number(item.inventoryCost?.cost) || 0;
    const netSubtotal = subtotal * chargeFactor, netTax = tax * chargeFactor;
    return { name: String(item.name || "صنف غير معروف"), quantity: Number(item.quantity) || 1, eligible: complete, reason: complete ? "تكلفة FIFO مكتملة" : "تكلفة هذا الصنف غير مكتملة", profit: complete ? Number((netSubtotal - netTax - cost).toFixed(2)) : null, revenueBeforeTax: Number(netSubtotal.toFixed(2)), tax: Number(netTax.toFixed(2)), cost: complete ? Number(cost.toFixed(2)) : null };
  });
  if (itemRows.some(item => !item.eligible)) return { eligible: false, reason: "لا توجد تكلفة FIFO موثقة لجميع أصناف الفاتورة", profit: null, items: itemRows };
  const subtotal = itemRows.reduce((sum, item) => sum + item.revenueBeforeTax, 0);
  const tax = itemRows.reduce((sum, item) => sum + item.tax, 0);
  const cost = itemRows.reduce((sum, item) => sum + item.cost, 0);
  return { eligible: true, reason: "تكلفة FIFO مكتملة", profit: Number((subtotal - tax - cost).toFixed(2)), revenueBeforeTax: Number(subtotal.toFixed(2)), tax: Number(tax.toFixed(2)), cost: Number(cost.toFixed(2)), items: itemRows };
}

function hotp(secret, counter) {
  const key = Buffer.from(secret, "hex"), msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = require("node:crypto").createHmac("sha1", key).update(msg).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

function verifyTotp(secret, code, now = Date.now()) {
  const value = String(code || "").replace(/\s/g, "");
  if (!/^[0-9]{6}$/.test(value)) return false;
  const step = Math.floor(now / 30000);
  return [-1, 0, 1].some(offset => hotp(secret, step + offset) === value);
}

module.exports = { fifoConsume, reorderSuggestion, transactionProfit, hotp, verifyTotp };
