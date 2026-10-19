(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const money = (n) => `${Number(n || 0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} ج.م`;
  const grams = (n) => `${Number(n || 0).toLocaleString("en-US",{minimumFractionDigits:3,maximumFractionDigits:3})} جم`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const dateText = (s) => { if (!s) return "—"; const d = new Date(s); return Number.isNaN(d.getTime()) ? esc(s) : d.toLocaleString("ar-EG",{dateStyle:"short",timeStyle:"short"}); };
  const can = permission => !!(currentUser && (currentUser.role === "manager" || (((currentUser.permissions || []).includes(permission) || (permission==="vault:view"&&(currentUser.permissions||[]).includes("vault:edit"))) && (!currentUser.permissionsExpiresAt || Date.parse(currentUser.permissionsExpiresAt) > Date.now()))));
  const typeNames = {
    sell:"بيع ذهب للعميل", buy:"شراء ذهب من العميل", payment:"تحصيل من العميل",
    "cash-deposit":"إيداع نقدي للعميل", "cash-refund":"رد مبلغ للعميل",
    "gold-deposit":"إضافة ذهب لحساب العميل", "gold-delivery":"تسليم ذهب للعميل",
    "opening-money":"رصيد مالي افتتاحي", "opening-gold":"رصيد ذهب افتتاحي", adjustment:"تسوية مالية"
  };
  let data = { customers: [], transactions: [], inventoryItems:[], inventoryMovements:[], inventoryLots:[], nextCustomer: 1, nextTransaction: 1, settings:{branchName:"الفرع الرئيسي",goldPrice24:0,makingPerGram:0,taxRate:0,buySpreadPerGram:50,bullionCashbackPerGram:0,stampPerGram:13,paymentMethods:[],employeeDaysOff:{},printBrand:{arabicName:"العزيز بالله",englishName:"AL-AZIZ BELLAH",tagline:"JEWELRY",address:"",phones:"",footerNote:"",logoDataUrl:"",qrDataUrl:""}} };
  let goldPriceState={mode:"auto",prices:null,automaticPrices:null,updatedAt:null,error:""},goldPriceLoading=null,goldPriceFormDirty=false;
  let stateVersion = 0, currentUser = null, usersCache = [], savingData = false, auditCache=[],calcLines=[],pendingInvoiceLines=[],paymentMethodEditingId=null,staffRoster=[],staffScheduleDraft={},staffScheduleDirty=false,printBrandDraft=null,printBrandDirty=false,sessionIdleTimeoutMinutes=30,pendingCsvImport=[],pendingCsvImportType="customers";
  let branchesCache=[], currentBranchId="main";
  const arabicDigits="٠١٢٣٤٥٦٧٨٩";
  function westernDigits(value){return String(value??"").replace(/[٠-٩]/g,c=>String(arabicDigits.indexOf(c))).replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)));}
  function importHeaderKey(value){return westernDigits(value).normalize("NFKC").toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g,"").replace(/[\s_\-./\\()\[\]:]+/g,"").trim();}
  function csvRows(text,delimiter){const rows=[];let row=[],cell="",quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}else if(ch==='"'&&cell.length===0)quoted=true;else if(ch===delimiter){row.push(cell);cell="";}else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);row=[];cell="";}else cell+=ch;}if(cell.length||row.length){row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);}return rows;}
  function detectCsvDelimiter(text){const line=String(text).replace(/^\uFEFF/,"").split(/\r?\n/,1)[0]||"";let best=",",count=-1;for(const d of [",",";","\t"]){let n=0,quoted=false;for(let i=0;i<line.length;i++){if(line[i]==='"'&&line[i+1]==='"'){i++;continue;}if(line[i]==='"')quoted=!quoted;else if(line[i]===d&&!quoted)n++;}if(n>count){count=n;best=d;}}return best;}
  function importNumber(value){const normalized=westernDigits(value).replace(/[٬,]/g,"").replace(/٫/g,".").replace(/\s/g,"");return normalized===""?null:Number(normalized);}
  function parseCsvImport(text,type){text=String(text||"").replace(/^\uFEFF/,"");const rows=csvRows(text,detectCsvDelimiter(text));if(rows.length<2)throw new Error("يجب أن يحتوي الملف على صف عناوين وصف بيانات واحد على الأقل.");if(rows.length>5001)throw new Error("الحد الأقصى 5000 صف في الملف الواحد.");const aliases=type==="customers"?{name:["name","customer","customername","fullname","اسم العميل","اسم","الاسم"],phone:["phone","mobile","telephone","رقم الهاتف","الهاتف","موبايل","تليفون"],notes:["notes","note","ملاحظات","ملاحظة"]}:{name:["name","item","product","itemname","اسم الصنف","الصنف","المنتج","الاسم"],sku:["sku","code","itemcode","كود الصنف","كود","الباركود"],karat:["karat","carat","عيار","العيار"],weight:["weight","weightg","الوزن","الوزنجم","وزن"],quantity:["quantity","qty","الكمية","عدد"],minimum:["minimum","min","reorderlevel","حدالتنبيه","الحدالأدنى","حدإعادةالطلب"],unitCost:["unitcost","purchasecost","cost","تكلفةالشراءللوحدة","تكلفةالشراء","تكلفةالوحدة"],unitMakingCost:["unitmakingcost","makingcost","manufacturingcost","مصنعيةالوحدة","مصنعيةالقطعة","تكلفةالتصنيع"]};const headers=rows[0].map(importHeaderKey),columns=Object.fromEntries(Object.entries(aliases).map(([field,names])=>[field,headers.findIndex(h=>names.some(alias=>importHeaderKey(alias)===h))])),required=type==="customers"?["name"]:["name","karat","weight","quantity"],missing=required.filter(k=>columns[k]<0);if(missing.length)throw new Error("عناوين أعمدة غير موجودة: "+missing.join("، ")+". نزّل القالب المناسب لتتعرف على أسماء الأعمدة.");const seen=new Set(),existingCustomers=new Set((data.customers||[]).map(c=>{const phone=westernDigits(c.phone||"").replace(/\D/g,"");return phone?"p:"+phone:"n:"+importHeaderKey(c.name);})),existingSkus=new Set((data.inventoryItems||[]).map(i=>importHeaderKey(i.sku||"")).filter(Boolean)),result=[];for(let i=1;i<rows.length;i++){const cells=rows[i],get=k=>columns[k]>=0?String(cells[columns[k]]??"").trim():"",value={};let issues=[];if(type==="customers"){value.name=get("name");value.phone=get("phone");value.notes=get("notes");if(value.name.length<2||value.name.length>100)issues.push("اسم العميل مطلوب (2–100 حرف).");if(value.phone.length>30)issues.push("رقم الهاتف أطول من المسموح.");const phone=westernDigits(value.phone).replace(/\D/g,""),key=phone?"p:"+phone:"n:"+importHeaderKey(value.name);if(!issues.length&&(existingCustomers.has(key)||seen.has(key)))issues.push("عميل مكرر بالاسم أو الهاتف.");if(!issues.length)seen.add(key);}else{value.name=get("name");value.sku=get("sku");value.karat=westernDigits(get("karat")).replace(/^عيار\s*/i,"").replace(/\s*k$/i,"");value.weight=importNumber(get("weight"));value.quantity=importNumber(get("quantity"));value.minimum=get("minimum")===""?0:importNumber(get("minimum"));value.unitCost=get("unitCost")===""?null:importNumber(get("unitCost"));value.unitMakingCost=get("unitMakingCost")===""?0:importNumber(get("unitMakingCost"));if(value.name.length<2||value.name.length>100)issues.push("اسم الصنف مطلوب (2–100 حرف).");if(!/^(24|22|21|18|14|9)$/.test(value.karat))issues.push("العيار يجب أن يكون 24 أو 22 أو 21 أو 18 أو 14 أو 9.");if(!Number.isFinite(value.weight)||value.weight<=0)issues.push("الوزن يجب أن يكون أكبر من صفر.");if(!Number.isInteger(value.quantity)||value.quantity<0)issues.push("الكمية يجب أن تكون عددًا صحيحًا غير سالب.");if(!Number.isInteger(value.minimum)||value.minimum<0)issues.push("حد التنبيه يجب أن يكون عددًا صحيحًا غير سالب.");if(value.quantity>0&&(!Number.isFinite(value.unitCost)||value.unitCost<0))issues.push("تكلفة الشراء للوحدة مطلوبة عند وجود كمية.");if(value.unitCost!==null&&(!Number.isFinite(value.unitCost)||value.unitCost<0))issues.push("تكلفة الشراء غير صالحة.");if(!Number.isFinite(value.unitMakingCost)||value.unitMakingCost<0)issues.push("المصنعية يجب أن تكون صفرًا أو أكبر.");const skuKey=importHeaderKey(value.sku),key=skuKey?"sku:"+skuKey:"";if(!issues.length&&key&&(existingSkus.has(skuKey)||seen.has(key)))issues.push("كود الصنف مكرر.");if(!issues.length&&key)seen.add(key);}result.push({row:i+1,value,issues,status:issues.length?"skip":"ready"});}return result;}
  function renderCsvImportPreview(){const rows=pendingCsvImport,ready=rows.filter(x=>x.status==="ready").length,skipped=rows.length-ready,summary=$("csv-import-summary"),body=$("csv-import-rows"),button=$("csv-import-apply");if(!rows.length){summary.textContent="اختر نوع البيانات ثم ملف CSV لمعاينته.";body.innerHTML='<tr><td colspan="3" class="empty">لا توجد معاينة بعد.</td></tr>';button.disabled=true;return;}summary.textContent=`إجمالي الصفوف: ${rows.length} · جاهز للاستيراد: ${ready} · مستبعد بسبب تكرار أو خطأ: ${skipped}. تظهر أول 200 صف في المعاينة.`;const shown=rows.slice(0,200);body.innerHTML=shown.map(x=>{const detail=Object.values(x.value).filter(v=>v!==null&&v!=="").map(v=>esc(v)).join(" · ");return`<tr class="csv-row-${x.status}"><td>${x.row}</td><td>${detail||"—"}</td><td>${esc(x.status==="ready"?"جاهز للإضافة":x.issues.join(" "))}</td></tr>`;}).join("");button.disabled=ready===0;button.textContent=`اعتماد ${ready} صف صالح وإضافتها`;}
  async function api(url, options={}) {
    const response = await fetch(url, { credentials:"same-origin", ...options, headers:{"Content-Type":"application/json", ...(options.headers||{})} });
    const result = await response.json().catch(()=>({}));
    if (!response.ok) { const error = new Error(result.error || "تعذر الاتصال بالخادم."); error.status=response.status; throw error; }
    return result;
  }
  async function save() {
    savingData=true;
    try {
      const result=await api("/api/state",{method:"PUT",body:JSON.stringify({version:stateVersion,state:data,branchId:currentBranchId})});
      stateVersion=result.version;if(result.state)data={...data,...result.state};window.dispatchEvent(new CustomEvent("gca:data-saved"));return true;
    } catch(e) {
      if(e.status===409){alert(e.message);location.reload();return false;}
      toast(e.message || "تعذر حفظ البيانات على الخادم.");return false;
    } finally { savingData=false; }
  }
  function toast(msg) {
    const el = $("toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
  }
  function signedMoney(tx) {
    switch (tx.type) {
      case "sell": return Math.max(0, tx.amount - tx.paid) * -1; // remaining amount owed by customer
      case "buy": return Math.max(0, tx.amount - tx.paid); // amount held for customer
      case "payment": return -tx.amount; // collection reduces customer's debt
      case "cash-deposit": return tx.amount;
      case "cash-refund": return -tx.amount;
      case "opening-money": return tx.direction === "minus" ? -tx.amount : tx.amount;
      case "adjustment": return tx.direction === "minus" ? -tx.amount : tx.amount;
      default: return 0;
    }
  }
  function signedGold(tx) {
    if (tx.type === "gold-deposit") return Math.abs(tx.weight);
    if (tx.type === "gold-delivery") return -Math.abs(tx.weight);
    if (tx.type === "opening-gold") return tx.direction === "minus" ? -Math.abs(tx.weight) : Math.abs(tx.weight);
    return 0;
  }
  function approved(tx) { return tx.status !== "cancelled"; }
  function customerBalance(customerId) {
    const txs = data.transactions.filter(t => t.customerId === customerId && approved(t));
    const financial = txs.reduce((sum,t) => sum + signedMoney(t), 0);
    const gold = {};
    txs.forEach(t => { const change = signedGold(t); if (change) gold[t.karat] = (gold[t.karat] || 0) + change; });
    return { financial, gold };
  }
  function allGoldTotals() {
    const totals = {};
    data.customers.forEach(c => Object.entries(customerBalance(c.id).gold).forEach(([k,v]) => { if (v > 0) totals[k] = (totals[k] || 0) + v; }));
    return totals;
  }
  function renderDashboard() {
    let dueCustomers = 0, dueShop = 0;
    data.customers.forEach(c => { const b = customerBalance(c.id).financial; if (b > 0) dueCustomers += b; else dueShop += Math.abs(b); });
    $("owed-customers").textContent = money(dueCustomers);
    $("owed-shop").textContent = money(dueShop);
    const gold = allGoldTotals();
    $("gold-customers").textContent = Object.values(gold).reduce((a,b)=>a+b,0).toLocaleString("en-US",{minimumFractionDigits:3,maximumFractionDigits:3}) + " جم";
    $("customer-count").textContent = data.customers.length.toLocaleString("en-US");
    const rows = [...data.transactions].filter(approved).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
    $("recent-rows").innerHTML = rows.length ? rows.map(t => {
      const c = data.customers.find(x=>x.id===t.customerId);
      const sm = signedMoney(t), sg = signedGold(t);
      return `<tr><td>${dateText(t.date)}</td><td>${esc(c?.name || "عميل محذوف")}</td><td>${esc(typeNames[t.type]||t.type)}</td><td class="${sm>0?'positive':sm<0?'negative':''}">${sm===0?'—':(sm>0?'+':'')+money(sm)}</td><td>${sg===0?'—':`${sg>0?'+':''}${grams(sg)} عيار ${esc(t.karat)}`}</td><td><span class="pill">معتمدة</span></td></tr>`;
    }).join("") : `<tr><td colspan="6" class="empty">لا توجد حركات حتى الآن.</td></tr>`;
  }
  function renderCustomerOptions() {
    const currentCustomer=$("tx-customer").value;
    const options = data.customers.slice().sort((a,b)=>a.name.localeCompare(b.name,'ar')).map(c=>`<option value="${c.id}">${esc(c.name)} — ${esc(c.code)}</option>`).join("");
    $("tx-customer").innerHTML = `<option value="">اختر العميل</option>${options}`;
    if(data.customers.some(c=>c.id===currentCustomer)) $("tx-customer").value=currentCustomer;
    const current = $("ledger-customer").value;
    $("ledger-customer").innerHTML = `<option value="">كل العملاء</option>${options}`;
    if (data.customers.some(c=>c.id===current)) $("ledger-customer").value=current;
  }
  function renderCustomers() {
    const q = $("customer-search").value.trim().toLowerCase();
    const customers = data.customers.filter(c => `${c.name} ${c.phone} ${c.code}`.toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'ar'));
    $("customer-rows").innerHTML = customers.length ? customers.map(c => {
      const b=customerBalance(c.id);
      const goldText=Object.entries(b.gold).filter(([,v])=>Math.abs(v)>0.0000001).map(([k,v])=>`${grams(v)} عيار ${k}`).join("، ") || "—";
      return `<tr><td>${esc(c.code)}</td><td class="customer-name">${esc(c.name)}</td><td>${esc(c.phone||"—")}</td><td class="${b.financial>0?'positive':b.financial<0?'negative':''}">${money(b.financial)}</td><td>${esc(goldText)}</td><td><button class="small-btn" data-customer-ledger="${c.id}">كشف الحساب</button></td></tr>`;
    }).join("") : `<tr><td colspan="6" class="empty">لا يوجد عملاء مطابقون. أضف عميلًا جديدًا.</td></tr>`;
  }
  function renderLedger() {
    const customerId=$("ledger-customer").value;
    const from=$("ledger-from").value, to=$("ledger-to").value;
    const query=$("ledger-search").value.trim().toLowerCase();
    let txs=data.transactions.filter(t=>!customerId||t.customerId===customerId);
    if(from) txs=txs.filter(t=>t.date.slice(0,10)>=from);
    if(to) txs=txs.filter(t=>t.date.slice(0,10)<=to);
    if(query)txs=txs.filter(t=>{const c=data.customers.find(x=>x.id===t.customerId);return `${t.number} ${t.notes||""} ${c?.name||""} ${c?.phone||""} ${t.createdBy?.name||""} ${typeNames[t.type]||t.type}`.toLowerCase().includes(query);});
    txs.sort((a,b)=>b.date.localeCompare(a.date));
    $("ledger-rows").innerHTML=txs.length?txs.map(t=>{
      const c=data.customers.find(x=>x.id===t.customerId), sm=signedMoney(t), sg=signedGold(t), cancelled=t.status==="cancelled";
      const actor=cancelled&&t.cancelledBy?`${t.createdBy?.name||"غير معروف"} / ${t.cancelledBy.name}`:t.createdBy?.name||"—";
      const canCancel=can("transactions:cancel");
      return `<tr><td>${esc(t.number)}</td><td>${dateText(t.date)}</td><td>${esc(c?.name||"عميل غير معروف")}</td><td>${esc(typeNames[t.type]||t.type)}${cancelled?' <span class="pill red">ملغاة</span>':''}</td><td class="${sm>0?'positive':sm<0?'negative':''}">${sm===0?'—':(sm>0?'+':'')+money(sm)}</td><td>${sg===0?'—':`${sg>0?'+':''}${grams(sg)} عيار ${esc(t.karat)}`}</td><td>${esc(actor)}</td><td>${esc(t.notes||"—")}</td><td class="row-actions"><button class="small-btn" data-print-tx="${t.id}">إيصال</button>${cancelled||!canCancel?'':`<button class="small-btn" data-cancel="${t.id}">إلغاء</button>`}</td></tr>`;
    }).join(""):`<tr><td colspan="9" class="empty">لا توجد حركات في الفترة المحددة.</td></tr>`;
  }
  function renderAll() { renderCustomerOptions(); renderCustomers(); renderLedger(); renderDashboard(); }
  async function renderUsers() {
    // fill branch dropdown in user creation form
    const branchSel=$("user-branch");
    if(branchSel&&branchesCache.length){
      const savedVal=branchSel.value;
      branchSel.innerHTML=branchesCache.filter(b=>b.active).map(b=>`<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
      branchSel.value=savedVal||currentBranchId;
    }
    if(currentUser?.role!=="manager") return;
    try {
      const result=await api("/api/users"); usersCache=result.users;
      const permissions=[["customers:create","إضافة عملاء"],["transactions:create","تسجيل الحركات"],["transactions:cancel","إلغاء الحركات"],["inventory:view","عرض المخزون"],["inventory:edit","تعديل المخزون"],["reports:view","عرض التقارير"],["backup:export","تصدير نسخة"],["vault:view","عرض مطابقة الخزنة"],["vault:edit","تعديل مطابقة الخزنة"]];
      const branchName=id=>{const b=branchesCache.find(x=>x.id===id);return b?esc(b.name):esc(id||"الرئيسي");};
      $("user-rows").innerHTML=usersCache.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${u.role==="manager"?"مدير":"موظف"}</td><td>${branchName(u.branchId)}</td><td><span class="pill ${u.active?"":"red"}">${u.active?"نشط":"معطّل"}</span></td><td>${u.role==="employee"?`<div class="row-actions"><button class="small-btn" data-toggle-user="${u.id}" data-active="${u.active}">${u.active?"تعطيل":"تفعيل"}</button><button class="small-btn" data-reset-password="${u.id}">إعادة كلمة المرور</button><details><summary>الصلاحيات</summary><div class="permission-list">${permissions.map(([key,label])=>`<label><input type="checkbox" data-user-permission="${u.id}" value="${key}" ${(u.permissions||[]).includes(key)?"checked":""}> ${label}</label>`).join("")}</div></details></div>`:"—"}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">لا يوجد مستخدمون.</td></tr>`;
    } catch(e) { toast(e.message); }
  }
  function printBrand(){return{arabicName:"العزيز بالله",englishName:"AL-AZIZ BELLAH",tagline:"JEWELRY",address:"",phones:"",footerNote:"",...(data.settings?.printBrand||{})};}
  function inventoryPicture(itemId){const image=data.inventoryItems.find(x=>x.id===itemId)?.image||(data.serialPieces||[]).find(x=>x.id===itemId)?.image;return image?`<img class="print-item-image" src="${esc(image)}" alt="صورة الصنف">`:"—";}
  function printDocument(title,content){const area=$("print-area"),b=printBrand(),logo=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.logoDataUrl||"")?`<img class="print-brand-logo" src="${esc(b.logoDataUrl)}" alt="">`:'<span class="print-brand-seal" aria-hidden="true">◆</span>',contact=[b.address,b.phones].filter(Boolean).map(esc).join(" · "),qr=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.qrDataUrl||"")?`<img class="print-brand-qr" src="${esc(b.qrDataUrl)}" alt="رمز QR">`:"",footer=[contact?`<div class="print-brand-contact">${contact}</div>`:"",b.footerNote?`<div class="print-brand-note">${esc(b.footerNote)}</div>`:""].filter(Boolean).join(""),requestedTemplate=data.settings?.printTemplate,template=["compact","minimal"].includes(requestedTemplate)?requestedTemplate:"classic";
    area.innerHTML=`<article class="print-sheet print-template-${template}" dir="rtl" data-watermark="${esc(b.arabicName||"")}"><header class="print-brand-header">${logo}<div class="print-brand-copy"><strong class="print-brand-ar">${esc(b.arabicName||"اسم المحل")}</strong>${b.englishName?`<span class="print-brand-en" dir="ltr">${esc(b.englishName)}</span>`:""}${b.tagline?`<small>${esc(b.tagline)}</small>`:""}</div><div class="print-doc-meta"><h1>${esc(title)}</h1><span>${esc(data.settings?.branchName||"الفرع الرئيسي")}</span><time>${dateText(new Date().toISOString())}</time></div></header><main class="print-content">${content}</main>${footer||qr?`<footer class="print-brand-footer">${qr}<div>${footer}</div></footer>`:""}</article>`;area.hidden=false;window.addEventListener("afterprint",()=>{area.hidden=true;area.innerHTML=""},{once:true});window.print();}
  function printReceipt(id){const t=data.transactions.find(x=>x.id===id);if(!t)return;const c=data.customers.find(x=>x.id===t.customerId),sm=signedMoney(t),sg=signedGold(t),gold=t.weight>0?`${grams(t.weight)} عيار ${esc(t.karat)}`:"—",amount=Number(t.amount||0),isInvoice=["sell","buy"].includes(t.type),paid=isInvoice?Number(t.paid||0):t.type==="payment"?amount:0,remaining=isInvoice?Math.max(0,amount-paid):0,description=t.notes||typeNames[t.type]||t.type,items=Array.isArray(t.items)?t.items:[];
    const rows=items.length?items.map((line,i)=>`<tr><td>${i+1}</td><td>${inventoryPicture(line.inventoryItemId||line.serialPieceId)}</td><td>${esc(line.name||description)}</td><td>${esc(line.karat||t.karat)}</td><td>${Number(line.quantity)||1}</td><td>${calcGrams(Number(line.weight||0)*(Number(line.quantity)||1))}</td><td>${money(line.total||0)}</td></tr>`).join(""):`<tr><td>1</td><td>—</td><td>${esc(typeNames[t.type]||t.type)} · ${esc(description)}</td><td>${gold}</td><td>—</td><td>${t.weight>0?grams(t.weight):"—"}</td><td>${amount>0?money(amount):"—"}</td></tr>`;
    printDocument(`إيصال ${isInvoice?"فاتورة":"حركة"}`,`<section class="print-invoice-meta"><div><span>رقم الفاتورة</span><strong>${esc(t.number)}</strong></div><div><span>التاريخ</span><strong>${dateText(t.date)}</strong></div><div><span>اسم العميل</span><strong>${esc(c?.name||"عميل غير معروف")}</strong></div><div><span>هاتف العميل</span><strong>${esc(c?.phone||"—")}</strong></div><div><span>اسم البائع</span><strong>${esc(t.createdBy?.name||"—")}</strong></div><div><span>البيان</span><strong>${esc(description)}</strong></div></section><table class="print-invoice-table"><thead><tr><th>م</th><th>الصورة</th><th>الصنف / البيان</th><th>العيار</th><th>الكمية</th><th>الوزن</th><th>القيمة</th></tr></thead><tbody>${rows}</tbody></table><section class="print-total-grid"><div class="print-total-box"><span>إجمالي المبلغ</span><strong>${amount>0?money(amount):"—"}</strong></div><div><span>المدفوع / المحصّل</span><strong>${paid>0?money(paid):isInvoice?"غير مدفوع":"—"}</strong></div><div><span>المتبقي</span><strong>${remaining>0?money(remaining):"—"}</strong></div>${sm?`<div><span>الأثر على رصيد العميل</span><strong>${money(sm)}</strong></div>`:""}${sg?`<div><span>تغير رصيد الذهب</span><strong>${grams(sg)} عيار ${esc(t.karat)}</strong></div>`:""}</section><p class="print-sign">توقيع العميل: ____________________ <span>توقيع الموظف: ____________________</span></p>`);}
  function printStatement(){const customerId=$("ledger-customer").value;if(!customerId){toast("اختر عميلًا أولًا لطباعة كشف حسابه.");return;}const c=data.customers.find(x=>x.id===customerId);if(!c)return;const from=$("ledger-from").value,to=$("ledger-to").value;const txs=data.transactions.filter(t=>t.customerId===customerId&&(!from||t.date.slice(0,10)>=from)&&(!to||t.date.slice(0,10)<=to)).sort((a,b)=>a.date.localeCompare(b.date));const balance=customerBalance(c.id);const rows=txs.map(t=>`<tr><td>${esc(t.number)}</td><td>${dateText(t.date)}</td><td>${esc(typeNames[t.type]||t.type)}${t.status==="cancelled"?" (ملغاة)":""}</td><td>${signedMoney(t)?money(signedMoney(t)):"—"}</td><td>${signedGold(t)?`${grams(signedGold(t))} عيار ${esc(t.karat)}`:"—"}</td><td>${esc(t.createdBy?.name||"—")}</td></tr>`).join("");printDocument(`كشف حساب ${c.name}`,`<p>الهاتف: ${esc(c.phone||"—")} · الفترة: ${from||"البداية"} إلى ${to||"اليوم"}</p><p><strong>الرصيد الحالي: ${money(balance.financial)}</strong></p><p>رصيد الذهب: ${esc(Object.entries(balance.gold).map(([k,v])=>`${grams(v)} عيار ${k}`).join("، ")||"—")}</p><table><thead><tr><th>رقم</th><th>التاريخ</th><th>الحركة</th><th>الأثر المالي</th><th>الأثر الذهبي</th><th>الموظف</th></tr></thead><tbody>${rows}</tbody></table>`);}
  function renderInventory(){
    const canEdit=can("inventory:edit");$("inventory-edit-panel").hidden=!canEdit;
    const q=$("inventory-search").value.trim().toLowerCase(),items=data.inventoryItems||[];
    $("inventory-rows").innerHTML=items.filter(i=>`${i.name} ${i.sku||""} ${i.karat}`.toLowerCase().includes(q)).map(i=>{const lots=(data.inventoryLots||[]).filter(l=>l.itemId===i.id&&Number(l.quantityRemaining)>0),unknown=lots.filter(l=>l.unitCost==null);const cost=unknown.length?`${unknown.reduce((n,l)=>n+Number(l.quantityRemaining),0)} قطعة بلا تكلفة${currentUser?.role==="manager"?unknown.map(l=>`<button class="small-btn" data-set-lot-cost="${esc(l.id)}">تسجيل تكلفة افتتاحية</button>`).join(""):""}`:lots.length?`${lots.length} دفعة موثقة`:"—";return`<tr><td>${i.image?`<img class="piece-thumb" src="${esc(i.image)}" alt="">`:"—"}</td><td>${esc(i.sku||"—")}</td><td>${esc(i.name)}${i.quantity<=i.minimum?'<span class="pill red"> منخفض</span>':""}</td><td>${esc(i.karat)}</td><td>${grams(i.weight)}</td><td>${Number(i.quantity||0).toLocaleString("en-US")}</td><td>${cost}</td><td class="row-actions">${canEdit?`<button class="small-btn" data-stock="${i.id}" data-direction="in">استلام</button><button class="small-btn" data-stock="${i.id}" data-direction="out">صرف</button>`:"—"}</td></tr>`;}).join("")||`<tr><td colspan="8" class="empty">لا توجد أصناف مطابقة.</td></tr>`;
    $("inventory-movement-rows").innerHTML=(data.inventoryMovements||[]).slice().reverse().slice(0,20).map(m=>{const i=items.find(x=>x.id===m.itemId);return `<tr><td>${dateText(m.date)}</td><td>${esc(i?.name||"صنف محذوف")}</td><td>${m.direction==="in"?"استلام":"صرف"}</td><td>${m.quantity}</td><td>${esc(m.createdBy?.name||"—")}</td><td>${esc(m.notes||"—")}</td></tr>`;}).join("")||`<tr><td colspan="6" class="empty">لا توجد حركات مخزون.</td></tr>`;
  }
  let suppliersCache={suppliers:[],purchases:[],payments:[]},cashCloseCache=null;
  const localDay=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
  function renderSupplierSelects(){const optionList=suppliersCache.suppliers.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · مستحق ${money(s.balance)}</option>`).join("");["purchase-supplier","supplier-payment-supplier"].forEach(id=>{const el=$(id),selected=el.value;el.innerHTML=`<option value="">${id==="purchase-supplier"?"اختر المورد":"اختر موردًا"}</option>${optionList}`;if(suppliersCache.suppliers.some(s=>s.id===selected))el.value=selected;});}
  async function renderSuppliers(){if(currentUser?.role!=="manager")return;try{suppliersCache=await api("/api/suppliers");renderSupplierSelects();$("supplier-rows").innerHTML=suppliersCache.suppliers.map(s=>{const purchases=suppliersCache.purchases.filter(p=>p.supplierId===s.id).reduce((n,p)=>n+Number(p.totalCost||0),0),paid=suppliersCache.payments.filter(p=>p.supplierId===s.id).reduce((n,p)=>n+Number(p.amount||0),0);return`<tr><td>${esc(s.name)}</td><td>${esc(s.phone||"—")}</td><td>${money(purchases)}</td><td>${money(paid)}</td><td class="${s.balance>0?"negative":"positive"}">${money(s.balance)}</td></tr>`;}).join("")||'<tr><td colspan="5" class="empty">أضف أول مورد لبدء تسجيل المشتريات.</td></tr>';const entries=[...suppliersCache.purchases.map(p=>({kind:"purchase",date:p.date,supplier:p.supplierName,reference:p.invoiceNo||p.itemName,amount:p.totalCost,by:p.createdBy?.name})),...suppliersCache.payments.map(p=>({kind:"payment",date:p.date,supplier:suppliersCache.suppliers.find(s=>s.id===p.supplierId)?.name||"مورد محذوف",reference:p.note||p.paymentMethod,amount:p.amount,by:p.createdBy?.name}))].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,60);$("supplier-history-rows").innerHTML=entries.map(x=>`<tr><td>${dateText(x.date+"T12:00:00")}</td><td>${esc(x.supplier)}</td><td>${esc(x.reference||"—")}</td><td>${x.kind==="purchase"?"فاتورة شراء":"سداد"}</td><td>${money(x.amount)}</td><td>${esc(x.by||"—")}</td></tr>`).join("")||'<tr><td colspan="6" class="empty">لا توجد مشتريات أو مدفوعات بعد.</td></tr>';}catch(e){toast(e.message);}}
  function updatePurchasePreview(){const total=(Number($("purchase-unit-cost").value)||0)+(Number($("purchase-unit-making").value)||0);const amount=total*(Number($("purchase-quantity").value)||0),paid=Number($("purchase-paid").value)||0;$("purchase-total-preview").textContent=`إجمالي الشراء: ${money(amount)} · المتبقي للمورد: ${money(Math.max(0,amount-paid))}`;}
  function updateCashCloseDifference(){if(!cashCloseCache)return;const opening=Number($("cash-close-opening").value)||0,actualRaw=$("cash-close-actual").value,actual=Number(actualRaw),expected=opening+Number(cashCloseCache.summary.net||0),hasActual=actualRaw.trim()!==""&&Number.isFinite(actual);$("cash-close-expected").textContent=money(expected);$("cash-close-difference").textContent=hasActual?`الفرق ${actual-expected>=0?"(وفر)":"(عجز)"}: ${money(Math.abs(actual-expected))}`:"الفرق: أدخل النقد المعدود فعليًا.";$("cash-close-difference").classList.toggle("negative",hasActual&&actual<expected-.005);$("cash-close-difference").classList.toggle("positive",hasActual&&actual>expected+.005);}
  async function renderCashClose(){const date=$("cash-close-date").value||localDay();if(!$("cash-close-date").value)$("cash-close-date").value=date;try{cashCloseCache=await api(`/api/cash-close?date=${encodeURIComponent(date)}`);const{summary,closing,recent}=cashCloseCache;$("cash-close-in").textContent=money(summary.cashIn);$("cash-close-out").textContent=money(summary.cashOut);$("cash-close-net").textContent=money(summary.net);$("cash-close-events").innerHTML=summary.entries.map(x=>`<tr><td>${esc(x.label)}</td><td class="${x.amount<0?"negative":"positive"}">${money(Math.abs(x.amount))} ${x.amount<0?"خارج":"داخل"}</td><td>${esc(x.source==="supplier"?"مورد":"حساب عميل")}</td><td>${esc(x.by||"—")}</td><td>${esc(x.reference||"—")}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">لا توجد حركات نقدية مسجلة في هذا اليوم.</td></tr>';$("cash-close-state").textContent=closing?({submitted:"مرسل للمراجعة",approved:"معتمد"}[closing.status]||closing.status):"لم يُقفل بعد";$("cash-close-opening").value=closing?.openingFloat??0;$("cash-close-actual").value=closing?.actualCash??"";$("cash-close-notes").value=closing?.notes??"";const locked=!!closing;["cash-close-opening","cash-close-actual","cash-close-notes","cash-close-submit"].forEach(id=>$(id).disabled=locked);$("cash-close-submit").textContent=closing?"تم إرسال إقفال هذا اليوم":"إرسال الإقفال للمراجعة";$("cash-close-recent").innerHTML=recent.map(c=>`<tr><td>${esc(c.date)}</td><td>${esc(c.submittedBy?.name||"—")}</td><td>${money(c.systemCash)}</td><td>${money(c.actualCash)}</td><td class="${c.difference<-.005?"negative":c.difference>.005?"positive":""}">${c.difference>0?"+":""}${money(c.difference)}</td><td>${c.status==="approved"?`معتمد${c.approvedBy?.name?` · ${esc(c.approvedBy.name)}`:""}`:c.status==="reopened"?"أعيد فتحه من المدير":"بانتظار المراجعة"}</td><td>${c.status==="submitted"&&currentUser?.role==="manager"?`<button class="small-btn" data-approve-cash-close="${esc(c.id)}">اعتماد</button>`:c.status==="approved"&&currentUser?.role==="manager"?`<button class="small-btn" data-reopen-cash-close="${esc(c.id)}">إعادة فتح</button>`:"—"}</td></tr>`).join("")||'<tr><td colspan="7" class="empty">لا توجد إقفالات سابقة.</td></tr>';updateCashCloseDifference();}catch(e){toast(e.message);}}
  function reportRows(){const from=$("report-from").value,to=$("report-to").value;return data.transactions.filter(t=>t.status!=="cancelled"&&t.type!=="reversal"&&(!from||t.date.slice(0,10)>=from)&&(!to||t.date.slice(0,10)<=to));}
  function renderReports(){const txs=reportRows(),groups={};let invoices=0,net=0,weight=0;for(const t of txs){if(["sell","buy"].includes(t.type))invoices+=Number(t.amount||0);net+=signedMoney(t);if(["sell","buy"].includes(t.type))weight+=Number(t.weight||0);const name=t.createdBy?.name||"غير معروف";groups[name]||={count:0,invoices:0,net:0};groups[name].count++;groups[name].invoices+=(["sell","buy"].includes(t.type)?Number(t.amount||0):0);groups[name].net+=signedMoney(t);}$("report-count").textContent=txs.length;$("report-invoices").textContent=money(invoices);$("report-net").textContent=money(net);$("report-weight").textContent=grams(weight);$("report-user-rows").innerHTML=Object.entries(groups).map(([name,g])=>`<tr><td>${esc(name)}</td><td>${g.count}</td><td>${money(g.invoices)}</td><td>${money(g.net)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">لا توجد حركات للفترة.</td></tr>`;}
  function printReports(){const txs=reportRows(),from=$("report-from").value,to=$("report-to").value,groups={};let invoices=0,net=0,weight=0;for(const t of txs){if(["sell","buy"].includes(t.type)){invoices+=Number(t.amount||0);weight+=Number(t.weight||0);}net+=signedMoney(t);const name=t.createdBy?.name||"غير معروف";groups[name]||={count:0,invoices:0,net:0};groups[name].count++;groups[name].invoices+=(["sell","buy"].includes(t.type)?Number(t.amount||0):0);groups[name].net+=signedMoney(t);}const rows=txs.map(t=>`<tr><td>${esc(t.number)}</td><td>${dateText(t.date)}</td><td>${esc(data.customers.find(c=>c.id===t.customerId)?.name||"—")}</td><td>${esc(typeNames[t.type]||t.type)}</td><td>${esc(t.createdBy?.name||"—")}</td><td>${t.amount?money(t.amount):"—"}</td><td>${t.weight?grams(t.weight):"—"}</td></tr>`).join("")||'<tr><td colspan="7">لا توجد حركات للفترة المحددة.</td></tr>';const userRows=Object.entries(groups).map(([name,g])=>`<tr><td>${esc(name)}</td><td>${g.count}</td><td>${money(g.invoices)}</td><td>${money(g.net)}</td></tr>`).join("")||'<tr><td colspan="4">—</td></tr>';printDocument("تقرير الحركات حسب الفترة",`<section class="print-invoice-meta"><div><span>من تاريخ</span><strong>${from||"البداية"}</strong></div><div><span>إلى تاريخ</span><strong>${to||"اليوم"}</strong></div><div><span>عدد الحركات</span><strong>${txs.length}</strong></div><div><span>قيمة الفواتير</span><strong>${money(invoices)}</strong></div><div><span>صافي الأثر المالي</span><strong>${money(net)}</strong></div><div><span>وزن الذهب بالفواتير</span><strong>${grams(weight)}</strong></div></section><h2 class="print-section-title">ملخص الموظفين</h2><table><thead><tr><th>الموظف</th><th>الحركات</th><th>قيمة الفواتير</th><th>صافي الأثر المالي</th></tr></thead><tbody>${userRows}</tbody></table><h2 class="print-section-title">تفاصيل الحركات</h2><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>العميل</th><th>النوع</th><th>الموظف</th><th>المبلغ</th><th>الوزن</th></tr></thead><tbody>${rows}</tbody></table>`);}
  async function renderAudit(){if(currentUser?.role!=="manager")return;try{auditCache=(await api("/api/audit")).entries;filterAudit();}catch(e){toast(e.message);}}
  function filterAudit(){const q=$("audit-search").value.trim().toLowerCase();const entries=auditCache.filter(x=>`${x.userName} ${x.action} ${JSON.stringify(x.details)}`.toLowerCase().includes(q));$("audit-rows").innerHTML=entries.map(x=>`<tr><td>${dateText(x.date)}</td><td>${esc(x.userName)}</td><td>${esc(x.action)}</td><td>${esc(JSON.stringify(x.details||{}))}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">لا توجد أحداث.</td></tr>`;}
  function goldPriceText(value){const n=Number(value);return Number.isFinite(n)&&n>0?`${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} ج.م`:"—";}
  function goldPriceSummary(){
    if(goldPriceState.mode==="manual")return `تسعير يدوي · آخر تعديل ${dateText(goldPriceState.updatedAt)}${goldPriceState.updatedBy?` بواسطة ${goldPriceState.updatedBy}`:""}`;
    return goldPriceState.updatedAt?`آخر تحديث ${dateText(goldPriceState.updatedAt)} · المصدر ${goldPriceState.source||"goldprice.dev"}`:goldPriceState.error||"لم يصل سعر حديث بعد؛ سيُعاد التحديث تلقائيًا.";
  }
  function renderGoldPriceCards(){
    for(const karat of [24,21,18])$("gold-display-"+karat).textContent=goldPriceText(goldPriceState.prices?.[karat]);
    const status=$("gold-price-status");status.textContent=goldPriceSummary()+(goldPriceState.error&&goldPriceState.mode==="auto"?" · "+goldPriceState.error:"");
    $("gold-price-credit").innerHTML=goldPriceState.mode==="manual"?"الأسعار الحالية أدخلها المدير يدويًا.":'مصدر البيانات: <a href="https://goldprice.dev" target="_blank" rel="noopener noreferrer">Powered by goldprice.dev</a>';
    $("gold-price-refresh").hidden=currentUser?.role!=="manager"||goldPriceState.mode!=="auto";
  }
  function renderGoldPriceSettings(){
    const mode=$("gold-price-mode");if(!mode)return;
    if(!goldPriceFormDirty){mode.value=goldPriceState.mode||"auto";const values=mode.value==="manual"?goldPriceState.prices:(goldPriceState.automaticPrices||goldPriceState.prices);for(const karat of [24,21,18]){const input=$("gold-price-input-"+karat),value=Number(values?.[karat]);input.value=Number.isFinite(value)&&value>0?value.toFixed(2):"";}}
    const editable=mode.value==="manual";for(const karat of [24,21,18]){const input=$("gold-price-input-"+karat);input.disabled=!editable;input.required=editable;}
    const status=$("gold-price-settings-status");if(status)status.textContent=goldPriceSummary()+(goldPriceState.error&&goldPriceState.mode==="auto"?" · "+goldPriceState.error:"");
    $("gold-price-refresh").hidden=currentUser?.role!=="manager"||mode.value!=="auto";
  }
  async function loadGoldPrices(force=false){
    if(goldPriceLoading)return goldPriceLoading;
    goldPriceLoading=(async()=>{
      try{goldPriceState=await api("/api/gold-prices"+(force?"?refresh=1":""),{headers:force?{}:{"X-GCA-Background":"1"}});renderGoldPriceCards();renderGoldPriceSettings();updatePreview();renderGoldCalculator();return true;}
      catch(e){goldPriceState.error="تعذر الاتصال بمصدر أسعار الذهب.";renderGoldPriceCards();renderGoldPriceSettings();renderGoldCalculator();return false;}
    })();
    try{return await goldPriceLoading;}finally{goldPriceLoading=null;}
  }
  function renderPrintBrandPreview(){const b=printBrandDraft||printBrand(),logo=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.logoDataUrl||"")?`<img src="${esc(b.logoDataUrl)}" alt="">`:`<span>◆</span>`,qr=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.qrDataUrl||"")?`<img src="${esc(b.qrDataUrl)}" alt="رمز QR">`:"";$("print-brand-logo-preview").innerHTML=`${logo}<strong>${esc(b.arabicName||"اسم المحل")}</strong><small dir="ltr">${esc(b.englishName||"")}</small>`;$("print-brand-qr-preview").innerHTML=qr||"لا يوجد رمز QR";}
  function renderSettings(){if(currentUser?.role!=="manager")return;const s=data.settings||{},b=printBrand();$("setting-branch").value=s.branchName||"الفرع الرئيسي";$("setting-making").value=s.makingPerGram||0;$("setting-tax").value=s.taxRate||0;$("setting-buy-spread").value=s.buySpreadPerGram??50;$("setting-bullion-cashback").value=s.bullionCashbackPerGram??0;$("setting-stamp").value=s.stampPerGram??13;$("setup-shop-name-ar").value=b.arabicName||"";$("setup-shop-name-en").value=b.englishName||"";$("setup-branch-name").value=s.branchName||"الفرع الرئيسي";$("setup-shop-tagline").value=b.tagline||"";$("setup-shop-address").value=b.address||"";$("setup-shop-phones").value=b.phones||"";$("shop-setup-status").textContent=s.shopSetupCompletedAt?`تم الحفظ ${dateText(s.shopSetupCompletedAt)}`:"لم تكتمل التهيئة";$("print-template-style").value=["compact","minimal"].includes(s.printTemplate)?s.printTemplate:"classic";if(!printBrandDirty||!printBrandDraft){printBrandDraft={...b};$("print-brand-ar").value=b.arabicName;$("print-brand-en").value=b.englishName;$("print-brand-tagline").value=b.tagline;$("print-brand-address").value=b.address;$("print-brand-phones").value=b.phones;$("print-brand-footer").value=b.footerNote;}renderPrintBrandPreview();renderGoldPriceSettings();}
  function syncPrintBrandFields(){if(!printBrandDraft)printBrandDraft={...printBrand()};printBrandDraft={...printBrandDraft,arabicName:$("print-brand-ar").value,englishName:$("print-brand-en").value,tagline:$("print-brand-tagline").value,address:$("print-brand-address").value,phones:$("print-brand-phones").value,footerNote:$("print-brand-footer").value};printBrandDirty=true;renderPrintBrandPreview();}
  function readPrintImage(file){if(!file)return Promise.resolve("");if(!["image/png","image/jpeg","image/webp"].includes(file.type)){toast("استخدم صورة PNG أو JPG أو WebP فقط.");return Promise.resolve(null);}if(file.size>1024*1024){toast("حجم الصورة أكبر من 1 ميجابايت.");return Promise.resolve(null);}return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>resolve(null);reader.readAsDataURL(file);});}
  function paymentMethods(){return Array.isArray(data.settings?.paymentMethods)?data.settings.paymentMethods:[];}
  function renderPaymentMethods(){
    const manager=currentUser?.role==="manager",methods=paymentMethods().filter(m=>manager||m.active!==false),activeCount=paymentMethods().filter(m=>m.active!==false).length;
    $("payment-account-count").textContent=`الحسابات النشطة: ${activeCount}`;
    if(!methods.length){$("payment-account-list").innerHTML='<div class="empty">لا توجد حسابات نشطة حاليًا.</div>';return;}
    $("payment-account-list").innerHTML=methods.map(m=>{const active=m.active!==false;const actions=`<button class="secondary" type="button" data-payment-print="${esc(m.id)}" ${active?"":"disabled"}>طباعة بيانات التحويل</button>${manager?`<button class="small-btn" type="button" data-payment-edit="${esc(m.id)}">تعديل</button><button class="small-btn" type="button" data-payment-toggle="${esc(m.id)}">${active?"تعطيل":"تفعيل"}</button><button class="small-btn payment-delete" type="button" data-payment-delete="${esc(m.id)}">حذف</button>`:""}`;return`<article class="payment-account-card ${active?"":"inactive"}"><div class="payment-account-heading"><h3>${esc(m.name)}</h3><span class="pill ${active?"":"red"}">${active?"نشط":"معطّل"}</span></div><dl><dt>البنك / مقدم الخدمة</dt><dd>${esc(m.bankName||"—")}</dd>${m.beneficiary?`<dt>صاحب الحساب</dt><dd>${esc(m.beneficiary)}</dd>`:""}<dt>رقم الحساب / IBAN</dt><dd class="account-number" dir="ltr">${esc(m.accountNumber||"—")}</dd>${m.notes?`<dt>تعليمات التحويل</dt><dd>${esc(m.notes)}</dd>`:""}</dl><div class="payment-account-actions">${actions}</div></article>`;}).join("");
  }
  async function savePaymentMethods(next){
    const before=paymentMethods();data.settings={...(data.settings||{}),paymentMethods:next};
    if(await save()){renderPaymentMethods();return true;}
    data.settings={...(data.settings||{}),paymentMethods:before};renderPaymentMethods();return false;
  }
  function resetPaymentForm(){paymentMethodEditingId=null;$("payment-account-form").reset();$("payment-form-title").textContent="إضافة طريقة دفع أو حساب بنكي";$("payment-save-btn").textContent="إضافة الحساب";$("payment-cancel-edit").hidden=true;}
  function printPaymentMethods(id=null){
    const methods=paymentMethods().filter(m=>m.active!==false&&(!id||m.id===id));
    if(!methods.length){toast("لا توجد حسابات نشطة للطباعة.");return;}
    const cards=methods.map(m=>`<section class="payment-slip"><h2>${esc(m.name)}</h2><dl><dt>البنك / مقدم الخدمة</dt><dd>${esc(m.bankName||"—")}</dd>${m.beneficiary?`<dt>اسم المستفيد</dt><dd>${esc(m.beneficiary)}</dd>`:""}<dt>رقم الحساب / IBAN</dt><dd class="account-number" dir="ltr">${esc(m.accountNumber||"—")}</dd></dl>${m.notes?`<p class="payment-slip-note">${esc(m.notes)}</p>`:""}</section>`).join("");
    printDocument("بيانات التحويل البنكي",`<p class="payment-slip-intro">يمكنكم استخدام بيانات الحساب التالية لإتمام التحويل. يرجى إرسال صورة التحويل للفرع بعد إتمام العملية.</p><div class="payment-slip-grid">${cards}</div>`);
  }
  const weekDays=[{day:6,name:"السبت"},{day:0,name:"الأحد"},{day:1,name:"الاثنين"},{day:2,name:"الثلاثاء"},{day:3,name:"الأربعاء"},{day:4,name:"الخميس"},{day:5,name:"الجمعة"}];
  function drawStaffSchedule(){
    const manager=currentUser?.role==="manager",stored=data.settings?.employeeDaysOff||{};
    if(!staffScheduleDirty){staffScheduleDraft={};for(const employee of staffRoster){const days=Array.isArray(stored[employee.id]?.days)?stored[employee.id].days.filter(day=>weekDays.some(d=>d.day===day)):[];staffScheduleDraft[employee.id]={name:employee.name,days};}}
    $("staff-schedule-status").textContent=staffScheduleDirty?`${staffRoster.length} موظف نشط · تغييرات غير محفوظة`:`${staffRoster.length} موظف نشط`;
    if(!staffRoster.length){$("staff-schedule-rows").innerHTML='<tr><td colspan="8" class="empty">لا توجد حسابات موظفين نشطة في النظام.</td></tr>';$("staff-coverage").innerHTML="";return;}
    $("staff-schedule-rows").innerHTML=staffRoster.map(employee=>{const days=staffScheduleDraft[employee.id]?.days||[];const cells=weekDays.map(({day,name})=>{const off=days.includes(day);return manager?`<td class="schedule-day ${off?"day-off":""}"><label><input type="checkbox" data-staff-id="${esc(employee.id)}" data-staff-day="${day}" aria-label="إجازة ${name} لـ ${esc(employee.name)}" ${off?"checked":""}><span>${off?"إجازة":"دوام"}</span></label></td>`:`<td class="schedule-day ${off?"day-off":""}"><span>${off?"إجازة":"دوام"}</span></td>`;}).join("");return`<tr><th scope="row">${esc(employee.name)}</th>${cells}</tr>`;}).join("");
    $("staff-coverage").innerHTML=weekDays.map(({day,name})=>{const off=staffRoster.filter(employee=>(staffScheduleDraft[employee.id]?.days||[]).includes(day)).length,working=staffRoster.length-off;return`<span class="staff-coverage-day ${working===0?"no-coverage":""}"><strong>${name}</strong><small>${working} دوام · ${off} إجازة</small></span>`;}).join("");
  }
  async function renderStaffSchedule(){
    try{const result=await api("/api/staff-roster");staffRoster=result.employees||[];drawStaffSchedule();}
    catch(err){$("staff-schedule-status").textContent=err.message;$("staff-schedule-rows").innerHTML='<tr><td colspan="8" class="empty">تعذر تحميل قائمة الموظفين. أعد فتح التبويب.</td></tr>';}
  }
  async function refreshStaffRoster(){
    try{const result=await api("/api/staff-roster",{headers:{"X-GCA-Background":"1"}}),next=result.employees||[];if(JSON.stringify(next)!==JSON.stringify(staffRoster)){staffRoster=next;drawStaffSchedule();}}
    catch(err){if(err.status===401){currentUser=null;showAuth(false);}}
  }
  async function saveStaffSchedule(){
    if(currentUser?.role!=="manager"){toast("تعديل جدول الإجازات متاح للمدير فقط.");return;}
    const before=data.settings||{},next={...(before.employeeDaysOff||{})};
    for(const employee of staffRoster){const days=(staffScheduleDraft[employee.id]?.days||[]).filter(day=>weekDays.some(d=>d.day===day));next[employee.id]={name:employee.name,days,updatedAt:new Date().toISOString()};}
    data.settings={...before,employeeDaysOff:next};
    if(await save()){staffScheduleDirty=false;staffScheduleDraft={};await renderStaffSchedule();toast("تم حفظ جدول الإجازات ومشاركته مع الموظفين.");}
    else{data.settings=before;staffScheduleDirty=true;drawStaffSchedule();}
  }
  function editPaymentMethod(id){
    const method=paymentMethods().find(m=>m.id===id);if(!method||currentUser?.role!=="manager")return;
    paymentMethodEditingId=method.id;$("payment-name").value=method.name||"";$("payment-bank").value=method.bankName||"";$("payment-number").value=method.accountNumber||"";$("payment-beneficiary").value=method.beneficiary||"";$("payment-notes").value=method.notes||"";$("payment-form-title").textContent="تعديل بيانات طريقة الدفع";$("payment-save-btn").textContent="حفظ التعديلات";$("payment-cancel-edit").hidden=false;$("payment-account-editor").scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function renderBackups(){if(currentUser?.role!=="manager")return;try{const files=(await api("/api/backups")).files;$("backup-rows").innerHTML=files.map(f=>`<tr><td>${esc(f.name)}</td><td>${dateText(f.modifiedAt)}</td><td>${(f.size/1024).toFixed(1)} KB</td><td><button class="small-btn" data-restore-backup="${esc(f.name)}">استعادة</button></td></tr>`).join("")||`<tr><td colspan="4" class="empty">لا توجد نسخ محفوظة بعد.</td></tr>`;}catch(e){toast(e.message);}}
  const titles={dashboard:"لوحة التحكم",customers:"العملاء",transaction:"تسجيل حركة", "gold-calculator":"حاسبة البيع والشراء","payment-accounts":"حسابات التحويل","staff-schedule":"إجازات الموظفين",ledger:"كشف الحركات",inventory:"المخزون",suppliers:"الموردون والمشتريات","cash-close":"إقفال النقدية",vault:"مطابقة الخزنة",reports:"التقارير",backup:"النسخ الاحتياطي",users:"إدارة المستخدمين",audit:"سجل التدقيق",settings:"الإعدادات",analytics:"مؤشرات المدير","customers-analysis":"تحليل العملاء",profit:"الربح الفعلي","price-history":"تاريخ أسعار الذهب",pieces:"القطع المسلسلة",manufacturing:"طلبات التصنيع",pledges:"الرهونات والضمانات",alerts:"مركز التنبيهات",security:"الأمان والصلاحيات",branches:"إدارة الفروع"};
  function showView(name) {
    const nav=document.querySelector(`.nav-btn[data-view="${name}"]`),required=nav?.dataset.permission;
    if(required&&!can(required)){toast("لا يملك حسابك صلاحية فتح هذه الصفحة أو انتهت صلاحيتها.");return;}
    if(["users","audit","settings","suppliers"].includes(name)&&currentUser?.role!=="manager"){toast("هذه الصفحة متاحة للمدير فقط.");return;}
    document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${name}`));
    document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
    $("page-title").textContent=titles[name]||"النظام";
    if(name==="ledger") renderLedger();
    if(name==="customers") renderCustomers();
    if(name==="users") renderUsers();
    if(name==="inventory") renderInventory();
    if(name==="suppliers") renderSuppliers();
    if(name==="cash-close") renderCashClose();
    if(name==="reports") renderReports();
    if(name==="audit") renderAudit();
    if(name==="settings") renderSettings();
    if(name==="gold-calculator") renderGoldCalculator();
    if(name==="payment-accounts") renderPaymentMethods();
    if(name==="staff-schedule") renderStaffSchedule();
    if(name==="backup") renderBackups();
    if(name==="branches") renderBranchManagement();
    window.dispatchEvent(new CustomEvent("gca:view",{detail:{name}}));
    window.scrollTo({top:0,behavior:"smooth"});
  }
  document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));
  $("customer-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const name=$("customer-name").value.trim();
    if(!name) return;
    const phone=$("customer-phone").value.trim();
    if(phone && data.customers.some(c=>c.phone===phone)){toast("رقم الهاتف مسجل لعميل آخر. راجع البيانات.");return;}
    const id=crypto.randomUUID?crypto.randomUUID():`c${Date.now()}${Math.random().toString(16).slice(2)}`;
    const code=`C-${String(data.nextCustomer++).padStart(5,"0")}`;
    data.customers.push({id,code,name,phone,notes:$("customer-notes").value.trim(),createdAt:new Date().toISOString()});
    if(await save()){e.target.reset();renderAll();toast("تم حفظ العميل.");}
  });
  $("customer-search").addEventListener("input",renderCustomers);
  function updateFields() {
    const type=$("tx-type").value;
    const invoice=["sell","buy"].includes(type);
    const amountLabel=$("amount-label");
    amountLabel.style.display=invoice||["payment","cash-deposit","cash-refund","opening-money","adjustment"].includes(type)?"flex":"none";
    amountLabel.firstChild.textContent=type==="payment"?"مبلغ التحصيل (ج.م)":invoice?"قيمة الفاتورة (ج.م)":"المبلغ (ج.م)";
    $("paid-label").style.display=invoice?"flex":"none";
    $("tx-payment-method-label").hidden=!(invoice||type==="payment");
    $("gold-weight-label").style.display=["sell","buy","gold-deposit","gold-delivery","opening-gold"].includes(type)?"flex":"none";
    $("karat-label").style.display=["sell","buy","gold-deposit","gold-delivery","opening-gold"].includes(type)?"flex":"none";
    $("direction-label").style.display=["opening-money","opening-gold","adjustment"].includes(type)?"flex":"none";
    if(!invoice) $("tx-paid").value="0";
    updatePreview();
  }
  function pricePerGram(karat){
    const prices=goldPriceState.prices||{},direct=Number(prices[karat]);
    if(Number.isFinite(direct)&&direct>0)return direct;
    const pure=Number(prices[24]||data.settings?.goldPrice24||0);
    return pure>0?pure*Number(karat)/24:0;
  }
  const calcJewelry=[
    ["غوايش ساده عيار 21",21,275],["غوايش الوان خليجي عيار 21",21,300],
    ["خواتم ودبل ساده عيار 21",21,350],["خواتم شركات بفصوص ترد عيار 21",21,400],
    ["سلاسل وتعاليق وحلقان عيار 21",21,350],["كوليهات واساور وانسيالات عيار 21",21,400],
    ["خواتم ودبل وحلقان ساده عيار 18",18,425],["حلقان بناتي أقل من جرام عيار 18",18,450],
    ["حلقان حريمي وكوليهات وانسيالات عيار 18",18,450],["كوليهات وانسيالات ميني عيار 18",18,800],
    ["محابس أقل من 2 جرام عيار 18",18,450],["محابس أزيد من 2 جرام عيار 18",18,450],
    ["سلاسل وتعاليق ساده عيار 18",18,450],["أطقم وكوليهات شركات عيار 18",18,450],
    ["خواتم باتي أقل من جرام عيار 18",18,450],["خواتم بناتي أزيد من 2 جرام عيار 18",18,450],
    ["غوايش واساور وخلاخيل عيار 18",18,450]
  ].map(([name,karat,making],i)=>({id:`j${i}`,name,kind:"jewelry",karat,weight:0,making}));
  const calcBullion=[
    ["ربع جنيه ذهب",21,2,95],["نصف جنيه ذهب",21,4,90],["جنيه ذهب",21,8,85],
    ["سبيكة 0.25 جرام",24,.25,250],["سبيكة 0.5 جرام",24,.5,250],["سبيكة 1 جرام",24,1,250],
    ["سبيكة 2.5 جرام",24,2.5,135],["سبيكة 5 جرام",24,5,95],["سبيكة 10 جرام",24,10,90],
    ["سبيكة 20 جرام",24,20,90],["سبيكة أونصة",24,31.1035,85],["سبيكة 50 جرام",24,50,80],
    ["سبيكة 100 جرام",24,100,80],["سبيكة 250 جرام",24,250,55],["سبيكة 500 جرام",24,500,35],
    ["سبيكة 1 كجم",24,1000,25]
  ].map(([name,karat,weight,making],i)=>({id:`b${i}`,name,kind:"bullion",karat,weight,making}));
  const calcProducts=[...calcJewelry,...calcBullion,{id:"custom",name:"صنف مخصص",kind:"custom",karat:21,weight:0,making:0}];
  function selectedCalcProduct(){return calcProducts.find(p=>p.id===$("calc-product").value)||calcProducts[calcProducts.length-1];}
  function calcSettings(){const s=data.settings||{};return{spread:Math.max(0,Number(s.buySpreadPerGram??50)||0),cashback:Math.max(0,Number(s.bullionCashbackPerGram??0)||0),stamp:Math.max(0,Number(s.stampPerGram??13)||0),tax:Math.min(100,Math.max(0,Number(s.taxRate)||0))};}
  function buildCalcProductOptions(){
    const select=$("calc-product");
    select.innerHTML='<option value="custom">صنف مخصص</option><optgroup label="المشغولات — مصنعية الملف المرفق"></optgroup><optgroup label="الجنيهات والسبائك — مصنعية الملف المرفق"></optgroup>';
    const groups=select.querySelectorAll("optgroup");
    for(const p of calcJewelry){const o=document.createElement("option");o.value=p.id;o.textContent=p.name;groups[0].append(o);}
    for(const p of calcBullion){const o=document.createElement("option");o.value=p.id;o.textContent=p.name;groups[1].append(o);}
  }
  function applyCalcProduct(){
    const p=selectedCalcProduct(),s=calcSettings();
    $("calc-quantity").value="1";
    $("calc-custom-name-label").hidden=p.kind!=="custom";
    if(p.kind!=="custom")$("calc-custom-name").value="";
    $("calc-karat").value=String(p.karat);
    if(p.weight>0)$("calc-weight").value=p.weight;
    else $("calc-weight").value="";
    if(p.kind==="jewelry"){$("calc-making").value=p.making;$("calc-stamp").value=s.stamp;}
    else if(p.kind==="bullion"){$("calc-making").value=p.making;$("calc-stamp").value=0;}
    else{$("calc-making").value=Number(data.settings?.makingPerGram)||0;$("calc-stamp").value=0;}
    updateCalcOperationFields();updateCalcPreview();
  }
  function updateCalcOperationFields(){
    const buying=$("calc-operation").value==="buy";
    $("calc-making-label").hidden=buying;$("calc-stamp-label").hidden=buying;$("calc-inventory-item").disabled=false;$("calc-serial-piece").disabled=buying;
    $("calc-preview").classList.toggle("buy",buying);updateCalcPreview();
  }
  function calcDraft(){
    const p=selectedCalcProduct(),operation=$("calc-operation").value,karat=Number($("calc-karat").value),weight=Number($("calc-weight").value),quantity=Number($("calc-quantity").value),settings=calcSettings(),rate=pricePerGram(karat);
    const making=Math.max(0,Number($("calc-making").value)||0),stamp=Math.max(0,Number($("calc-stamp").value)||0),name=p.kind==="custom"?($("calc-custom-name").value.trim()||"ذهب مخصص"):p.name;
    const cashback=operation==="buy"&&p.kind==="bullion"&&karat===24?settings.cashback:0,spread=operation==="buy"?settings.spread:0,taxRate=operation==="sell"?settings.tax:0;
    const basePerGram=operation==="buy"?rate-spread+cashback:rate+making+(p.kind==="jewelry"?stamp:0);
    const rawSubtotal=basePerGram*weight*quantity,subtotal=Math.round((rawSubtotal+Number.EPSILON)*100)/100,tax=Math.round((subtotal*taxRate/100+Number.EPSILON)*100)/100,total=Math.round((subtotal+tax+Number.EPSILON)*100)/100;
    return{product:p,operation,karat,weight,quantity,settings,rate,making,stamp,cashback,spread,taxRate,basePerGram,subtotal,tax,total,name};
  }
  function updateCalcPreview(){
    const el=$("calc-preview");if(!el)return;const d=calcDraft();
    if(!d.rate){el.textContent="لا يتوفر سعر حالي لهذا العيار. حدّث الأسعار أو أدخل الأسعار اليدوية من إعدادات المدير.";return;}
    if(!(d.weight>0)||!Number.isInteger(d.quantity)||d.quantity<1){el.textContent=`سعر عيار ${d.karat}: ${goldPriceText(d.rate)} للجرام. أدخل وزنًا وعددًا صحيحين لإظهار التقدير.`;return;}
    if(d.basePerGram<0){el.textContent="فرق الشراء أكبر من سعر الجرام؛ راجع إعداد فرق الشراء لدى المدير.";return;}
    const formula=d.operation==="buy"?`(${goldPriceText(d.rate)} − ${money(d.spread)}${d.cashback?` + كاش باك ${money(d.cashback)}`:""}) × ${calcGrams(d.weight)} × ${d.quantity}`:`(${goldPriceText(d.rate)} + مصنعية ${money(d.making)}${d.product.kind==="jewelry"?` + دمغة ${money(d.stamp)}`:""}) × ${calcGrams(d.weight)} × ${d.quantity}`;
    el.innerHTML=`<span>${esc(formula)}${d.taxRate?` + ضريبة ${d.taxRate}%` : ""}</span><strong>${money(d.total)}</strong>`;
  }
  function createCalcLine(d){return{id:`${Date.now()}-${Math.random()}`,operation:d.operation,name:d.name,kind:d.product.kind,inventoryItemId:$("calc-inventory-item").value||"",serialPieceId:d.operation==="sell"?($("calc-serial-piece").value||""):"",karat:d.karat,weight:d.weight,quantity:d.quantity,rate:d.rate,making:d.making,stamp:d.product.kind==="jewelry"?d.stamp:0,spread:d.spread,cashback:d.cashback,taxRate:d.taxRate,subtotal:d.subtotal,tax:d.tax,total:d.total};}
  function calcGrams(value){return`${Number(value||0).toLocaleString("en-US",{minimumFractionDigits:3,maximumFractionDigits:4})} جم`;}
  function renderCalcLines(){
    const tbody=$("calc-lines"),totals=$("calc-totals"),hasLines=calcLines.length>0;
    $("calc-print").disabled=!hasLines;
    const oneKarat=hasLines&&new Set(calcLines.map(x=>x.karat)).size===1&&new Set(calcLines.map(x=>x.operation)).size===1;
    $("calc-use-transaction").disabled=!oneKarat||$("transaction-form").hidden;
    $("calc-transfer-note").textContent=!hasLines?"أضف الأصناف ثم انقل الإجمالي إلى سجل الحركة إذا كان العيار موحدًا.":!oneKarat?"يمكن طباعة الفاتورة المختلطة، لكن سجل الحركة يدعم عيارًا واحدًا فقط؛ قسّمها حسب العيار لنقلها.":"الإجمالي جاهز للنقل إلى سجل الحركات.";
    if(!hasLines){tbody.innerHTML='<tr><td colspan="7" class="empty">أضف صنفًا لبدء الفاتورة التقديرية.</td></tr>';totals.hidden=true;return;}
    tbody.innerHTML=calcLines.map(line=>{const details=line.operation==="buy"?`فرق ${money(line.spread)}${line.cashback?` · كاش باك ${money(line.cashback)}`:""}`:`مصنعية ${money(line.making)}${line.kind==="jewelry"?` · دمغة ${money(line.stamp)}`:""}${line.taxRate?` · ضريبة ${line.taxRate}%`:""}`;return`<tr><td>${esc(line.name)}</td><td>${line.karat}</td><td>${money(line.rate)}</td><td>${calcGrams(line.weight)} × ${line.quantity}</td><td>${details}</td><td><strong>${money(line.total)}</strong></td><td><button class="small-btn" type="button" data-calc-remove="${esc(line.id)}">حذف</button></td></tr>`;}).join("");
    const subtotal=calcLines.reduce((n,l)=>n+l.subtotal,0),tax=calcLines.reduce((n,l)=>n+l.tax,0),total=calcLines.reduce((n,l)=>n+l.total,0),operation=calcLines[0].operation;
    totals.hidden=false;totals.innerHTML=`<span>عدد القطع: <strong>${calcLines.reduce((n,l)=>n+l.quantity,0)}</strong></span><span>الوزن: <strong>${calcGrams(calcLines.reduce((n,l)=>n+l.weight*l.quantity,0))}</strong></span>${operation==="sell"?`<span>قبل الضريبة: <strong>${money(subtotal)}</strong></span>${tax?`<span>الضريبة: <strong>${money(tax)}</strong></span>`:""}`:""}<span class="grand-total">${operation==="sell"?"إجمالي البيع":"إجمالي الشراء"}: <strong>${money(total)}</strong></span>`;
  }
  function renderGoldCalculator(){
    const inventorySelect=$("calc-inventory-item"),selected=inventorySelect.value,buying=$("calc-operation").value==="buy";inventorySelect.innerHTML='<option value="">بدون ربط بالمخزون</option>'+(data.inventoryItems||[]).filter(i=>buying||Number(i.quantity)>0).map(i=>`<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.sku||i.karat)} · المتاح ${i.quantity}</option>`).join("");if((data.inventoryItems||[]).some(i=>i.id===selected&&(buying||i.quantity>0)))inventorySelect.value=selected;inventorySelect.disabled=false;$("calc-serial-piece").disabled=buying;
    for(const k of [24,21,18])$("calc-price-"+k).textContent=goldPriceText(goldPriceState.prices?.[k]);
    $("calc-price-status").textContent=goldPriceSummary();updateCalcPreview();renderCalcLines();
  }
  function printCalcQuote(){
    if(!calcLines.length)return;const operation=calcLines[0].operation,total=calcLines.reduce((n,l)=>n+l.total,0),weight=calcLines.reduce((n,l)=>n+l.weight*l.quantity,0),quantity=calcLines.reduce((n,l)=>n+l.quantity,0),rows=calcLines.map((l,i)=>`<tr><td>${i+1}</td><td>${inventoryPicture(l.inventoryItemId||l.serialPieceId)}</td><td>${esc(l.name)}</td><td>${l.karat}</td><td>${calcGrams(l.weight*l.quantity)}</td><td>${l.quantity}</td><td>${money(l.rate)}</td><td>${money(l.total)}</td></tr>`).join("");
    const subtotal=calcLines.reduce((n,l)=>n+l.subtotal,0),tax=calcLines.reduce((n,l)=>n+l.tax,0);
    printDocument(operation==="sell"?"عرض سعر بيع ذهب ومشغولات":"عرض سعر شراء ذهب من العميل",`<section class="print-invoice-meta"><div><span>التاريخ</span><strong>${dateText(new Date().toISOString())}</strong></div><div><span>أعدّ العرض</span><strong>${esc(currentUser?.name||"—")}</strong></div><div><span>عدد القطع</span><strong>${quantity}</strong></div><div><span>إجمالي الوزن</span><strong>${calcGrams(weight)}</strong></div></section><table class="print-invoice-table"><thead><tr><th>م</th><th>الصورة</th><th>الصنف / البيان</th><th>العيار</th><th>الوزن</th><th>الكمية</th><th>سعر الجرام</th><th>القيمة</th></tr></thead><tbody>${rows}</tbody></table><section class="print-total-grid">${operation==="sell"?`<div><span>قبل الضريبة</span><strong>${money(subtotal)}</strong></div><div><span>الضريبة (${Number(calcLines[0].taxRate||0)}%)</span><strong>${money(tax)}</strong></div>`:`<div><span>سعر عيار 24 المرجعي</span><strong>${goldPriceState.prices?.[24]?money(goldPriceState.prices[24]):"—"}</strong></div>`}<div class="print-total-box"><span>${operation==="sell"?"إجمالي البيع":"إجمالي الشراء"}</span><strong>${money(total)}</strong></div></section><p class="print-note">عرض استرشادي حسب أسعار الذهب والإعدادات المسجلة وقت الاحتساب.</p><p class="print-sign">اعتماد العميل: ____________________ <span>الموظف: ${esc(currentUser?.name||"—")}</span></p>`);
  }
  function useCalcInTransaction(){
    if(!calcLines.length)return;const karats=new Set(calcLines.map(x=>x.karat)),operations=new Set(calcLines.map(x=>x.operation));
    if(karats.size!==1||operations.size!==1){toast("قسّم الفاتورة حسب العملية والعيار قبل نقلها إلى سجل الحركات.");return;}
    const operation=calcLines[0].operation,weight=calcLines.reduce((n,l)=>n+l.weight*l.quantity,0),total=calcLines.reduce((n,l)=>n+l.total,0),names=calcLines.map(l=>`${l.name} ×${l.quantity}`).join("، ");
    pendingInvoiceLines=calcLines.map(line=>({...line}));$("tx-type").value=operation;$("tx-amount").value=total.toFixed(2);$("tx-paid").value="0";$("tx-weight").value=weight.toFixed(4);$("tx-karat").value=String(calcLines[0].karat);$("tx-notes").value=`حاسبة الذهب: ${names}`.slice(0,250);updateFields();showView("transaction");
    toast("نُقل التقدير إلى تسجيل الحركة؛ اختر العميل وأدخل المبلغ المدفوع ثم احفظ.");
  }
  function updatePreview() {
    const type=$("tx-type").value, amount=Number($("tx-amount").value||0), paid=Number($("tx-paid").value||0);
    const preview=$("tx-preview-text"), useEstimate=$("use-estimate-btn"), settings=data.settings||{};
    const weight=Number($("tx-weight").value||0),karat=Number($("tx-karat").value||21);
    const unitGoldPrice=pricePerGram(karat),subtotal=(unitGoldPrice+Number(settings.makingPerGram||0))*weight;
    const estimate=subtotal*(1+Number(settings.taxRate||0)/100);
    useEstimate.hidden=!(type==="sell"&&weight>0&&unitGoldPrice>0);
    if(["sell","buy"].includes(type)){
      const remaining=amount-paid;
      preview.textContent=`المتبقي من الفاتورة: ${money(remaining)}${remaining<0?' — تحقّق من المبلغ المدفوع':''}${type==="sell"&&weight>0&&unitGoldPrice>0?` · التقدير الاختياري حسب عيار ${karat}: ${money(estimate)}`:""}`;
      preview.style.color=remaining<0?'var(--red)':'';
    } else { preview.textContent="راجع نوع الحركة واتجاهها قبل الحفظ."; preview.style.color=""; }
  }
  $("use-estimate-btn").addEventListener("click",()=>{pendingInvoiceLines=[];const s=data.settings||{},weight=Number($("tx-weight").value||0),karat=Number($("tx-karat").value||21),subtotal=(pricePerGram(karat)+Number(s.makingPerGram||0))*weight;$("tx-amount").value=(subtotal*(1+Number(s.taxRate||0)/100)).toFixed(2);updatePreview();});
  $("tx-type").addEventListener("change",()=>{if(pendingInvoiceLines.length&&pendingInvoiceLines[0].operation!==$("tx-type").value)pendingInvoiceLines=[];updateFields();});
  ["tx-amount","tx-weight","tx-karat"].forEach(id=>$(id).addEventListener("input",()=>{if(pendingInvoiceLines.length)pendingInvoiceLines=[];updatePreview();}));$("tx-paid").addEventListener("input",updatePreview);
  $("tx-date").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  $("transaction-form").addEventListener("reset",()=>{pendingInvoiceLines=[];setTimeout(()=>{ $("tx-date").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16); updateFields(); },0);});
  $("transaction-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const customerId=$("tx-customer").value, type=$("tx-type").value;
    if(!customerId){toast("اختر العميل أولًا.");return;}
    const amount=Number($("tx-amount").value||0), paid=Number($("tx-paid").value||0), weight=Number($("tx-weight").value||0);
    if(!Number.isFinite(amount)||!Number.isFinite(paid)||!Number.isFinite(weight)||amount<0||paid<0||weight<0){toast("أدخل أرقامًا صحيحة غير سالبة.");return;}
    const transactionDate=new Date($("tx-date").value);
    if(!Number.isFinite(transactionDate.getTime())){toast("أدخل تاريخًا ووقتًا صالحين للحركة.");return;}
    if(["sell","buy"].includes(type) && paid>amount){toast("المبلغ المدفوع أكبر من قيمة الفاتورة. راجع القيم.");return;}
    if(["sell","buy","cash-deposit","cash-refund","opening-money","adjustment"].includes(type) && amount<=0){toast("أدخل مبلغًا أكبر من صفر.");return;}
    if(["gold-deposit","gold-delivery","opening-gold"].includes(type)&&weight<=0){toast("أدخل وزنًا أكبر من صفر.");return;}
    if(type==="payment" && amount<=0){toast("أدخل مبلغ التحصيل في خانة قيمة الفاتورة / المبلغ.");return;}
    const tx={
      id:crypto.randomUUID?crypto.randomUUID():`t${Date.now()}${Math.random().toString(16).slice(2)}`,
      number:`TX-${String(data.nextTransaction++).padStart(7,"0")}`,
      customerId,type,date:transactionDate.toISOString(),
      amount, paid, paymentMethod:$("tx-payment-method").value, weight, karat:$("tx-karat").value,
      direction:$("tx-direction").value,notes:$("tx-notes").value.trim(),items:pendingInvoiceLines.map(line=>({name:line.name,karat:line.karat,weight:line.weight,quantity:line.quantity,rate:line.rate,making:line.making,stamp:line.stamp,spread:line.spread,cashback:line.cashback,taxRate:line.taxRate,subtotal:line.subtotal,tax:line.tax,total:line.total,...(line.inventoryItemId?{inventoryItemId:line.inventoryItemId}:{}),...(line.serialPieceId?{serialPieceId:line.serialPieceId}:{})})),status:"approved",createdAt:new Date().toISOString()
    };
    // payment uses the amount field; gold-only actions do not create a financial effect.
    data.transactions.push(tx);
    if(await save()){e.target.reset();renderAll();if(tx.items.some(x=>x.inventoryItemId)){renderInventory();renderGoldCalculator();}showView("ledger");toast(`تم حفظ الحركة ${tx.number}.`);}
  });
  $("calc-operation").addEventListener("change",updateCalcOperationFields);
  $("calc-inventory-item").addEventListener("change",()=>{if($("calc-inventory-item").value)$("calc-serial-piece").value="";const item=data.inventoryItems.find(x=>x.id===$("calc-inventory-item").value);if(item){$("calc-product").value="custom";$("calc-custom-name").value=item.name;$("calc-custom-name-label").hidden=false;$("calc-karat").value=String(item.karat);$("calc-weight").value=Number(item.weight).toFixed(3);$("calc-quantity").value="1";}updateCalcPreview();});
  $("calc-serial-piece").addEventListener("change",async()=>{const id=$("calc-serial-piece").value;if(!id){updateCalcPreview();return;}try{const {pieces}=await api("/api/advanced");const piece=(pieces||[]).find(p=>p.id===id);if(!piece)throw new Error("لم تعد القطعة متاحة.");$("calc-inventory-item").value="";$("calc-product").value="custom";$("calc-custom-name-label").hidden=false;$("calc-custom-name").value=piece.name+" · "+piece.serial;$("calc-karat").value=String(piece.karat);$("calc-weight").value=Number(piece.weight).toFixed(3);$("calc-quantity").value="1";updateCalcPreview();}catch(e){toast(e.message);$("calc-serial-piece").value="";}});
  $("calc-product").addEventListener("change",applyCalcProduct);
  ["calc-karat","calc-weight","calc-quantity","calc-making","calc-stamp","calc-custom-name"].forEach(id=>$(id).addEventListener("input",updateCalcPreview));
  $("gold-calc-form").addEventListener("submit",e=>{
    e.preventDefault();const d=calcDraft();
    if(calcLines.length&&calcLines[0].operation!==d.operation){toast("أنهِ أو امسح الفاتورة الحالية قبل تغيير نوع العملية.");return;}
    if(!(d.rate>0)){toast("لا يتوفر سعر صالح للعيار المحدد.");return;}
    if(!Number.isFinite(d.weight)||d.weight<=0||!Number.isInteger(d.quantity)||d.quantity<1||d.quantity>1000000){toast("أدخل وزنًا أكبر من صفر وعددًا صحيحًا صالحًا.");return;}
    if(!Number.isFinite(d.total)||d.basePerGram<0){toast("تحقق من الأسعار وفرق الشراء والمصنعية.");return;}
    const line=createCalcLine(d);calcLines.push(line);if(line.serialPieceId)$("calc-serial-piece").value="";renderCalcLines();toast("أُضيف الصنف بسعر العيار الحالي.");
  });
  $("calc-lines").addEventListener("click",e=>{const button=e.target.closest("[data-calc-remove]");if(!button)return;calcLines=calcLines.filter(line=>line.id!==button.dataset.calcRemove);renderCalcLines();});
  $("calc-clear").addEventListener("click",()=>{calcLines=[];$("gold-calc-form").reset();$("calc-operation").value="sell";$("calc-quantity").value="1";$("calc-product").value="custom";applyCalcProduct();renderCalcLines();});
  $("calc-print").addEventListener("click",printCalcQuote);
  $("calc-use-transaction").addEventListener("click",useCalcInTransaction);
  $("payment-account-form").addEventListener("submit",async e=>{
    e.preventDefault();if(currentUser?.role!=="manager"){toast("إدارة حسابات التحويل متاحة للمدير فقط.");return;}
    const methods=paymentMethods(),accountNumber=$("payment-number").value.trim(),normalized=accountNumber.replace(/\s+/g,"").toLowerCase();
    const duplicate=methods.find(m=>m.id!==paymentMethodEditingId&&String(m.accountNumber||"").replace(/\s+/g,"").toLowerCase()===normalized);
    if(duplicate){toast("رقم الحساب مسجل مسبقًا؛ عدّل الحساب الموجود بدل تكراره.");return;}
    if(!paymentMethodEditingId&&methods.length>=100){toast("وصلت إلى الحد الأقصى للحسابات المحفوظة.");return;}
    const existing=methods.find(m=>m.id===paymentMethodEditingId),now=new Date().toISOString(),record={id:paymentMethodEditingId||crypto.randomUUID?.()||`p${Date.now()}`,name:$("payment-name").value.trim(),bankName:$("payment-bank").value.trim(),accountNumber,beneficiary:$("payment-beneficiary").value.trim(),notes:$("payment-notes").value.trim(),active:existing?.active!==false,createdAt:existing?.createdAt||now,updatedAt:now};
    const next=existing?methods.map(m=>m.id===existing.id?record:m):[...methods,record];
    if(await savePaymentMethods(next)){resetPaymentForm();toast(existing?"تم تحديث بيانات الحساب.":"تمت إضافة حساب التحويل ومشاركته مع الموظفين.");}
  });
  $("payment-cancel-edit").addEventListener("click",resetPaymentForm);
  $("payment-print-all").addEventListener("click",()=>printPaymentMethods());
  $("payment-account-list").addEventListener("click",async e=>{
    const print=e.target.closest("[data-payment-print]");if(print){printPaymentMethods(print.dataset.paymentPrint);return;}
    const edit=e.target.closest("[data-payment-edit]");if(edit){editPaymentMethod(edit.dataset.paymentEdit);return;}
    const toggle=e.target.closest("[data-payment-toggle]");if(toggle){if(currentUser?.role!=="manager")return;const methods=paymentMethods(),method=methods.find(m=>m.id===toggle.dataset.paymentToggle);if(method&&await savePaymentMethods(methods.map(m=>m.id===method.id?{...m,active:method.active===false,updatedAt:new Date().toISOString()}:m)))toast(method.active===false?"تم تفعيل الحساب.":"تم تعطيل الحساب.");return;}
    const remove=e.target.closest("[data-payment-delete]");if(remove){if(currentUser?.role!=="manager")return;const method=paymentMethods().find(m=>m.id===remove.dataset.paymentDelete);if(!method||!confirm(`حذف طريقة الدفع «${method.name}»؟`))return;if(await savePaymentMethods(paymentMethods().filter(m=>m.id!==method.id)))toast("تم حذف طريقة الدفع.");}
  });
  $("staff-schedule-rows").addEventListener("change",e=>{
    const checkbox=e.target.closest("[data-staff-day]");if(!checkbox||currentUser?.role!=="manager")return;
    const id=checkbox.dataset.staffId,day=Number(checkbox.dataset.staffDay),employee=staffRoster.find(person=>person.id===id);if(!employee)return;
    const current=staffScheduleDraft[id]||{name:employee.name,days:[]},days=new Set(current.days||[]);if(checkbox.checked)days.add(day);else days.delete(day);
    staffScheduleDraft[id]={name:employee.name,days:[...days].sort((a,b)=>a-b)};staffScheduleDirty=true;drawStaffSchedule();
  });
  $("staff-schedule-save").addEventListener("click",saveStaffSchedule);
  $("staff-schedule-cancel").addEventListener("click",()=>{staffScheduleDirty=false;staffScheduleDraft={};renderStaffSchedule();});
  $("ledger-customer").addEventListener("change",renderLedger);
  $("ledger-from").addEventListener("change",renderLedger);
  $("ledger-to").addEventListener("change",renderLedger);
  document.addEventListener("click",e=>{
    const closeAction=e.target.closest("[data-approve-cash-close],[data-reopen-cash-close]");if(closeAction){if(currentUser?.role!=="manager")return;const reopening=closeAction.hasAttribute("data-reopen-cash-close");if(reopening&&!confirm("سيُعاد فتح اليوم لتسجيل إقفال بديل مع الاحتفاظ بسجل الاعتماد السابق. هل تريد المتابعة؟"))return;const id=closeAction.dataset.approveCashClose||closeAction.dataset.reopenCashClose,action=reopening?"reopen":"approve";api(`/api/cash-close/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({action})}).then(result=>{stateVersion=result.version;$("cash-close-date").value=result.closing.date;renderCashClose();toast(reopening?"تمت إعادة فتح يوم الإقفال.":"تم اعتماد إقفال اليوم.");}).catch(err=>toast(err.message));return;}
    const toggle=e.target.closest("[data-toggle-user]");
    if(toggle){
      const active=toggle.dataset.active!=="true";
      api(`/api/users/${encodeURIComponent(toggle.dataset.toggleUser)}/active`,{method:"PATCH",body:JSON.stringify({active})}).then(renderUsers).catch(err=>toast(err.message));
      return;
    }
    const printTx=e.target.closest("[data-print-tx]");if(printTx){printReceipt(printTx.dataset.printTx);return;}
    const setLotCost=e.target.closest("[data-set-lot-cost]");if(setLotCost){const lot=(data.inventoryLots||[]).find(x=>x.id===setLotCost.dataset.setLotCost);if(!lot||currentUser?.role!=="manager")return;const raw=prompt("أدخل تكلفة الشراء للقطعة الواحدة في هذه الدفعة:");if(raw===null)return;if(raw.trim()===""){toast("أدخل تكلفة شراء صالحة.");return;}const unitCost=Number(raw),makingRaw=prompt("تكلفة التصنيع للقطعة الواحدة (اختياري):","0");if(makingRaw===null)return;const unitMakingCost=Number(makingRaw);if(!Number.isFinite(unitCost)||unitCost<0||!Number.isFinite(unitMakingCost)||unitMakingCost<0){toast("أدخل تكاليف غير سالبة.");return;}api(`/api/inventory-lots/${encodeURIComponent(lot.id)}/cost`,{method:"PUT",body:JSON.stringify({unitCost,unitMakingCost})}).then(result=>{stateVersion=result.version;data.inventoryLots=data.inventoryLots.map(x=>x.id===lot.id?result.lot:x);renderInventory();toast("تم تسجيل تكلفة الدفعة وتوثيقها في سجل التدقيق.");}).catch(err=>toast(err.message));return;}
    const stock=e.target.closest("[data-stock]");if(stock){const item=data.inventoryItems.find(x=>x.id===stock.dataset.stock);if(!item)return;const direction=stock.dataset.direction,raw=prompt(`${direction==="in"?"كمية الاستلام":"كمية الصرف"} للصنف ${item.name}:`);if(raw===null)return;const quantity=Number(raw);if(!Number.isInteger(quantity)||quantity<=0){toast("أدخل كمية صحيحة أكبر من صفر.");return;}if(direction==="out"&&quantity>item.quantity){toast("الكمية المطلوبة أكبر من المخزون المتاح.");return;}let unitCost=null,unitMakingCost=0;if(direction==="in"){const costRaw=prompt("تكلفة الشراء لكل قطعة بالجنيه (مطلوبة لحساب الربح):");if(costRaw===null)return;if(costRaw.trim()===""){toast("تكلفة شراء الدفعة مطلوبة.");return;}unitCost=Number(costRaw);const makingRaw=prompt("تكلفة التصنيع لكل قطعة بالجنيه (اختياري):","0");if(makingRaw===null)return;unitMakingCost=Number(makingRaw);if(!Number.isFinite(unitCost)||unitCost<0||!Number.isFinite(unitMakingCost)||unitMakingCost<0){toast("أدخل تكلفة صحيحة غير سالبة.");return;}}const note=prompt("ملاحظة اختيارية:")||"";item.quantity+=direction==="in"?quantity:-quantity;const receivedAt=new Date().toISOString(),movement={id:crypto.randomUUID?crypto.randomUUID():`m${Date.now()}`,itemId:item.id,direction,quantity,notes:note,date:receivedAt};data.inventoryMovements.push(movement);if(direction==="in")data.inventoryLots.push({id:crypto.randomUUID?crypto.randomUUID():`lot${Date.now()}`,itemId:item.id,receivedAt,quantityReceived:quantity,quantityRemaining:quantity,unitCost,unitMakingCost});save().then(ok=>{if(ok){renderInventory();renderGoldCalculator();toast("تم تسجيل حركة المخزون وتكلفة الدفعة.");}});return;}
    const reset=e.target.closest("[data-reset-password]");if(reset){openPasswordDialog({title:"إعادة تعيين كلمة مرور الموظف",endpoint:`/api/users/${encodeURIComponent(reset.dataset.resetPassword)}/password`});return;}
    const restore=e.target.closest("[data-restore-backup]");if(restore){if(!confirm(`استعادة ${restore.dataset.restoreBackup}؟ ستُستبدل حالة المخزون والحسابات الحالية.`))return;api(`/api/backups/${encodeURIComponent(restore.dataset.restoreBackup)}/restore`,{method:"POST",body:"{}"}).then(()=>location.reload()).catch(err=>toast(err.message));return;}
    const cb=e.target.closest("[data-customer-ledger]");
    if(cb){$("ledger-customer").value=cb.dataset.customerLedger;showView("ledger");renderLedger();return;}
    const cancel=e.target.closest("[data-cancel]");
    if(cancel){
      const tx=data.transactions.find(t=>t.id===cancel.dataset.cancel);
      if(!tx||tx.status==="cancelled")return;
      const reason=prompt("اكتب سبب إلغاء الحركة (سيتم عكس أثرها في الرصيد):");
      if(reason===null)return;
      if(!reason.trim()){toast("يجب كتابة سبب الإلغاء.");return;}
      // Preserve original row and append an explicit reversal transaction.
      tx.status="cancelled"; tx.cancelReason=reason.trim(); tx.cancelledAt=new Date().toISOString();
      const reversal={...tx,id:crypto.randomUUID?crypto.randomUUID():`t${Date.now()}`,number:`TX-${String(data.nextTransaction++).padStart(7,"0")}`,type:"adjustment",amount:0,paid:0,weight:0,notes:`عكس أثر الحركة الملغاة ${tx.number}: ${reason.trim()}`,status:"approved",reversalOf:tx.id,createdAt:new Date().toISOString()};
      // Keep canceled transactions excluded, and create actual inverse ledger effects using a dedicated internal type.
      reversal.type="reversal";
      reversal.originalType=tx.type;
      data.transactions.push(reversal);
      save().then(ok=>{if(ok){renderAll();toast("تم تسجيل الإلغاء واحتفاظ السجل الأصلي.");}});
    }
  });
  document.addEventListener("change",e=>{
    const permission=e.target.closest("[data-user-permission]");if(!permission)return;const id=permission.dataset.userPermission,permissions=[...document.querySelectorAll(`[data-user-permission="${id}"]:checked`)].map(x=>x.value);api("/api/permissions",{method:"PUT",body:JSON.stringify({userId:id,permissions})}).then(()=>toast("تم تحديث صلاحيات الموظف.")).catch(err=>{permission.checked=!permission.checked;toast(err.message);});
  });
  // Reversal rows negate the original transaction's effects.
  const originalSignedMoney=signedMoney;
  // Wrap balance helpers to recognize reversal transactions.
  function computeMoney(tx){
    if(tx.type==="reversal"){
      const original={...tx,type:tx.originalType,status:"approved"};
      return -originalSignedMoney(original);
    }
    return originalSignedMoney(tx);
  }
  // Replace balance/render helpers with reversal-aware implementations by recalculating balances here.
  const oldCustomerBalance=customerBalance;
  customerBalance=function(customerId){
    // Keep the canceled original in the calculation when a reversal exists;
    // the reversal offsets it, preserving a complete auditable ledger.
    const txs=data.transactions.filter(t=>t.customerId===customerId &&
      (t.status!=="cancelled" || data.transactions.some(r=>r.reversalOf===t.id)));
    const financial=txs.reduce((sum,t)=>sum+computeMoney(t),0);
    const gold={};
    txs.forEach(t=>{
      let change;
      if(t.type==="reversal"){const original={...t,type:t.originalType,status:"approved"};change=-signedGold(original);}
      else change=signedGold(t);
      if(change)gold[t.karat]=(gold[t.karat]||0)+change;
    });
    return {financial,gold};
  };
  function downloadCsvTemplate(type){const headers=type==="customers"?["اسم العميل","الهاتف","ملاحظات"]:["اسم الصنف","كود الصنف","العيار","الوزن (جم)","الكمية","حد التنبيه","تكلفة الشراء للوحدة","مصنعية الوحدة"];const quote=value=>'"'+String(value).replace(/"/g,'""')+'"',blob=new Blob(["\uFEFF"+headers.map(quote).join(",")+"\r\n"],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=type==="customers"?"gold-shop-customers-template.csv":"gold-shop-inventory-template.csv";a.click();URL.revokeObjectURL(url);}
  async function readCsvForPreview(){const file=$("csv-import-file").files?.[0];pendingCsvImport=[];if(!file){renderCsvImportPreview();return;}if(file.size>5*1024*1024){$("csv-import-summary").textContent="حجم الملف أكبر من 5 ميجابايت.";renderCsvImportPreview();return;}pendingCsvImportType=$("csv-import-type").value;const reader=new FileReader();reader.onload=()=>{try{pendingCsvImport=parseCsvImport(reader.result,pendingCsvImportType);renderCsvImportPreview();}catch(err){pendingCsvImport=[];$("csv-import-summary").textContent=err.message;renderCsvImportPreview();$("csv-import-summary").textContent=err.message;}};reader.onerror=()=>{$("csv-import-summary").textContent="تعذرت قراءة الملف.";};reader.readAsText(file,"UTF-8");}
  $("csv-template-customers").addEventListener("click",()=>downloadCsvTemplate("customers"));
  $("csv-template-inventory").addEventListener("click",()=>downloadCsvTemplate("inventory"));
  $("csv-import-file").addEventListener("change",readCsvForPreview);
  $("csv-import-type").addEventListener("change",()=>{if($("csv-import-file").files?.[0])readCsvForPreview();else{pendingCsvImport=[];renderCsvImportPreview();}});
  $("csv-import-apply").addEventListener("click",async()=>{if(currentUser?.role!=="manager"){toast("استيراد البيانات متاح للمدير فقط.");return;}const ready=pendingCsvImport.filter(x=>x.status==="ready");if(!ready.length)return;if(!confirm(`سيتم إضافة ${ready.length} صف صالح إلى البيانات الحالية. الصفوف المكررة أو غير الصالحة مستبعدة. هل تريد المتابعة؟`))return;const before=data,now=new Date().toISOString(),makeId=()=>crypto.randomUUID?crypto.randomUUID():`imp${Date.now()}${Math.random().toString(16).slice(2)}`;if(pendingCsvImportType==="customers"){const customers=[...data.customers],codes=new Set(customers.map(c=>c.code));let nextCustomer=Number(data.nextCustomer)||1;for(const row of ready){let code;do{code=`C-${String(nextCustomer++).padStart(5,"0")}`;}while(codes.has(code));codes.add(code);customers.push({id:makeId(),code,name:row.value.name,phone:row.value.phone,notes:row.value.notes,createdAt:now});}data={...data,customers,nextCustomer};}else{const inventoryItems=[...data.inventoryItems],inventoryMovements=[...data.inventoryMovements],inventoryLots=[...data.inventoryLots];for(const row of ready){const v=row.value,id=makeId(),item={id,name:v.name,sku:v.sku,karat:v.karat,weight:v.weight,quantity:v.quantity,minimum:v.minimum,createdAt:now};inventoryItems.push(item);if(v.quantity>0){const receivedAt=new Date().toISOString();inventoryMovements.push({id:makeId(),itemId:id,direction:"in",quantity:v.quantity,notes:"رصيد افتتاحي مستورد من CSV",date:receivedAt});inventoryLots.push({id:makeId(),itemId:id,receivedAt,quantityReceived:v.quantity,quantityRemaining:v.quantity,unitCost:v.unitCost,unitMakingCost:v.unitMakingCost});}}data={...data,inventoryItems,inventoryMovements,inventoryLots};}if(await save()){renderAll();$("csv-import-file").value="";pendingCsvImport=[];renderCsvImportPreview();toast(`تم استيراد ${ready.length} صف بنجاح.`);}else data=before;});
  $("export-btn").addEventListener("click",()=>{
    if(!can("backup:export")){toast("تصدير النسخ ليس ضمن صلاحيات حسابك أو انتهت صلاحيتها.");return;}
    const blob=new Blob([JSON.stringify({...data,exportedAt:new Date().toISOString(),formatVersion:1},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");a.href=url;a.download=`gold-accounts-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);toast("تم تجهيز ملف النسخة الاحتياطية.");
  });
  $("import-btn").addEventListener("click",async()=>{
    if(currentUser?.role!=="manager"){toast("استعادة النسخ الاحتياطية متاحة للمدير فقط.");return;}
    const file=$("import-file").files[0];if(!file){toast("اختر ملف النسخة الاحتياطية أولًا.");return;}
    if(!confirm("سيتم استبدال البيانات الحالية ببيانات النسخة المختارة. هل تريد المتابعة؟"))return;
    const reader=new FileReader();
    reader.onload=async()=>{
      try{
        const imported=JSON.parse(reader.result);
        if(!imported||!Array.isArray(imported.customers)||!Array.isArray(imported.transactions))throw new Error("invalid");
        data={...data,...imported,customers:imported.customers,transactions:imported.transactions,inventoryItems:imported.inventoryItems||[],inventoryMovements:imported.inventoryMovements||[],settings:imported.settings||data.settings,nextCustomer:imported.nextCustomer||imported.customers.length+1,nextTransaction:imported.nextTransaction||imported.transactions.length+1};
        if(await save()){renderAll();toast("تمت استعادة البيانات بنجاح.");}
      }catch(_){toast("الملف غير صالح أو ليس نسخة احتياطية من هذا النظام.");}
    };reader.readAsText(file);
  });
  $("clear-btn").addEventListener("click",async()=>{
    if(currentUser?.role!=="manager"){toast("مسح البيانات متاح للمدير فقط.");return;}
    if(!confirm("تحذير: سيتم حذف جميع العملاء والحركات من قاعدة بيانات الخادم. هل أنت متأكد؟"))return;
    if(!confirm("تأكيد أخير: هل صدّرت نسخة احتياطية وتريد مسح كل البيانات؟"))return;
    data={...data,customers:[],transactions:[],inventoryItems:[],inventoryMovements:[],nextCustomer:1,nextTransaction:1};if(await save()){renderAll();toast("تم مسح البيانات.");}
  });
  $("user-form").addEventListener("submit",async e=>{
    e.preventDefault();
    try {
      await api("/api/users",{method:"POST",body:JSON.stringify({name:$("user-name").value.trim(),username:$("user-username").value.trim(),password:$("user-password").value,branchId:$("user-branch").value||"main"})});
      e.target.reset();await renderUsers();toast("تم إنشاء حساب الموظف.");
    } catch(err) { toast(err.message); }
  });
  async function compressInventoryImage(file){if(!file)return"";if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>5*1024*1024)throw new Error("اختر صورة PNG أو JPG أو WebP حتى 5 ميجابايت.");const source=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);}),image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=source;}),scale=Math.min(1,900/Math.max(image.width,image.height)),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);const value=canvas.toDataURL("image/jpeg",.72);if(value.length>450000)throw new Error("تعذر ضغط الصورة إلى الحجم المسموح.");return value;}
  $("inventory-form").addEventListener("submit",async e=>{e.preventDefault();const weight=Number($("item-weight").value),quantity=Number($("item-quantity").value),minimum=Number($("item-minimum").value||0),unitCost=Number($("item-unit-cost").value),unitMakingCost=Number($("item-unit-making-cost").value||0);if(!(weight>0)||!Number.isInteger(quantity)||quantity<0||!Number.isInteger(minimum)||minimum<0||unitMakingCost<0||(quantity>0&&($("item-unit-cost").value.trim()===""||!Number.isFinite(unitCost)||unitCost<0))){toast("راجع الوزن والكمية والتكلفة؛ تكلفة الاستلام مطلوبة للكمية الأولية.");return;}let image;try{image=await compressInventoryImage($("item-image-file").files?.[0]);}catch(err){toast(err.message);return;}const item={id:crypto.randomUUID?crypto.randomUUID():`i${Date.now()}`,name:$("item-name").value.trim(),sku:$("item-sku").value.trim(),karat:$("item-karat").value,weight,quantity,minimum,image,createdAt:new Date().toISOString()};data.inventoryItems.push(item);if(quantity>0){const receivedAt=new Date().toISOString();data.inventoryMovements.push({id:`${item.id}-initial`,itemId:item.id,direction:"in",quantity,notes:"رصيد افتتاحي",date:receivedAt});data.inventoryLots.push({id:`${item.id}-lot-1`,itemId:item.id,receivedAt,quantityReceived:quantity,quantityRemaining:quantity,unitCost,unitMakingCost});}if(await save()){e.target.reset();$("item-quantity").value="0";$("item-minimum").value="0";$("item-unit-making-cost").value="0";renderInventory();renderGoldCalculator();toast("تمت إضافة الصنف للمخزون مع تكلفة استلامه.");}});
  $("inventory-search").addEventListener("input",renderInventory);
  $("inventory-scan-form").addEventListener("submit",e=>{e.preventDefault();const raw=$("inventory-scan-code").value.trim(),needle=raw.replace(/\s+/g,"").toLocaleLowerCase();if(!needle)return;const item=(data.inventoryItems||[]).find(x=>String(x.sku||"").replace(/\s+/g,"").toLocaleLowerCase()===needle);if(!item){toast("لم يُعثر على صنف بهذا الباركود أو الرمز.");return;}$("inventory-search").value=item.sku||item.name;renderInventory();$("inventory-scan-code").value="";toast(`تم العثور على ${item.name} · المتاح ${item.quantity} قطعة.`);});
  ["purchase-unit-cost","purchase-unit-making","purchase-quantity","purchase-paid"].forEach(id=>$(id).addEventListener("input",updatePurchasePreview));
  ["purchase-date","supplier-payment-date","cash-close-date"].forEach(id=>$(id).value=localDay());
  $("supplier-form").addEventListener("submit",async e=>{e.preventDefault();try{const result=await api("/api/suppliers",{method:"POST",body:JSON.stringify({name:$("supplier-name").value.trim(),phone:$("supplier-phone").value.trim(),notes:$("supplier-notes").value.trim()})});stateVersion=result.version;e.target.reset();await renderSuppliers();toast("تم حفظ المورد.");}catch(err){toast(err.message);}});
  $("supplier-purchase-form").addEventListener("submit",async e=>{e.preventDefault();const payload={supplierId:$("purchase-supplier").value,invoiceNo:$("purchase-invoice-no").value.trim(),date:$("purchase-date").value,sku:$("purchase-sku").value.trim(),itemName:$("purchase-item-name").value.trim(),karat:$("purchase-karat").value,weight:Number($("purchase-weight").value),quantity:Number($("purchase-quantity").value),unitCost:Number($("purchase-unit-cost").value),unitMakingCost:Number($("purchase-unit-making").value||0),paidNow:Number($("purchase-paid").value||0),paymentMethod:$("purchase-payment-method").value,notes:$("purchase-notes").value.trim()};try{const result=await api("/api/supplier-purchases",{method:"POST",body:JSON.stringify(payload)});stateVersion=result.version;const latest=await api("/api/state");stateVersion=latest.version;data={...data,...latest};delete data.version;delete data.user;e.target.reset();$("purchase-date").value=localDay();$("purchase-quantity").value="1";$("purchase-unit-making").value="0";$("purchase-paid").value="0";updatePurchasePreview();await renderSuppliers();renderInventory();renderDashboard();toast("تم تسجيل فاتورة المورد واستلام المخزون ودفعة FIFO.");}catch(err){toast(err.message);}});
  $("supplier-payment-form").addEventListener("submit",async e=>{e.preventDefault();try{const result=await api("/api/supplier-payments",{method:"POST",body:JSON.stringify({supplierId:$("supplier-payment-supplier").value,amount:Number($("supplier-payment-amount").value),date:$("supplier-payment-date").value,paymentMethod:$("supplier-payment-method").value,note:$("supplier-payment-note").value.trim()})});stateVersion=result.version;e.target.reset();$("supplier-payment-date").value=localDay();await renderSuppliers();toast("تم تسجيل سداد المورد.");}catch(err){toast(err.message);}});
  $("cash-close-form").addEventListener("submit",async e=>{e.preventDefault();if(!confirm("بعد الإرسال سيُقفل سجل اليوم أمام الإرسال مرة أخرى. هل راجعت الحركات والنقد المعدود؟"))return;try{const result=await api("/api/cash-close",{method:"POST",body:JSON.stringify({date:$("cash-close-date").value,openingFloat:Number($("cash-close-opening").value),actualCash:Number($("cash-close-actual").value),notes:$("cash-close-notes").value.trim()})});stateVersion=result.version;await renderCashClose();toast("تم إرسال الإقفال إلى المدير للمراجعة.");}catch(err){toast(err.message);}});
  ["cash-close-opening","cash-close-actual"].forEach(id=>$(id).addEventListener("input",updateCashCloseDifference));
  $("cash-close-date").addEventListener("change",()=>renderCashClose());$("cash-close-refresh").addEventListener("click",()=>renderCashClose());
  $("ledger-search").addEventListener("input",renderLedger);
  $("print-statement-btn").addEventListener("click",printStatement);
  $("report-run").addEventListener("click",renderReports);
  $("report-print").addEventListener("click",printReports);
  ["report-from","report-to"].forEach(id=>$(id).addEventListener("change",renderReports));
  $("report-export").addEventListener("click",()=>{const txs=reportRows(),rows=[["رقم الحركة","التاريخ","العميل","نوع الحركة","الموظف","المبلغ","الوزن"],...txs.map(t=>[t.number,t.date,data.customers.find(c=>c.id===t.customerId)?.name||"",typeNames[t.type]||t.type,t.createdBy?.name||"",t.amount||0,t.weight||0])];const csv="\uFEFF"+rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(",")).join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=`gold-report-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);});
  $("audit-search").addEventListener("input",filterAudit);
  $("backup-now-btn").addEventListener("click",async()=>{try{await api("/api/backups",{method:"POST",body:"{}"});await renderBackups();toast("تم إنشاء نسخة احتياطية على الخادم.");}catch(e){toast(e.message);}});
  $("shop-setup-copy-existing").addEventListener("click",renderSettings);
  $("shop-setup-form").addEventListener("submit",async e=>{e.preventDefault();if(currentUser?.role!=="manager"){toast("تهيئة المحل متاحة للمدير فقط.");return;}const arabicName=$("setup-shop-name-ar").value.trim(),branchName=$("setup-branch-name").value.trim();if(arabicName.length<2||!branchName){toast("أدخل اسم المحل واسم الفرع.");return;}const before=data.settings||{},brand={...printBrand(),arabicName,englishName:$("setup-shop-name-en").value.trim(),tagline:$("setup-shop-tagline").value.trim(),address:$("setup-shop-address").value.trim(),phones:$("setup-shop-phones").value.trim()};data.settings={...before,branchName,printBrand:brand,shopSetupCompletedAt:new Date().toISOString(),shopSetupCompletedBy:currentUser.name};if(await save()){printBrandDraft={...brand};printBrandDirty=false;renderSettings();toast("تم حفظ بيانات المحل والفرع.");}else{data.settings=before;renderSettings();}});
  ["print-brand-ar","print-brand-en","print-brand-tagline","print-brand-address","print-brand-phones","print-brand-footer"].forEach(id=>$(id).addEventListener("input",syncPrintBrandFields));
  $("print-brand-logo-file").addEventListener("change",async e=>{const value=await readPrintImage(e.target.files?.[0]);if(value===null)return;if(!printBrandDraft)printBrandDraft={...printBrand()};printBrandDraft.logoDataUrl=value;printBrandDirty=true;renderPrintBrandPreview();});
  $("print-brand-qr-file").addEventListener("change",async e=>{const value=await readPrintImage(e.target.files?.[0]);if(value===null)return;if(!printBrandDraft)printBrandDraft={...printBrand()};printBrandDraft.qrDataUrl=value;printBrandDirty=true;renderPrintBrandPreview();});
  $("print-brand-logo-remove").addEventListener("click",()=>{if(!printBrandDraft)printBrandDraft={...printBrand()};printBrandDraft.logoDataUrl="";$("print-brand-logo-file").value="";printBrandDirty=true;renderPrintBrandPreview();});
  $("print-brand-qr-remove").addEventListener("click",()=>{if(!printBrandDraft)printBrandDraft={...printBrand()};printBrandDraft.qrDataUrl="";$("print-brand-qr-file").value="";printBrandDirty=true;renderPrintBrandPreview();});
  $("print-template-form").addEventListener("submit",async e=>{e.preventDefault();syncPrintBrandFields();const old=data.settings||{},oldBrand=printBrand(),nextBrand={...printBrandDraft,arabicName:String(printBrandDraft.arabicName||"").trim(),englishName:String(printBrandDraft.englishName||"").trim(),tagline:String(printBrandDraft.tagline||"").trim(),address:String(printBrandDraft.address||"").trim(),phones:String(printBrandDraft.phones||"").trim(),footerNote:String(printBrandDraft.footerNote||"").trim()};data.settings={...old,printBrand:nextBrand};if(await save()){printBrandDraft=nextBrand;printBrandDirty=false;renderPrintBrandPreview();toast("تم حفظ هوية المحل وقالب الطباعة.");}else{data.settings={...old,printBrand:oldBrand};printBrandDraft=oldBrand;printBrandDirty=false;renderSettings();}});
  $("settings-form").addEventListener("submit",async e=>{e.preventDefault();const old=data.settings||{},spread=Number($("setting-buy-spread").value),cashback=Number($("setting-bullion-cashback").value),stamp=Number($("setting-stamp").value),tax=Number($("setting-tax").value);if([spread,cashback,stamp,tax].some(n=>!Number.isFinite(n)||n<0)||tax>100){toast("أدخل قيمًا غير سالبة وتأكد أن الضريبة لا تتجاوز 100%.");return;}data.settings={...old,branchName:$("setting-branch").value.trim()||"الفرع الرئيسي",goldPrice24:Number(old.goldPrice24)||0,makingPerGram:Number($("setting-making").value)||0,taxRate:tax,buySpreadPerGram:spread,bullionCashbackPerGram:cashback,stampPerGram:stamp};if(await save()){updatePreview();updateCalcPreview();toast("تم حفظ إعدادات الفرع والتسعير والشراء.");}});
  $("gold-price-mode").addEventListener("change",()=>{goldPriceFormDirty=true;renderGoldPriceSettings();});
  $("print-template-style").addEventListener("change",async()=>{const previous=data.settings||{},style=$("print-template-style").value;if(!["classic","compact","minimal"].includes(style))return;data.settings={...previous,printTemplate:style};if(await save())toast("تم حفظ شكل الطباعة.");else{data.settings=previous;renderSettings();}});
  [24,21,18].forEach(karat=>$("gold-price-input-"+karat).addEventListener("input",()=>{goldPriceFormDirty=true;}));
  $("gold-prices-form").addEventListener("submit",async e=>{
    e.preventDefault();const mode=$("gold-price-mode").value,body={mode};
    if(mode==="manual"){
      body.prices={};for(const karat of [24,21,18]){const value=Number($("gold-price-input-"+karat).value);if(!Number.isFinite(value)||value<=0){toast("أدخل سعرًا أكبر من صفر لكل عيار.");return;}body.prices[karat]=value;}
    }
    try{goldPriceState=await api("/api/gold-prices",{method:"PUT",body:JSON.stringify(body)});goldPriceFormDirty=false;renderGoldPriceCards();renderGoldPriceSettings();updatePreview();renderGoldCalculator();toast(mode==="manual"?"تم حفظ الأسعار اليدوية ومشاركتها مع المستخدمين.":"تم تفعيل التحديث التلقائي لأسعار الذهب.");}
    catch(err){toast(err.message);}
  });
  $("gold-price-refresh").addEventListener("click",async()=>{const ok=await loadGoldPrices(true);toast(ok?"تم تحديث الأسعار من المصدر العالمي.":"تعذر التحديث؛ سيظل آخر سعر محفوظ ظاهرًا.");});
  function openPasswordDialog({title,endpoint="/api/password",current=false,forced=false}){const screen=$("auth-screen");screen.innerHTML=`<div class="auth-card"><h2>${esc(title)}</h2>${forced?"<p>يجب تعيين كلمة مرور جديدة قبل استخدام النظام.</p>":""}<form id="password-dialog-form">${current?'<label>كلمة المرور الحالية<input name="current" type="password" required autocomplete="current-password"></label>':''}<label>كلمة المرور الجديدة<input name="password" type="password" minlength="10" required autocomplete="new-password"></label><div class="auth-error" id="auth-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">حفظ كلمة المرور</button>${forced?"":'<button class="secondary" type="button" id="close-password-dialog">إلغاء</button>'}</div></form></div>`;screen.hidden=false;if(!forced)$("close-password-dialog").onclick=()=>{screen.hidden=true;};$("password-dialog-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),body={password:String(f.get("password"))};if(current)body.currentPassword=String(f.get("current"));try{await api(endpoint,{method:current?"POST":"PUT",body:JSON.stringify(body)});screen.hidden=true;if(forced){const user=currentUser;user.mustChangePassword=false;await startSession(user);}else toast("تم تحديث كلمة المرور.");}catch(err){$("auth-error").textContent=err.message;}};}
  $("change-password-btn").addEventListener("click",()=>openPasswordDialog({title:"تغيير كلمة المرور",current:true}));
  $("logout-btn").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST",body:"{}"});}finally{currentUser=null;location.reload();}});
  function showAuth(setupRequired) {
    const screen=$("auth-screen");
    screen.innerHTML=`<div class="auth-card"><h2>${setupRequired?"إنشاء حساب المدير":"تسجيل الدخول"}</h2><p>${setupRequired?"أنشئ حساب المدير الأول لإعداد النظام. احتفظ بكلمة المرور في مكان آمن.":"سجّل الدخول بحسابك لمتابعة حسابات العملاء."}</p><form id="auth-form">${setupRequired?'<label>الاسم الكامل<input name="name" required minlength="2" autocomplete="name"></label>':''}<label>اسم المستخدم<input name="username" required minlength="3" maxlength="40" autocomplete="username"></label><label>كلمة المرور<input name="password" type="password" required minlength="${setupRequired?10:1}" autocomplete="current-password"></label>${setupRequired?"":'<label>رمز التحقق بخطوتين (إن كان مفعّلًا)<input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>'}<div class="auth-error" id="auth-error" role="alert"></div><button class="primary" type="submit">${setupRequired?"إنشاء حساب المدير":"دخول"}</button></form></div>`;
    screen.hidden=false;
    $("auth-form").addEventListener("submit",async e=>{
      e.preventDefault();const form=new FormData(e.target),credentials={username:String(form.get("username")).trim(),password:String(form.get("password")),otp:String(form.get("otp")||"")};
      if(setupRequired)credentials.name=String(form.get("name")).trim();
      try { const result=await api(setupRequired?"/api/setup":"/api/login",{method:"POST",body:JSON.stringify(credentials)});await startSession(result.user); }
      catch(err){$("auth-error").textContent=err.message;}
    });
  }
  async function startSession(user) {
    currentUser=user;
    lastHumanActivity=Date.now();
    if(user.mustChangePassword){$("current-user").textContent=`${user.name} — ${user.role==="manager"?"مدير":"موظف"}`;$("auth-screen").hidden=true;openPasswordDialog({title:"تغيير كلمة المرور لأول مرة",current:true,forced:true});return;}
    currentBranchId=user.branchId||"main";
    const state=await api("/api/state");stateVersion=state.version;data={...data,...state};
    if(state.branches)branchesCache=state.branches;
    if(state.branchId)currentBranchId=state.branchId;
    delete data.version;delete data.user;delete data.branches;delete data.branchId;
    sessionIdleTimeoutMinutes=Number(data.settings?.idleTimeoutMinutes)||30;
    $("current-user").textContent=`${user.name} — ${user.role==="manager"?"مدير":"موظف"}`;
    document.querySelectorAll(".manager-only").forEach(el=>{el.hidden=user.role!=="manager";});
    document.querySelectorAll("[data-permission]").forEach(el=>{el.hidden=!can(el.dataset.permission);});
    $("customer-form").hidden=!can("customers:create");
    $("transaction-form").hidden=!can("transactions:create");
    $("calc-use-transaction").hidden=$("transaction-form").hidden;
    $("backup-export-card").hidden=!can("backup:export");
    $("cash-close-form").hidden=!can("vault:edit");
    const vaultFrame=$("view-vault")?.querySelector("iframe");if(vaultFrame&&!vaultFrame.src)vaultFrame.src="/vault/index.html";
    renderBranchSelector();
    $("auth-screen").hidden=true;updateFields();renderAll();renderGoldPriceCards();loadGoldPrices();window.dispatchEvent(new CustomEvent("gca:session",{detail:{user}}));
  }
  document.addEventListener("gca:serial-pieces",e=>{data.serialPieces=Array.isArray(e.detail)?e.detail:[];});
  setInterval(()=>{if(currentUser&&!document.hidden)loadGoldPrices();},60000);
  setInterval(()=>{if(currentUser&&!document.hidden&&$("view-staff-schedule").classList.contains("active"))refreshStaffRoster();},30000);
  let lastHumanActivity=Date.now();["pointerdown","keydown","touchstart"].forEach(type=>document.addEventListener(type,()=>{lastHumanActivity=Date.now();},{passive:true}));
  setInterval(()=>{if(!currentUser||currentUser.mustChangePassword)return;const idle=Date.now()-lastHumanActivity;if(idle>=sessionIdleTimeoutMinutes*60000){location.reload();return;}if(idle<60000)api("/api/session/ping",{method:"POST",body:"{}"}).then(r=>{sessionIdleTimeoutMinutes=Number(r.timeoutMinutes)||sessionIdleTimeoutMinutes;}).catch(error=>{if(error.status===401)location.reload();});},30000);
  setInterval(async()=>{
    if(!currentUser||savingData||document.hidden)return;
    try {
      const state=await api(`/api/state?branchId=${encodeURIComponent(currentBranchId)}`,{headers:{"X-GCA-Background":"1"}});
      if(state.version!==stateVersion){stateVersion=state.version;data={...data,...state};if(state.branches)branchesCache=state.branches;delete data.version;delete data.user;delete data.branches;delete data.branchId;renderAll();renderBranchSelector();const active=document.querySelector(".view.active")?.id?.replace("view-","");if(active==="inventory")renderInventory();if(active==="suppliers")renderSuppliers();if(active==="cash-close")renderCashClose();if(active==="reports")renderReports();if(active==="settings")renderSettings();if(active==="gold-calculator")renderGoldCalculator();if(active==="payment-accounts")renderPaymentMethods();if(active==="staff-schedule")renderStaffSchedule();}
    } catch(e) { if(e.status===401){currentUser=null;showAuth(false);} }
  },10000);
  async function initialize() {
    try { const result=await api("/api/me");await startSession(result.user); }
    catch { try { const status=await api("/api/status");showAuth(status.setupRequired); } catch(e) { showAuth(false);$("auth-screen").querySelector(".auth-error")?.replaceChildren(document.createTextNode("تعذر الاتصال بالخادم. تأكد من تشغيله ثم أعد تحميل الصفحة.")); } }
  }
  // ── Branches UI ───────────────────────────────────────────────────────────
  function renderBranchSelector(){
    const container=$("branch-selector-wrap");
    if(!container)return;
    const isManager=currentUser?.role==="manager";
    const branches=branchesCache.filter(b=>b.active||(isManager));
    if(branches.length<=1){container.hidden=true;return;}
    container.hidden=false;
    const sel=$("branch-selector");
    if(!sel)return;
    const prev=sel.value;
    sel.innerHTML=`${isManager?'<option value="all">كل الفروع</option>':''}${branches.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join("")}`;
    if(branches.some(b=>b.id===prev)||(isManager&&prev==="all"))sel.value=prev;
    else sel.value=currentBranchId;
    const activeName=branches.find(b=>b.id===currentBranchId)?.name||data.settings?.branchName||"الفرع الرئيسي";
    const label=$("branch-active-name");
    if(label)label.textContent=activeName;
  }
  async function switchBranch(branchId){
    currentBranchId=branchId;
    try{
      const state=await api(`/api/state?branchId=${encodeURIComponent(branchId)}`);
      stateVersion=state.version;data={...data,...state};
      if(state.branches)branchesCache=state.branches;
      delete data.version;delete data.user;delete data.branches;delete data.branchId;
      renderBranchSelector();renderAll();
      const active=document.querySelector(".view.active")?.id?.replace("view-","");
      if(active==="inventory")renderInventory?.();
      if(active==="reports")renderReports?.();
    }catch(e){toast(e.message);}
  }
  async function renderBranchManagement(){
    if(currentUser?.role!=="manager")return;
    const container=$("branch-management-rows");
    if(!container)return;
    try{
      const result=await api("/api/branches");branchesCache=result.branches;
      container.innerHTML=branchesCache.map(b=>`<tr>
        <td>${esc(b.name)}</td>
        <td>${esc(b.address||"—")}</td>
        <td>${esc(b.phone||"—")}</td>
        <td><span class="pill ${b.active?"":"red"}">${b.active?"نشط":"معطّل"}</span></td>
        <td class="row-actions">
          <button class="small-btn" data-edit-branch="${b.id}">تعديل</button>
          ${b.id!=="main"?`<button class="small-btn" data-toggle-branch="${b.id}" data-active="${b.active}">${b.active?"تعطيل":"تفعيل"}</button>`:""}
        </td>
      </tr>`).join("")||`<tr><td colspan="5" class="empty">لا توجد فروع.</td></tr>`;
      renderBranchSelector();
    }catch(e){toast(e.message);}
  }
  document.addEventListener("click",async e=>{
    const editBtn=e.target.closest("[data-edit-branch]");
    if(editBtn){
      const id=editBtn.dataset.editBranch;
      const branch=branchesCache.find(b=>b.id===id);
      if(!branch)return;
      const name=prompt("اسم الفرع:",branch.name);if(!name||!name.trim())return;
      const address=prompt("العنوان (اختياري):",branch.address||"");
      const phone=prompt("الهاتف (اختياري):",branch.phone||"");
      try{await api(`/api/branches/${id}`,{method:"PATCH",body:JSON.stringify({name:name.trim(),address:(address||"").trim(),phone:(phone||"").trim()})});await renderBranchManagement();toast("تم تحديث الفرع.");}
      catch(err){toast(err.message);}
      return;
    }
    const toggleBtn=e.target.closest("[data-toggle-branch]");
    if(toggleBtn){
      const id=toggleBtn.dataset.toggleBranch,active=toggleBtn.dataset.active==="true";
      if(!confirm(`هل تريد ${active?"تعطيل":"تفعيل"} هذا الفرع؟`))return;
      try{await api(`/api/branches/${id}`,{method:"PATCH",body:JSON.stringify({active:!active})});await renderBranchManagement();toast("تم تحديث حالة الفرع.");}
      catch(err){toast(err.message);}
    }
  });
  const addBranchForm=$("add-branch-form");
  if(addBranchForm){
    addBranchForm.addEventListener("submit",async e=>{
      e.preventDefault();
      const f=new FormData(e.target);
      const name=String(f.get("name")||"").trim();
      const address=String(f.get("address")||"").trim();
      const phone=String(f.get("phone")||"").trim();
      if(name.length<2)return toast("أدخل اسمًا للفرع (حرفان على الأقل).");
      try{
        const result=await api("/api/branches",{method:"POST",body:JSON.stringify({name,address,phone})});
        branchesCache.push(result.branch);e.target.reset();
        await renderBranchManagement();toast("تم إضافة الفرع بنجاح.");
      }catch(err){toast(err.message);}
    });
  }
  const branchSel=$("branch-selector");
  if(branchSel){
    branchSel.addEventListener("change",()=>switchBranch(branchSel.value));
  }
  // ── End Branches UI ───────────────────────────────────────────────────────
  buildCalcProductOptions();
  $("today").textContent=new Date().toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  initialize();
})();
