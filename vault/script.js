const KEY="vault_reconciliation_v3";
const $=id=>document.getElementById(id);

const date=$("date"),day=$("day"),employee=$("employeeName"),opening=$("openingBalance");
const actual=$("actualBalance"),systemInput=$("systemBalanceInput"),notes=$("notes"),ops=$("operations");
let currentDate="";
let vaultCache={},vaultBase={},vaultVersion=0,vaultEditSeq=0,vaultSaveTimer=null,vaultSaving=false,vaultSaveAgain=false,vaultDirty=false,vaultConflict=null,vaultRetryCount=0,vaultPolling=false,vaultCanEdit=false,vaultIsManager=false;

function money(n){return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function localDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function today(){return localDate()}
function dayName(v){return ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][new Date(v+"T00:00:00").getDay()]}
function records(){return vaultCache}
function sameValue(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null)}
function changedDates(base,next){return [...new Set([...Object.keys(base||{}),...Object.keys(next||{})])].filter(d=>!sameValue(base?.[d],next?.[d]))}
function mergeRecords(latest,source,dates){const merged=JSON.parse(JSON.stringify(latest||{}));for(const d of dates){if(Object.prototype.hasOwnProperty.call(source||{},d))merged[d]=source[d];else delete merged[d]}return merged}
function saveRecords(r){vaultCache=r;vaultDirty=true;vaultEditSeq++;if(vaultConflict){setStatus("⚠ يوجد تعارض يحتاج اختيارك قبل الحفظ");return}setStatus("⏳ جارٍ الحفظ على الخادم...");clearTimeout(vaultSaveTimer);vaultSaveTimer=setTimeout(syncVault,350)}
async function syncVault(){
 if(vaultSaving){vaultSaveAgain=true;return}if(vaultConflict)return;vaultSaving=true;vaultSaveAgain=false;
 const seq=vaultEditSeq,sent=JSON.parse(JSON.stringify(vaultCache)),base=JSON.parse(JSON.stringify(vaultBase));
 try{const result=await fetch("/api/vault",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({records:sent,baseRecords:base})});const body=await result.json().catch(()=>({}));if(!result.ok){const error=new Error(body.error||"تعذر حفظ مطابقة الخزنة.");error.status=result.status;error.body=body;throw error;}vaultRetryCount=0;const latest=body.records||sent,followup=changedDates(sent,vaultCache);vaultBase=latest;vaultCache=mergeRecords(latest,vaultCache,followup);vaultVersion=body.version||vaultVersion;if(seq===vaultEditSeq){vaultDirty=false;renderHistory();updatePeriodStats();setStatus("🟢 تم الحفظ على الخادم");}else vaultSaveAgain=true;}
 catch(e){console.error("Vault save failed",e);if(e.status===409&&e.body?.records){const latest=e.body.records,changed=changedDates(base,sent),conflicts=changed.filter(d=>!sameValue(latest[d],base[d])&&!sameValue(latest[d],sent[d]));vaultVersion=e.body.version||vaultVersion;if(conflicts.length){vaultConflict={base,sent,latest,changed,conflicts};showVaultConflict();setStatus("⚠ يلزم حسم تعارض قبل الحفظ");}else{vaultBase=latest;vaultCache=mergeRecords(latest,sent,changed);vaultSaveAgain=true;setStatus("🔄 دُمجت تغييرات الأيام المختلفة؛ جارٍ إكمال الحفظ");}}else{setStatus(e.status===401||e.status===403?"⚠ انتهت الجلسة أو لا تملك صلاحية التعديل":"⚠ تعذر الاتصال؛ سيعيد النظام المحاولة");if(![401,403].includes(e.status)){vaultRetryCount++;vaultSaveAgain=true;}}}
 finally{vaultSaving=false;if(vaultSaveAgain&&!vaultConflict){vaultSaveAgain=false;clearTimeout(vaultSaveTimer);const wait=vaultRetryCount?Math.min(15000,1000*2**Math.min(vaultRetryCount,4)):250;vaultSaveTimer=setTimeout(syncVault,wait)}}
}
function showVaultConflict(){const box=$("vaultConflictNotice");$("vaultConflictText").textContent=`اليوم/الأيام المتعارضة: ${vaultConflict.conflicts.join("، ")}. اختر نسخة لهذا اليوم؛ بقية الأيام غير المتعارضة ستُدمج تلقائيًا.`;box.classList.remove("hidden")}
function resolveVaultConflict(useLocal){if(!vaultConflict)return;const c=vaultConflict,latest=c.latest;vaultBase=latest;vaultCache=mergeRecords(latest,c.sent,c.changed.filter(d=>useLocal||!c.conflicts.includes(d)));vaultConflict=null;vaultDirty=true;$("vaultConflictNotice").classList.add("hidden");saveRecords(vaultCache)}
function exportConflictingLocal(){if(!vaultConflict)return;const data={};for(const d of vaultConflict.changed)if(Object.prototype.hasOwnProperty.call(vaultConflict.sent,d))data[d]=vaultConflict.sent[d];const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="تعديلات-مطابقة-الخزنة-المحلية.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$("vaultUseServer").onclick=()=>resolveVaultConflict(false);$("vaultUseLocal").onclick=()=>resolveVaultConflict(true);$("vaultExportLocal").onclick=exportConflictingLocal;
async function initializeVault(){
 try{const res=await fetch("/api/vault",{credentials:"same-origin"}),body=await res.json().catch(()=>({}));if(!res.ok)throw new Error(body.error||"تعذر تحميل مطابقة الخزنة.");vaultCache=body.records||{};vaultBase=JSON.parse(JSON.stringify(vaultCache));vaultVersion=body.version||0;vaultDirty=false;vaultIsManager=body.user?.role==="manager";const permissionAlive=!body.user?.permissionsExpiresAt||Date.parse(body.user.permissionsExpiresAt)>Date.now();vaultCanEdit=vaultIsManager||(permissionAlive&&(body.user?.permissions||[]).includes("vault:edit"));$("vaultUserBadge").textContent=`المستخدم المسجل: ${body.user?.name||"—"} · تُحفظ البيانات مركزيًا على خادم الفرع${vaultCanEdit?"":" · وضع العرض فقط"}`;document.body.classList.toggle("vault-readonly",!vaultCanEdit);load(today());restoreReconciliation();setupPeriod();updatePeriodStats();repeatedShortageAlert();}
 catch(e){setStatus("⚠ تعذر الاتصال بخادم النظام");console.error("Vault load failed",e);}
}
function isEditingVault(){return document.activeElement?.matches("input,select,textarea")&&!document.activeElement.disabled}
async function pollVault(){if(vaultPolling||document.hidden||vaultDirty||vaultSaving||vaultConflict||isEditingVault())return;vaultPolling=true;try{const res=await fetch("/api/vault",{credentials:"same-origin",cache:"no-store"});if(!res.ok)return;const body=await res.json();if(body.version!==vaultVersion){const next=body.records||{},changed=!sameValue(next,vaultCache);vaultBase=JSON.parse(JSON.stringify(next));vaultVersion=body.version||0;if(changed){vaultCache=next;load(currentDate||today());restoreReconciliation();updatePeriodStats();repeatedShortageAlert();setStatus("🔄 تم تحديث السجل من جهاز آخر");}}}catch(e){console.warn("Vault refresh deferred",e)}finally{vaultPolling=false}}
setInterval(pollVault,5000);
window.addEventListener("beforeunload",e=>{if(vaultDirty||vaultSaving){e.preventDefault();e.returnValue=""}});
function setStatus(t){$("saveStatus").textContent=t}

function emptyRows(){return []}
function hasOperationData(x){return ["income","outcome","description","employee","systemRef"].some(k=>String(x?.[k]??"").trim()!=="")}
function readOperationRow(tr){return {income:tr.querySelector(".in").value,outcome:tr.querySelector(".out").value,description:tr.querySelector(".desc").value,employee:tr.querySelector(".row-employee")?.value||"",systemRef:tr.querySelector(".system-ref")?.value||"",locked:tr.classList.contains("row-locked")}}
function rowIsEmpty(tr){return !hasOperationData(readOperationRow(tr))}

function load(d){
 currentDate=d;
 let all=records();
 let created=false;
 if(!all[d]){
   const prev=Object.keys(all).filter(x=>x<d).sort().pop();
   const prevClosing=prev&&all[prev]?getDayClosing(all[prev]):0;
   all[d]={date:d,day:dayName(d),opening:prevClosing,openingAuto:!!prev,system:null,actual:null,employee:"",notes:"",closed:false,rows:emptyRows()};created=true;
 }
 let r=all[d];
 date.value=d;
 day.value=r.day||dayName(d);
 employee.value=r.employee||"";
 opening.value=r.opening||""; actual.value=r.actual??""; systemInput.value=r.system??""; notes.value=r.notes||"";
 renderRows(r.rows||[]);
 if(created)saveRecords(all); updateLock(); calculate(); renderHistory();
}

function getDayClosing(r){
 let b=Number(r?.opening)||0;
 for(const x of (r?.rows||[])){b+=(parseFloat(x.income)||0)-(parseFloat(x.outcome)||0)}
 return b;
}

function createOperationRow(x={},i=ops.rows.length){
   const tr=document.createElement("tr");
   tr.innerHTML=`<td class="num">${i+1}</td>
   <td><input class="in" type="number" min="0" step=".01" value="${esc(x.income)}"></td>
   <td><input class="out" type="number" min="0" step=".01" value="${esc(x.outcome)}"></td>
   <td><input class="desc" type="text" value="${esc(x.description)}" placeholder="البيان"></td>
   <td><input class="row-employee" type="text" value="${esc(x.employee||"")}" placeholder="اسم الموظف"></td>
   <td class="system-ref-col"><input class="system-ref" type="text" inputmode="numeric" value="${esc(x.systemRef||"")}" placeholder="رقم الحركة"></td>
   <td class="balance">0.00</td><td><button type="button" class="row-lock" title="قفل الصف">🔓</button></td>`;
   tr.querySelector(".row-lock")?.addEventListener("click",()=>toggleRowLock(tr));
   tr.querySelectorAll("input").forEach(inp=>inp.addEventListener("input",()=>{
      if(inp.classList.contains("in")&&inp.value)tr.querySelector(".out").value="";
      if(inp.classList.contains("out")&&inp.value)tr.querySelector(".in").value="";
      calculate(); save();
   }));
   return tr;
}
function renderRows(data){
 ops.innerHTML="";
 const rows=(Array.isArray(data)?data:[]).filter(hasOperationData);
 rows.forEach((x,i)=>ops.appendChild(createOperationRow(x,i)));
}

function calculate(){
 let bal=parseFloat(opening.value)||0, tin=0,tout=0;
 const footer=ops.closest("table")?.tFoot;if(footer)footer.hidden=![...ops.rows].some(tr=>!rowIsEmpty(tr));
 [...ops.rows].forEach(tr=>{
   tin+=parseFloat(tr.querySelector(".in").value)||0;
   tout+=parseFloat(tr.querySelector(".out").value)||0;
   bal += (parseFloat(tr.querySelector(".in").value)||0)-(parseFloat(tr.querySelector(".out").value)||0);
   tr.querySelector(".balance").textContent=money(bal);
 });
 $("finalSystemBalance").textContent=money(bal);
 $("totalIn").textContent=money(tin); $("totalOut").textContent=money(tout);
 $("footIn").textContent=money(tin); $("footOut").textContent=money(tout); $("footBalance").textContent=money(bal);
 const system=parseFloat(systemInput.value);
 const a=parseFloat(actual.value),card=$("differenceCard");
 card.className="balance-card difference neutral";
 if(Number.isNaN(system)){
   $("difference").textContent="0.00";
   $("differenceText").textContent="أدخل رصيد السيستم";
   return;
 }
 if(Number.isNaN(a)){
   $("difference").textContent="0.00";
   $("differenceText").textContent="أدخل الرصيد الفعلي";
   return;
 }
 const diff=a-system;
 $("difference").textContent=money(Math.abs(diff));
 if(Math.abs(diff)<.005){card.className="balance-card difference match";$("differenceText").textContent="مطابق تمامًا"}
 else if(diff<0){card.className="balance-card difference shortage";$("differenceText").textContent="عجز في الخزنة"}
 else{card.className="balance-card difference surplus";$("differenceText").textContent="فائض في الخزنة"}
 applySearch();
}

function save(){
 let all=records(),r=all[currentDate];
 r.day=day.value;
 r.opening=parseFloat(opening.value)||0;
 r.system=systemInput.value===""?null:parseFloat(systemInput.value);
 r.actual=actual.value===""?null:parseFloat(actual.value);
 r.employee=employee.value;r.notes=notes.value;
 r.rows=[...ops.rows].map(readOperationRow).filter(hasOperationData);
 r.updatedAt=new Date().toISOString();
 saveRecords(all);renderHistory();
}

function toggleRowLock(tr){
 const locked=!tr.classList.contains("row-locked");
 tr.classList.toggle("row-locked",locked);
 tr.querySelectorAll("input").forEach(i=>i.disabled=locked||!!records()[currentDate]?.closed);
 const b=tr.querySelector(".row-lock"); if(b)b.textContent=locked?"🔒":"🔓";
 save();
}

function updateLock(){
 let r=records()[currentDate], closed=!!r.closed;
 $("closedBanner").classList.toggle("hidden",!closed);
 $("closeDayBtn").classList.toggle("hidden",closed);
 $("openDayBtn").classList.toggle("hidden",!closed);
 [opening,systemInput,actual,employee,notes,day,$("quickTypeIn"),$("quickTypeOut"),$("quickAmount"),$("quickDescription"),$("quickSystemRef"),$("quickAddBtn")].filter(Boolean).forEach(x=>x.disabled=closed);
 ops.querySelectorAll("input").forEach(x=>x.disabled=closed);
 $("addBtn").disabled=closed;
 $("openDayBtn").classList.toggle("hidden",!closed||!vaultIsManager);
 if(!vaultCanEdit){[date,day,employee,opening,systemInput,actual,notes,$("addBtn"),$("clearBtn"),$("newDayBtn"),$("closeDayBtn"),$("systemPdf"),$("actualVaultBalance"),$("analyzeSystemReport"),$("clearReconciliation"),$("backupFile"),$("importBackupBtn"),$("quickTypeIn"),$("quickTypeOut"),$("quickAmount"),$("quickDescription"),$("quickSystemRef"),$("quickAddBtn")].filter(Boolean).forEach(x=>x.disabled=true);ops.querySelectorAll("input,button").forEach(x=>x.disabled=true);document.querySelectorAll(".row-lock,.save-review,.review-status,.review-comment").forEach(x=>x.disabled=true);}
}

$("closeDayBtn").onclick=()=>{
 if(!confirm("هل تريد إغلاق هذا اليوم؟ لن يمكن تعديل البيانات حتى يفتحه المدير مرة أخرى."))return;
 let all=records();all[currentDate].closed=true;all[currentDate].closedAt=new Date().toISOString();saveRecords(all);updateLock();setStatus("🔒 تم إغلاق اليوم — جارٍ الحفظ");renderHistory();
}
$("openDayBtn").onclick=()=>{
 if(!confirm("هل تريد فتح اليوم للتعديل؟"))return;
 let all=records();all[currentDate].closed=false;all[currentDate].closedAt=null;saveRecords(all);updateLock();setStatus("🟢 تم فتح اليوم — جارٍ الحفظ");
}
$("newDayBtn").onclick=()=>{
 const d=today(); const all=records();
 if(!all[d]){const prev=Object.keys(all).filter(x=>x<d).sort().pop();const openingValue=prev?getDayClosing(all[prev]):0;all[d]={date:d,day:dayName(d),opening:openingValue,openingAuto:!!prev,system:null,actual:null,employee:"",notes:"",closed:false,rows:emptyRows()};saveRecords(all);}
 load(d);
 if(records()[d]?.openingAuto) setStatus("⏳ تم ترحيل الرصيد الافتتاحي — جارٍ الحفظ على الخادم");
};
date.onchange=()=>load(date.value);
day.onchange=()=>{save();};

document.addEventListener("dblclick",e=>{const tr=e.target.closest("#operations tr.row-locked");if(!tr)return;tr.classList.remove("row-locked");tr.querySelectorAll("input").forEach(i=>i.disabled=false);const b=tr.querySelector(".row-lock");if(b)b.textContent="🔓";save();});
[opening,systemInput,actual,employee,notes].forEach(x=>x.addEventListener("input",()=>{calculate();save()}));

$("addBtn").onclick=()=>{
 if(ops.rows.length>=100){alert("تم الوصول إلى 100 عملية.");return}
 const waiting=[...ops.rows].find(tr=>rowIsEmpty(tr)&&!tr.classList.contains("row-locked"));
 if(waiting){waiting.querySelector(".in")?.focus();return}
 const tr=createOperationRow({},ops.rows.length);ops.appendChild(tr);calculate();save();tr.querySelector(".in")?.focus();
}
let quickEntryType="in";
function selectQuickType(type){
 quickEntryType=type;
 $("quickTypeIn").classList.toggle("selected",type==="in");$("quickTypeOut").classList.toggle("selected",type==="out");
 $("quickTypeIn").setAttribute("aria-pressed",String(type==="in"));$("quickTypeOut").setAttribute("aria-pressed",String(type==="out"));
 $("quickAmount").focus();
}
$("quickTypeIn")?.addEventListener("click",()=>selectQuickType("in"));
$("quickTypeOut")?.addEventListener("click",()=>selectQuickType("out"));
function addQuickOperation(){
 const amount=parseReconNumber($("quickAmount").value),status=$("quickEntryStatus");
 if(!Number.isFinite(amount)||amount<=0){status.textContent="أدخل مبلغًا أكبر من صفر.";$("quickAmount").focus();return}
 let tr=[...ops.rows].find(row=>!row.classList.contains("row-locked")&&rowIsEmpty(row));
 if(!tr){if(ops.rows.length>=100){status.textContent="وصلت إلى الحد الأقصى: 100 عملية.";return}tr=createOperationRow({},ops.rows.length);ops.appendChild(tr)}
 tr.querySelector(quickEntryType==="in"?".in":".out").value=amount.toFixed(2);
 tr.querySelector(quickEntryType==="in"?".out":".in").value="";
 tr.querySelector(".desc").value=$("quickDescription").value.trim();
 tr.querySelector(".system-ref").value=$("quickSystemRef").value.trim();
 tr.querySelector(".row-employee").value=employee.value.trim();
 calculate();save();
 status.textContent=`تمت إضافة ${quickEntryType==="in"?"دخول":"خروج"} ${money(amount)}. جاهز للحركة التالية.`;
 $("quickAmount").value="";$("quickDescription").value="";$("quickSystemRef").value="";$("quickAmount").focus();
}
$("quickAddBtn")?.addEventListener("click",addQuickOperation);
["quickAmount","quickDescription","quickSystemRef"].forEach(id=>$(id)?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addQuickOperation()}}));
$("quickAmount")?.addEventListener("input",()=>{if($("quickEntryStatus").textContent.startsWith("أدخل مبلغًا"))$("quickEntryStatus").textContent="الموظف المحدد أعلى الصفحة سيُسجّل تلقائيًا على الحركة."});
$("clearBtn").onclick=()=>{
 let r=records()[currentDate];if(r.closed){alert("اليوم مغلق. افتحه أولًا.");return}
 if(!confirm("هل تريد مسح بيانات هذا اليوم؟"))return;
 let all=records();all[currentDate]={date:currentDate,day:dayName(currentDate),opening:0,system:null,actual:null,employee:"",notes:"",closed:false,rows:emptyRows()};saveRecords(all);load(currentDate);
}
$("printBtn").onclick=()=>{
    calculate();
    const panel=document.querySelector(".report-panel");
    if(panel){
        panel.scrollIntoView({behavior:"smooth",block:"center"});
        panel.style.outline="3px solid #1976d2";
        setTimeout(()=>panel.style.outline="",1200);
    }
}
$("backupBtn").onclick=()=>{
 let blob=new Blob([JSON.stringify(records(),null,2)],{type:"application/json"});
 let a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`سجل-مطابقة-الخزنة-${currentDate}.json`;a.click();URL.revokeObjectURL(a.href);
}

$("importBackupBtn")?.addEventListener("click",()=>$("backupFile")?.click());
$("backupFile")?.addEventListener("change",e=>{
 const file=e.target.files?.[0]; if(!file)return;
 const reader=new FileReader();
 reader.onload=()=>{
  try{
   const imported=JSON.parse(reader.result);
   if(!imported||typeof imported!=="object"||Array.isArray(imported)) throw new Error("invalid");
   if(!confirm("سيتم استبدال بيانات الأيام الحالية بالنسخة المستوردة عند وجود نفس التاريخ. هل تريد المتابعة؟"))return;
   const current=records(); Object.keys(imported).forEach(d=>{if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&imported[d]&&typeof imported[d]==="object") current[d]=imported[d]});
   saveRecords(current); load(currentDate||today()); alert("تم استيراد النسخة الاحتياطية بنجاح.");
  }catch(err){alert("ملف النسخة الاحتياطية غير صالح أو غير مدعوم.");}
  e.target.value="";
 }; reader.readAsText(file);
});

window.addEventListener("keydown",e=>{
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();save();setStatus("💾 تم الحفظ يدويًا");}
 if(e.altKey&&e.code==="Digit1"){e.preventDefault();selectQuickType("in");return}
 if(e.altKey&&e.code==="Digit2"){e.preventDefault();selectQuickType("out");return}
 if(!e.target.matches("#operations input"))return;
 const field=["in","out","desc","row-employee","system-ref"].find(c=>e.target.classList.contains(c));
 if(!field)return;
 const down=e.key==="ArrowDown"||(e.key==="Enter"&&!e.shiftKey),up=e.key==="ArrowUp"||(e.key==="Enter"&&e.shiftKey);
 if(!down&&!up)return;
 e.preventDefault();const rows=[...ops.rows],current=rows.indexOf(e.target.closest("tr"));let nextIndex=current+(down?1:-1);
 while(nextIndex>=0&&nextIndex<rows.length&&(rows[nextIndex].classList.contains("filtered")||rows[nextIndex].querySelector(`.${field}`)?.disabled))nextIndex+=down?1:-1;
 if(nextIndex>=0&&nextIndex<rows.length){rows[nextIndex].querySelector(`.${field}`)?.focus();return}
 if(down&&rows.length<100&&!rows.some(rowIsEmpty)){const tr=createOperationRow({},rows.length);ops.appendChild(tr);tr.querySelector(`.${field}`)?.focus();save()}
});

$("search").oninput=applySearch;
function applySearch(){let q=$("search").value.toLowerCase();let count=0;[...ops.rows].forEach(tr=>{let show=!q||tr.textContent.toLowerCase().includes(q);tr.classList.toggle("filtered",!show);if(show)count++})}

function renderHistory(){
 let h=$("history"),all=records(),dates=Object.keys(all).sort().reverse();h.innerHTML="";
 let grid=document.createElement("div");grid.className="history-grid";
 dates.forEach(d=>{
  let r=all[d],a=r.actual,sys=r.system,diff=(Number.isFinite(a)&&Number.isFinite(sys))?a-sys:null;
  let card=document.createElement("div");card.className="history-card "+(r.closed?"closed":"");
  card.innerHTML=`<strong>${r.day||dayName(d)} — ${d} ${r.closed?"🔒":"🟠"}</strong><small>السيستم: ${sys==null?"—":money(sys)}<br>الفعلي: ${a==null?"—":money(a)}<br>${diff==null?"لم تتم المطابقة":(diff<0?"عجز: "+money(Math.abs(diff)):diff>0?"فائض: "+money(diff):"مطابق")} </small><div class="history-actions"><button class="load">فتح</button></div>`;
  card.querySelector(".load").onclick=()=>load(d);grid.appendChild(card);
 });h.appendChild(grid);
}
function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
// Initial records are loaded from the shared server after the full module initializes.

const REPORT_PREF_KEY="vault_report_columns_v1";
function getReportColumns(){
 let saved;
 try{saved=JSON.parse(localStorage.getItem(REPORT_PREF_KEY))}catch(e){}
 const boxes=[...document.querySelectorAll(".report-col")];
 if(Array.isArray(saved)){
   boxes.forEach(b=>b.checked=saved.includes(b.dataset.col));
 }
 return boxes;
}
function saveReportColumns(){
 const cols=[...document.querySelectorAll(".report-col:checked")].map(x=>x.dataset.col);
 localStorage.setItem(REPORT_PREF_KEY,JSON.stringify(cols));
}
const REPORT_PAPER_KEY="vault_report_paper_v1";
function loadReportPaper(){
 const select=$("reportPaperSize");
 if(!select)return;
 let saved="";
 try{saved=localStorage.getItem(REPORT_PAPER_KEY)||""}catch(e){}
 select.value=saved==="A5"?"A5":"A4";
}
async function generateReport(){
 saveReportColumns();
 const selected=new Set([...document.querySelectorAll(".report-col:checked")].map(x=>x.dataset.col));
 const cols=["number","income","outcome","description","employee","systemRef","balance"].filter(c=>selected.has(c));
 if(!cols.length){alert("اختر عمودًا واحدًا على الأقل من تفاصيل العمليات.");return}
 const w=window.open("","_blank","width=900,height=1100");
 if(!w){alert("المتصفح منع نافذة التقرير. اسمح للنظام بفتح النوافذ المنبثقة ثم حاول مرة أخرى.");return;}
 w.document.write("<!doctype html><html lang='ar' dir='rtl'><meta charset='UTF-8'><title>جارٍ تجهيز التقرير</title><body style='font-family:Arial,Tahoma,sans-serif;padding:32px;text-align:center'>جارٍ تجهيز قالب التقرير…</body></html>");
 let brand={branchName:"الفرع الرئيسي",brand:{arabicName:"العزيز بالله",englishName:"AL-AZIZ BELLAH",tagline:"JEWELRY",address:"",phones:"",footerNote:"",logoDataUrl:"",qrDataUrl:""}};
 try{const response=await fetch("/api/print-brand",{credentials:"same-origin"});if(response.ok)brand=await response.json();}catch(e){console.warn("Could not load print branding",e)}
 const b=brand.brand||{},logo=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.logoDataUrl||"")?"<img class='brand-logo' src='"+esc(b.logoDataUrl)+"' alt=''>":"",qr=/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.qrDataUrl||"")?"<img class='brand-qr' src='"+esc(b.qrDataUrl)+"' alt='رمز QR'>":"";
 const brandArabic=esc(b.arabicName||"العزيز بالله"),brandEnglish=esc(b.englishName||"AL-AZIZ BELLAH"),tagline=esc(b.tagline||""),branchName=esc(brand.branchName||"الفرع الرئيسي"),contact=[b.address,b.phones].filter(Boolean).map(esc).join(" · "),footerNote=esc(b.footerNote||"");

 const r=records()[currentDate]||{};
 const toAmount=v=>{
   if(v===null||v===undefined||String(v).trim()==="")return 0;
   const n=Number(v);return Number.isFinite(n)?n:0;
 };
 const amountOrNull=v=>{
   if(v===null||v===undefined||String(v).trim()==="")return null;
   const n=Number(v);return Number.isFinite(n)?n:null;
 };
 const openingAmount=toAmount(r.opening);
 const system=amountOrNull(r.system),actual=amountOrNull(r.actual);
 const diff=system===null||actual===null?null:actual-system;
 const sourceRows=Array.isArray(r.rows)?r.rows:[];
 const activeRows=sourceRows.filter(x=>
   ["income","outcome","description","employee","systemRef"].some(k=>String(x?.[k]??"").trim()!=="")
 );
 let balance=openingAmount,totalIn=0,totalOut=0;
 const rows=activeRows.map((x,i)=>{
   const income=toAmount(x.income),outcome=toAmount(x.outcome);
   totalIn+=income;totalOut+=outcome;balance+=income-outcome;
   return {number:i+1,income:x.income??"",outcome:x.outcome??"",description:x.description??"",
     employee:x.employee??"",systemRef:x.systemRef??"",balance};
 });
 const closing=openingAmount+totalIn-totalOut;
 const labels={number:"رقم",income:"الدخول",outcome:"الخروج",description:"البيان",employee:"الموظف",systemRef:"مرجع السيستم",balance:"الرصيد بعد العملية"};
 const weights={number:7,income:12,outcome:12,description:32,employee:13,systemRef:12,balance:18};
 const weightTotal=cols.reduce((sum,c)=>sum+weights[c],0);
 const colgroup="<colgroup>"+cols.map(c=>"<col style='width:"+((weights[c]/weightTotal)*100).toFixed(2)+"%'>").join("")+"</colgroup>";
 let table="<table>"+colgroup+"<thead><tr>"+cols.map(c=>"<th>"+labels[c]+"</th>").join("")+"</tr></thead><tbody>";
 if(rows.length){
   table+=rows.map(x=>"<tr>"+cols.map(c=>{
     const v=x[c];
     const cellClass=c==="income"?"cell-income":c==="outcome"?"cell-outcome":c==="balance"?"cell-balance":"";
     return "<td class='"+cellClass+"'>"+(c==="income"||c==="outcome"||c==="balance"
       ?(v===""||v===null||v===undefined?"":money(v))
       :esc(v))+"</td>";
   }).join("")+"</tr>").join("");
 }else{
   table+="<tr><td class='empty-row' colspan='"+cols.length+"'>لا توجد حركات مسجلة لهذا اليوم</td></tr>";
 }
 table+="</tbody><tfoot><tr>"+cols.map((c,i)=>{
   if(c==="income")return "<th>"+money(totalIn)+"</th>";
   if(c==="outcome")return "<th>"+money(totalOut)+"</th>";
   if(c==="balance")return "<th>"+money(closing)+"</th>";
   return "<th>"+(i===0?"الإجمالي":"")+"</th>";
 }).join("")+"</tr></tfoot></table>";

 const summary=[];
 const addSummary=(key,label,value)=>{
   if(selected.has(key))summary.push("<div><b>"+label+"</b><strong>"+value+"</strong></div>");
 };
 addSummary("opening","الرصيد الافتتاحي",money(openingAmount));
 addSummary("closing","الرصيد الختامي",money(closing));
 addSummary("employee","الموظف المسؤول",esc(r.employee||"—"));
 addSummary("system","رصيد السيستم",system===null?"—":money(system));
 addSummary("actual","الرصيد الفعلي",actual===null?"—":money(actual));
 addSummary("difference","الفرق",diff===null?"—":diff<-.005?"عجز "+money(Math.abs(diff)):diff>.005?"فائض "+money(diff):"مطابق");
 addSummary("notes","الملاحظات",esc(r.notes||"—"));

 const matched=diff!==null&&Math.abs(diff)<.005;
 const statusClass=diff===null?"status-neutral":matched?"status-match":diff<0?"status-shortage":"status-surplus";
 const statusText=diff===null?"المطابقة غير مكتملة — أدخل رصيد السيستم والرصيد الفعلي":
   matched?"✓ الخزنة مطابقة مع السيستم":
   diff<0?"⚠ عجز في الخزنة: "+money(Math.abs(diff)):"⚠ فائض في الخزنة: "+money(diff);
 const paper=$("reportPaperSize")?.value==="A5"?"A5":"A4";
 try{localStorage.setItem(REPORT_PAPER_KEY,paper)}catch(e){}
 const pageMargin=paper==="A5"?"7mm 6mm 8mm":"12mm 11mm 14mm";
 const baseFont=paper==="A5"?"9.5px":"11px";
 const title="تقرير حركة ومطابقة الخزنة";
 const reportDate=esc(r.date||currentDate);
 const reportDay=esc(r.day||dayName(currentDate));
 const generatedAt=esc(new Date().toLocaleString("ar-EG"));
 const css="@page{size:__PAPER__ portrait;margin:"+pageMargin+"}"+
 "*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#172033;font-family:Arial,Tahoma,sans-serif;font-size:"+baseFont+";direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}"+
 ".page{width:100%;margin:0 auto;position:relative}.report-header{border-bottom:2px solid #b99654;margin-bottom:9px;break-inside:avoid;page-break-inside:avoid}.header-top{display:flex;align-items:center;gap:12px;background:#fff;color:#171717;padding:2px 0 9px;text-align:right}.brand-logo{width:64px;height:64px;object-fit:contain}.header-top h1{margin:0;font-size:17px;color:#94723a}.header-top h2{margin:1px 0;font-size:13px;font-weight:normal;color:#927443}.header-top small{display:block;color:#9b8358;letter-spacing:.2em;font-size:9px}.report-title{text-align:left;margin-right:auto;font-weight:bold;font-size:15px}.header-date{color:#4d4a43;text-align:right;padding:5px 0;font-weight:bold}"+
 ".summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0}.summary div{border:1px solid #c5d1db;border-radius:5px;padding:7px;background:#f8fbfe;min-height:35px;break-inside:avoid}.summary b,.summary strong{display:block}.summary b{color:#526779;font-size:9px;margin-bottom:3px}.summary strong{font-size:11px;color:#173b63;overflow-wrap:anywhere}.status-box{padding:8px;border-radius:6px;text-align:center;font-weight:bold;margin:8px 0;border:1px solid #c5d1db;break-inside:avoid;page-break-inside:avoid}.status-match{background:#e8f5e9;color:#1b5e20}.status-shortage{background:#ffebee;color:#b71c1c}.status-surplus{background:#fff8e1;color:#7a4b00}.status-neutral{background:#f3f6f8;color:#455a64}.transactions-title{background:#173b63;color:#fff;padding:7px 9px;font-weight:bold;border-radius:5px 5px 0 0}"+
 "table{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid #b8a67f}thead{display:table-header-group}tfoot{display:table-row-group}th,td{border:1px solid #b9b4a8;padding:5px 4px;text-align:center;min-height:24px;overflow-wrap:anywhere;word-break:normal}th{background:#f2eee6;color:#725b32;font-size:9px}tbody td{vertical-align:middle}tbody tr:nth-child(even) td{background:#fbfaf7}.cell-income{color:#1b5e20}.cell-outcome{color:#b71c1c}.cell-balance{font-weight:bold}tfoot th{background:#f2eee6;color:#725b32;border-top:2px solid #b99654}.empty-row{padding:16px;color:#607d8b}.footer{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}.signature{border:1px solid #b8b0a2;border-radius:5px;padding:10px;text-align:center;color:#514b40;min-height:42px}.brand-footer{display:grid;grid-template-columns:64px 1fr;gap:10px;align-items:center;border:1px solid #b99654;padding:8px 10px;margin-top:12px;color:#315b35;font-size:9px;break-inside:avoid}.brand-qr{width:62px;height:62px;object-fit:contain}.brand-footer p{white-space:pre-line;margin:4px 0 0;line-height:1.5}.print-note{text-align:center;color:#78909c;font-size:8px;margin-top:8px}tr{break-inside:avoid;page-break-inside:avoid}.footer{break-inside:avoid;page-break-inside:avoid}";
 const reportHtml="<!doctype html><html lang='ar' dir='rtl'><head><meta charset='UTF-8'><title>"+title+" - "+reportDate+"</title><style>"+css.replace("__PAPER__",paper)+"</style></head><body><main class='page'>"+
 "<div class='report-header'><div class='header-top'>"+logo+"<div><h1>"+brandArabic+"</h1><h2 dir='ltr'>"+brandEnglish+"</h2>"+(tagline?"<small>"+tagline+"</small>":"")+"</div><div class='report-title'>"+title+"</div></div><div class='header-date'>"+branchName+" · "+reportDay+" — "+reportDate+"</div></div>"+
 (summary.length?"<div class='summary'>"+summary.join("")+"</div>":"")+
 "<div class='status-box "+statusClass+"'>"+statusText+"</div><div class='transactions-title'>تفاصيل العمليات — "+rows.length+" عملية</div>"+
 table+"<div class='footer'><div class='signature'>توقيع الموظف<br>__________________</div><div class='signature'>توقيع المدير<br>__________________</div></div>"+(contact||footerNote||qr?"<div class='brand-footer'>"+qr+"<div>"+(contact?"<strong>"+contact+"</strong>":"")+(footerNote?"<p>"+footerNote+"</p>":"")+"</div></div>":"")+"<div class='print-note'>تم إنشاء التقرير في "+generatedAt+" — يُرجى مراجعة الأرقام قبل الاعتماد</div></main>"+
 "<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},350)};<\/script></body></html>";

 w.document.open();w.document.write(reportHtml);w.document.close();
}
getReportColumns();
loadReportPaper();
document.querySelectorAll(".report-col").forEach(b=>b.addEventListener("change",saveReportColumns));
$("reportPaperSize").addEventListener("change",()=>{try{localStorage.setItem(REPORT_PAPER_KEY,$("reportPaperSize").value)}catch(e){}});
$("selectAllReport").onclick=()=>{document.querySelectorAll(".report-col").forEach(b=>b.checked=true);saveReportColumns()};
$("clearAllReport").onclick=()=>{document.querySelectorAll(".report-col").forEach(b=>b.checked=false);saveReportColumns()};
$("generateReport").onclick=generateReport;

/* System PDF reconciliation - tailored to the Al Aziz Belah treasury report */
const RECON_KEY="vault_reconciliation_report_v2";
function reconMoney(v){
  if(v===null||v===undefined||v==="") return "";
  const n=Number(v);
  return Number.isFinite(n)?n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):String(v);
}
function normDigits(s){
  return String(s||"").replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[٬،]/g,",").replace(/٫/g,".");
}
function parseReconNumber(s){
  if(s===undefined||s===null) return NaN;
  let x=normDigits(String(s)).replace(/[^\d.,()\-]/g,"");
  if(!x) return NaN;
  const neg=/^\(.*\)$/.test(x);
  x=x.replace(/[(),]/g,"");
  const n=Number(x);
  return neg?-n:n;
}
function normalizeText(s){
  return normDigits(String(s||"")).normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e]/g,"").replace(/\s+/g," ").trim();
}
function normalizeArabic(s){return normalizeText(s).replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي")}
function reverseText(s){return [...String(s||"")].reverse().join("")}
function arabicHas(s,word){const n=normalizeArabic(s).replace(/\s+/g,"");const w=normalizeArabic(word).replace(/\s+/g,"");return n.includes(w)||n.includes(reverseText(w))}
function rowDateFromText(s){
  const t=normDigits(s);
  let m=t.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(m)return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m=t.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
  return m?`${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`:"";
}
function moneyRegex(){return /-?\d[\d,]*\.\d{2}/g;}
function extractLastMoney(s){
  const a=[...String(s||"").matchAll(moneyRegex())];
  return a.length?parseReconNumber(a[a.length-1][0]):NaN;
}
function extractNumbers(s){return [...String(s||"").matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map(m=>({raw:m[0],value:parseReconNumber(m[0])}));}
function dateFromReport(text){
  const t=normalizeText(text);
  let m=t.match(/من\s*تاريخ\s*[:：-]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if(m) return m[1];
  m=t.match(/(\d{4}-\d{2}-\d{2})/);
  return m?m[1]:"";
}
function closingBalanceFromReport(text){
  const t=normalizeText(text);
  let m=t.match(/الرصيد\s*[:：]\s*(-?\d[\d,]*\.\d{2})/);
  if(m) return parseReconNumber(m[1]);
  m=t.match(/(-?\d[\d,]*\.\d{2})\s*[:：]\s*الرصيد/);
  if(m) return parseReconNumber(m[1]);
  m=t.match(/(?:الرصيد\s*(?:الحالي|الختامي|النهائي))[^\d-]*(-?\d[\d,]*(?:\.\d{2})?)/);
  if(m) return parseReconNumber(m[1]);
  m=t.match(/(-?\d[\d,]*(?:\.\d{2})?)\s*[:：]\s*(?:الرصيد\s*(?:الحالي|الختامي|النهائي))/);
  return m?parseReconNumber(m[1]):NaN;
}
function openingBalanceFromReport(text){
  const t=normalizeText(text);
  let m=t.match(/ما\s*قبله\s*[:：]?\s*(-?\d[\d,]*\.\d{2})/);
  if(m) return parseReconNumber(m[1]);
  m=t.match(/(-?\d[\d,]*\.\d{2})\s*[:：]?\s*ما\s*قبله/);
  return m?parseReconNumber(m[1]):NaN;
}
function groupPdfItemsByLine(items){
  const groups=[];
  const heights=items.map(x=>Math.abs(x.transform?.[3]||0)).filter(x=>x>0).sort((a,b)=>a-b);
  const tolerance=Math.max(1.5,(heights[Math.floor(heights.length/2)]||9)*.28);
  const sorted=items.filter(x=>String(x.str||"").trim()).sort((a,b)=>{
    const ay=a.transform?.[5]||0, by=b.transform?.[5]||0;
    if(Math.abs(ay-by)>tolerance) return by-ay;
    return (a.transform?.[4]||0)-(b.transform?.[4]||0);
  });
  for(const item of sorted){
    const y=item.transform?.[5]||0;
    let g=groups.find(x=>Math.abs(x.y-y)<=tolerance);
    if(!g){g={y,items:[]};groups.push(g)}
    g.items.push(item);
  }
  groups.sort((a,b)=>b.y-a.y);
  return groups;
}
function pdfColumnLayout(items,pageWidth,pageHeight){
  const topItems=items.filter(x=>(x.transform?.[5]||0)>pageHeight*.82),anchors={};
  const labels={date:"تاريخ",balance:"الرصيد",credit:"دخول",debit:"خروج",type:"نوع",ref:"رقم"};
  for(const [key,label] of Object.entries(labels)){
    const item=topItems.find(x=>arabicHas(x.str,label));
    if(item)anchors[key]=(item.transform?.[4]||0)+(item.width||0)/2;
  }
  // Proportional fallback for reports whose header text is not extractable.
  const fallback={ref:.235,type:.63,balance:.69,debit:.76,credit:.85,date:.93};
  for(const [key,ratio] of Object.entries(fallback))if(!Number.isFinite(anchors[key]))anchors[key]=pageWidth*ratio;
  return anchors;
}
function parsePdfRow(group,pageWidth=1655,layout=null){
  const items=group.items.slice().sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0));
  const all=items.map(x=>normalizeText(x.str)).join(" ");
  const normalizedAll=normalizeArabic(all),columns=layout||pdfColumnLayout([],pageWidth,pageWidth*.56);
  const date=rowDateFromText(all);
  if(!date) return null;
  const typeText=items.filter(x=>nearest((x.transform?.[4]||0)+(x.width||0)/2,"type")).map(x=>x.str).join(" ");
  const isCredit=arabicHas(typeText,"إيداع"),isDebit=arabicHas(typeText,"سحب");
  if(!isCredit&&!isDebit) return null;
  const type=isCredit?"إيداع":"سحب";
  const nearest=(x,key)=>Math.abs(x-columns[key])<=Object.keys(columns).reduce((d,k)=>Math.min(d,Math.abs(x-columns[k])),Infinity);
  const numericItems=items.filter(x=>extractNumbers(x.str).length);
  const columnItems=key=>numericItems.filter(x=>nearest((x.transform?.[4]||0)+(x.width||0)/2,key));
  const balanceItems=columnItems("balance"),creditItems=columnItems("credit"),debitItems=columnItems("debit");

  const balance=balanceItems.map(x=>extractLastMoney(x.str)).find(Number.isFinite);
  const credit=creditItems.map(x=>extractLastMoney(x.str)).find(Number.isFinite);
  const debit=debitItems.map(x=>extractLastMoney(x.str)).find(Number.isFinite);

  // Reference and amounts are assigned to columns using positions of the PDF's own header labels.
  const midText=columnItems("ref").map(x=>normalizeText(x.str)).join(" ");
  const midNums=extractNumbers(midText).map(x=>x.raw);
  const ref=midNums.length?midNums[midNums.length-1].replace(/,/g,""):"";

  // The statement/details text lies between the reference and movement-type columns.
  let description=items.filter(x=>{
    const x0=x.transform?.[4]||0,x1=x0+(x.width||0),left=Math.min(columns.ref,columns.type),right=Math.max(columns.ref,columns.type);
    return (x0+x1)/2>left+12&&(x0+x1)/2<right-12;
  }).map(x=>{
    let part=normalizeText(x.str);
    if(Number.isFinite(balance)){
      const btxt=balance.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
      part=part.replace(new RegExp(btxt.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"),"");
      part=part.replace(new RegExp(String(balance.toFixed(2)).replace(".","\\."),"g"),"");
    }
    return part;
  }).join(" ").replace(/\s+/g," ").trim();

  if(!Number.isFinite(balance) || !Number.isFinite(credit) || !Number.isFinite(debit)) return null;
  const amount=Math.max(Math.abs(credit),Math.abs(debit));
  return {ref,date,type,balance,credit,debit,amount,description,raw:all};
}
async function extractSystemReport(file){
  const pdfjs=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
    let text=""; const rows=[];let candidateRows=0;
  for(let pageNo=1;pageNo<=pdf.numPages;pageNo++){
    const page=await pdf.getPage(pageNo);
    const content=await page.getTextContent({disableCombineTextItems:false});
    text+=content.items.map(x=>x.str).join(" ")+"\n";
    const groups=groupPdfItemsByLine(content.items),viewport=page.getViewport({scale:1}),pageWidth=viewport.width,layout=pdfColumnLayout(content.items,pageWidth,viewport.height);
    groups.forEach(g=>{const raw=g.items.map(x=>normalizeText(x.str)).join(" ");if(rowDateFromText(raw)&&(arabicHas(raw,"إيداع")||arabicHas(raw,"سحب")))candidateRows++;const row=parsePdfRow(g,pageWidth,layout);if(row)rows.push(row)});
  }
  // Deduplicate rows caused by overlapping PDF text items.
  const seen=new Set(),clean=[];
  for(const r of rows){
    const key=[r.date,r.ref,r.type,r.amount,r.balance].join("|");
    if(!seen.has(key)){seen.add(key);clean.push(r)}
  }
  const reportClosing=closingBalanceFromReport(text),closing=Number.isFinite(reportClosing)?reportClosing:(clean.at(-1)?.balance??NaN);
  const reportOpening=openingBalanceFromReport(text),first=clean[0],opening=Number.isFinite(reportOpening)?reportOpening:(first?first.balance-first.credit+first.debit:NaN);
  const parseWarning=!clean.length?"لم يُعثر على حركات قابلة للقراءة. قد يكون الملف صورة ممسوحة أو بتنسيق أعمدة مختلف.":clean.length<candidateRows?`تم استخراج ${clean.length} حركة من أصل ${candidateRows} سطرًا يبدو كحركة؛ راجع التقرير الأصلي قبل الاعتماد.`:candidateRows?`تم استخراج ${clean.length} حركة. تم حساب رصيد البداية والنهاية من أول وآخر حركة؛ راجع التقرير الأصلي قبل الاعتماد.`:"لم يظهر عدد مرشح للحركات؛ تحقق من ملف التقرير الأصلي.";
  return {text,rows:clean,opening,closing,date:dateFromReport(text),pages:pdf.numPages,candidateRows,parseWarning};
}
function localRegisterTransactions(){
  const r=(records()[currentDate]||{}).rows||[];
  return r.map((x,i)=>{
    const inc=parseReconNumber(x.income),out=parseReconNumber(x.outcome);
    if(Number.isFinite(inc)&&inc!==0) return {number:i+1,ref:normalizeText(x.systemRef||""),type:"إيداع",amount:Math.abs(inc),description:normalizeText(x.description),date:currentDate};
    if(Number.isFinite(out)&&out!==0) return {number:i+1,ref:normalizeText(x.systemRef||""),type:"سحب",amount:Math.abs(out),description:normalizeText(x.description),date:currentDate};
    return null;
  }).filter(Boolean);
}
function textSimilarity(a,b){
  a=normalizeText(a);b=normalizeText(b);if(!a||!b)return 0;if(a===b)return 1;
  const aa=new Set(a.split(" ").filter(Boolean)),bb=new Set(b.split(" ").filter(Boolean));
  let common=0;aa.forEach(x=>{if(bb.has(x))common++});
  return common/Math.max(aa.size,bb.size,1);
}
function pairScore(s,l){
  const sr=normalizeText(s.ref||""), lr=normalizeText(l.ref||"");
  const sd=normalizeText(s.description||""), ld=normalizeText(l.description||"");
  const amountEqual=Math.abs((s.amount||0)-(l.amount||0))<=.005;
  const typeEqual=s.type===l.type;
  const dateComparable=!!s.date&&!!l.date,dateEqual=dateComparable&&rowDateFromText(s.date)===rowDateFromText(l.date),dateMismatch=dateComparable&&!dateEqual;
  const descSim=textSimilarity(sd,ld);
  let score=0, evidence=[];
  if(sr&&lr&&sr===lr){score+=0.70;evidence.push("رقم الحركة مطابق");}
  else if(sr&&lr&&sr!==lr){score-=0.05;evidence.push("رقم الحركة مختلف");}
  if(amountEqual){score+=0.20;evidence.push("المبلغ مطابق");}
  else {evidence.push("المبلغ مختلف");}
  if(typeEqual){score+=0.10;evidence.push("نوع العملية مطابق");}
  else {evidence.push("نوع العملية مختلف");}
  if(dateEqual){score+=0.05;evidence.push("التاريخ مطابق");}else if(dateMismatch)evidence.push("التاريخ مختلف");
  if(descSim>=0.85){score+=0.05;evidence.push("البيان متطابق تقريبًا");}
  else if(descSim>=0.45){score+=0.025;evidence.push("البيان متشابه");}
  if(!amountEqual||!typeEqual||dateMismatch)score=Math.min(score,.59);
  return {score:Math.max(0,Math.min(1,score)),amountEqual,typeEqual,refEqual:!!sr&&!!lr&&sr===lr,dateEqual,dateMismatch,descSim,evidence};
}
function globalOrderIndependentMatch(systemRows,localRows){
  const candidates=[];
  const refCount=(rows)=>{const m=new Map();rows.forEach(r=>{const k=normalizeText(r.ref||"");if(k)m.set(k,(m.get(k)||0)+1)});return m};
  const sysRefCount=refCount(systemRows), localRefCount=refCount(localRows);
  systemRows.forEach((s,si)=>localRows.forEach((l,li)=>{
    const p=pairScore(s,l);
    const bothRefs=!!normalizeText(s.ref||"")&&!!normalizeText(l.ref||"");
    const exactRef=p.refEqual;
    const strongContent=p.amountEqual&&p.typeEqual&&p.descSim>=0.45&&(!p.dateMismatch);
    const fallbackContent=!bothRefs&&strongContent;
    const differentRefs=bothRefs&&!exactRef;
    // Safety rule: if both records have movement references, a different
    // reference is NOT allowed to match merely because amount/type/description
    // happen to look similar. This prevents hiding a real discrepancy.
    if(exactRef || (!differentRefs && (strongContent || fallbackContent))) candidates.push({si,li,p,bothRefs});
  }));
  candidates.sort((a,b)=>b.p.score-a.p.score || Number(b.p.refEqual)-Number(a.p.refEqual) || Number(b.p.descSim)-Number(a.p.descSim));
  const tiedS=new Map(),tiedL=new Map();
  function collectTies(items,key,otherKey){
    const grouped=new Map();items.forEach(c=>{const k=c[key];if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(c)});
    for(const [index,choices] of grouped){if(choices.length<2)continue;const top=Math.max(...choices.map(c=>c.p.score)),ties=choices.filter(c=>top-c.p.score<=.001);if(ties.length<2)continue;
      const dest=key==="si"?tiedS:tiedL;dest.set(index,new Set(ties.map(c=>c[otherKey])));
    }
  }
  collectTies(candidates,"si","li");collectTies(candidates,"li","si");
  const ambiguous=[...tiedS].map(([si,lis])=>({side:"system",row:systemRows[si],candidates:[...lis].map(i=>localRows[i])}));
  for(const [li,sis] of tiedL)ambiguous.push({side:"local",row:localRows[li],candidates:[...sis].map(i=>systemRows[i])});
  const blockedS=new Set(tiedS.keys()),blockedL=new Set(tiedL.keys()),usedS=new Set(),usedL=new Set(),matches=[];
  for(const c of candidates){
    if(blockedS.has(c.si)||blockedL.has(c.li))continue;
    if(usedS.has(c.si)||usedL.has(c.li))continue;
    const s=systemRows[c.si],l=localRows[c.li];
    // A reference match is allowed to continue even if amount/type differs,
    // because the purpose is to expose that discrepancy. Otherwise require
    // strong non-reference evidence.
    if(!c.p.refEqual && !(c.p.amountEqual&&c.p.typeEqual&&c.p.descSim>=0.45)) continue;
    usedS.add(c.si);usedL.add(c.li);
    const confidence=c.p.refEqual&&c.p.amountEqual&&c.p.typeEqual&&!c.p.dateMismatch?"مؤكد":
      !c.p.refEqual&&c.p.amountEqual&&c.p.typeEqual&&c.p.descSim>=0.85&&!c.p.dateMismatch?"مرتفع":"مراجعة";
    matches.push({system:s,local:l,confidence,score:c.p.score,reason:c.p.evidence.join(" + "),amountMismatch:!c.p.amountEqual,typeMismatch:!c.p.typeEqual,dateMismatch:c.p.dateMismatch});
  }
  return {
    matches,
    ambiguous,
    systemOnly:systemRows.filter((_,i)=>!usedS.has(i)),
    localOnly:localRows.filter((_,i)=>!usedL.has(i))
  };
}
function matchTransactions(systemRows,localRows){
  return globalOrderIndependentMatch(systemRows,localRows);
}
function findDuplicates(rows){
  const map=new Map();rows.forEach(r=>{const k=[r.ref,r.type,r.amount].join("|");if(!map.has(k))map.set(k,[]);map.get(k).push(r)});
  return [...map.values()].filter(a=>a.length>1);
}
function findSubsetMatches(items,target,maxItems=8,maxResults=8){
  const targetC=Math.round(Math.abs(target)*100),results=[];
  if(!Number.isFinite(targetC)||targetC<=0)return results;
  const cap=1500,stateCap=30000,candidates=items.filter(x=>Number.isFinite(x.amount)&&x.amount>0&&Math.round(x.amount*100)<=targetC).slice(0,cap);
  let states=new Map([[0,[[]]]]),truncated=items.length>cap||candidates.length<items.filter(x=>Number.isFinite(x.amount)&&x.amount>0&&Math.round(x.amount*100)<=targetC).length;
  for(let idx=0;idx<candidates.length;idx++){
    const cents=Math.round(candidates[idx].amount*100), additions=[];
    for(const [sum,paths] of states){if(sum+cents>targetC)continue;for(const path of paths){if(path.length>=maxItems)continue;const next=sum+cents;if(next===targetC){results.push([...path,idx]);if(results.length>=maxResults){truncated=true;break}}else additions.push([next,[...path,idx]])}if(results.length>=maxResults)break}
    for(const [sum,path] of additions){const paths=states.get(sum)||[];if(paths.length<3){paths.push(path);states.set(sum,paths)}else truncated=true}
    if(states.size>stateCap){states=new Map([...states].sort((a,b)=>a[0]-b[0]).slice(0,stateCap));truncated=true}
    if(results.length>=maxResults)break;
  }
  const seen=new Set(),unique=[];
  for(const path of results){const key=path.join(",");if(!seen.has(key)){seen.add(key);unique.push(path.map(i=>candidates[i]))}}
  unique.sort((a,b)=>a.length-b.length);unique.truncated=truncated;return unique;
}

function firstRegisterDifference(){
  // Disabled by design: report row order is not evidence of financial sequence.
  return null;
}
function buildDifferenceTimeline(){
  // Disabled by design: only trustworthy timestamps/sequence fields can support temporal analysis.
  return [];
}

function auditNorm(s){return normalizeText(String(s||"")).replace(/[إأآا]/g,"ا").replace(/[ى]/g,"ي").replace(/[ة]/g,"ه").replace(/[^\u0600-\u06FFa-zA-Z0-9 ]/g," ").replace(/\s+/g," ").trim()}
function auditSim(a,b){return textSimilarity(a,b)}
function auditSettings(){return{strictType:$('auditStrictType')?.checked!==false,useDesc:$('auditUseDescription')?.checked!==false,combos:$('auditFindCombinations')?.checked!==false}}
function runSmartAudit(sys,loc,diff,set){
  const base=globalOrderIndependentMatch(sys,loc);
  const amountMismatches=base.matches.filter(m=>m.amountMismatch);
  const typeMismatches=base.matches.filter(m=>m.typeMismatch);
  const ambiguous=base.ambiguous;
  const refs={};sys.forEach(x=>{const r=auditNorm(x.ref);if(r)(refs[r]??=[]).push(x)});
  const duplicates=Object.values(refs).filter(a=>a.length>1);
  const target=Math.abs(diff||0);
  const explainers=diff>0?[
    ...base.systemOnly.filter(x=>x.type==='سحب').map(x=>({...x,source:'PDF'})),
    ...base.localOnly.filter(x=>x.type==='إيداع').map(x=>({...x,source:'السجل'}))
  ]:diff<0?[
    ...base.systemOnly.filter(x=>x.type==='إيداع').map(x=>({...x,source:'PDF'})),
    ...base.localOnly.filter(x=>x.type==='سحب').map(x=>({...x,source:'السجل'}))
  ]:[];
  const combos=set.combos&&target>0?findSubsetMatches(explainers,target,8,10):[];
  const netSys=base.systemOnly.reduce((a,x)=>a+(x.type==='سحب'?x.amount:-x.amount),0);
  const netLocal=base.localOnly.reduce((a,x)=>a+(x.type==='سحب'?-x.amount:x.amount),0);
  const high=base.matches.filter(x=>x.confidence==='مؤكد').length;
  const low=base.matches.filter(x=>x.confidence==='مراجعة').length;
  const med=base.matches.filter(x=>x.confidence==='مرتفع').length;
  return {...base,amountMismatches,typeMismatches,ambiguous,duplicates,combos,netSys,netLocal,high,med,low,orderIndependent:true};
}
function renderSmartAudit(a,diff){const box=$('smartAuditResult');if(!box)return;const flags=[];if(a.systemOnly.length)flags.push(`🔴 ${a.systemOnly.length} حركة في السيستم بلا مقابل`);if(a.localOnly.length)flags.push(`🟠 ${a.localOnly.length} حركة في السجل بلا مقابل`);if(a.duplicates.length)flags.push(`🔴 ${a.duplicates.length} أرقام حركة مكررة`);if(a.ambiguous.length)flags.push(`🟠 ${a.ambiguous.length} حالة مطابقة ملتبسة`);if(a.combos.length)flags.push(`🟠 توجد تركيبات تساوي الفرق${a.combos.truncated?' (قد توجد احتمالات أخرى)':''}`);const rows=a.matches.slice().sort((x,y)=>y.score-x.score).slice(0,100).map(m=>{const cls=m.confidence==='مؤكد'?'audit-high':m.confidence==='مرتفع'?'audit-med':'audit-low';return `<tr><td>#${esc(m.system.ref||'—')}</td><td>${m.local.number}</td><td>${reconMoney(m.system.amount)}</td><td>${esc(m.system.type)}</td><td>${(m.score*100).toFixed(0)}%</td><td><span class="audit-badge ${cls}">${m.confidence}</span></td><td>${esc(m.reason||'')}</td><td>${m.amountMismatch?'اختلاف مبلغ':m.typeMismatch?'اختلاف نوع':m.dateMismatch?'اختلاف تاريخ':'مطابقة'}</td></tr>`}).join('');const comboHtml=a.combos.slice(0,5).map((c,i)=>`<div class="combo-row"><b>الاحتمال ${i+1}:</b> ${c.map(x=>`${esc(x.source||'')} ${esc(x.ref||x.number||'—')} ${esc(x.type)} ${reconMoney(x.amount)}`).join(' + ')} = <b>${reconMoney(Math.abs(diff))}</b></div>`).join('')||'<p>لم نجد تركيبة تطابق الفرق بالضبط.</p>';box.hidden=false;box.innerHTML=`<div class="audit-summary"><div class="audit-card audit-success"><span>مطابقة مؤكدة</span><strong>${a.high}</strong></div><div class="audit-card audit-warning"><span>مطابقة قوية</span><strong>${a.med}</strong></div><div class="audit-card audit-neutral"><span>تحتاج مراجعة</span><strong>${a.low}</strong></div><div class="audit-card audit-critical"><span>السيستم فقط</span><strong>${a.systemOnly.length}</strong></div><div class="audit-card audit-warning"><span>السجل فقط</span><strong>${a.localOnly.length}</strong></div></div><div class="audit-note"><div>ℹ️ <b>المطابقة مستقلة عن ترتيب الحركات:</b> اختلاف ترتيب الصفوف لا يعتبر فرقًا ماليًا ولا يدخل في درجة المطابقة.</div>${flags.length?flags.map(x=>`<div>${esc(x)}</div>`).join(''):'لا توجد إشارات تدقيق إضافية.'}</div><div class="audit-section"><h4>🎯 تقييم كل مطابقة</h4><table class="recon-table"><thead><tr><th>حركة السيستم</th><th>عملية السجل</th><th>المبلغ</th><th>النوع</th><th>درجة الأدلة</th><th>التصنيف</th><th>الأدلة</th><th>الحالة</th></tr></thead><tbody>${rows||'<tr><td colspan="8">لا توجد مطابقات.</td></tr>'}</tbody></table></div><div class="audit-section"><h4>🧩 عمليات قد تفسر الفرق</h4><div class="recon-warning-box">${comboHtml}</div></div><div class="audit-section"><h4>🧮 الأثر الصافي</h4><p>السيستم فقط: <b>${reconMoney(a.netSys)}</b> | السجل فقط: <b>${reconMoney(a.netLocal)}</b></p><small>هذا تحليل تشخيصي، وليس إثباتًا نهائيًا للسبب.</small></div>`}

function renderRecon(data){
  const box=$("reconciliationResult");
  const actual=data.actual,sys=data.closing;
  const physicalDiff=Number.isFinite(actual)&&Number.isFinite(sys)?actual-sys:NaN;
  const localBal=data.openingLocal+data.localIn-data.localOut;
  const localVsSystem=Number.isFinite(sys)?localBal-sys:NaN;
  const state=Number.isFinite(physicalDiff)?(Math.abs(physicalDiff)<.005?"مطابق":physicalDiff>0?"أوفر":"عجز"):"غير مكتمل";
  const cls=state==="مطابق"?"recon-ok":state==="غير مكتمل"?"recon-warning":"recon-danger";
  const dup=findDuplicates(data.systemRows);
  const causeCandidates=physicalDiff>0
    ?[
      ...data.systemOnly.filter(x=>x.type==="سحب").map(x=>({...x,source:"PDF",causeLabel:"سحب في التقرير بلا حركة مقابلة في سجل الخزنة"})),
      ...data.localOnly.filter(x=>x.type==="إيداع").map(x=>({...x,source:"السجل",causeLabel:"إيداع في سجل الخزنة غير ظاهر في التقرير"}))
    ]
    :physicalDiff<0
      ?[
        ...data.systemOnly.filter(x=>x.type==="إيداع").map(x=>({...x,source:"PDF",causeLabel:"إيداع في التقرير بلا حركة مقابلة في سجل الخزنة"})),
        ...data.localOnly.filter(x=>x.type==="سحب").map(x=>({...x,source:"السجل",causeLabel:"سحب في سجل الخزنة غير ظاهر في التقرير"}))
      ]
      :[];
  const target=Math.abs(physicalDiff);
  const combos=Number.isFinite(target)&&target>0?findSubsetMatches(causeCandidates,target,8,8):[];

  const exactMatches=data.matches.filter(m=>m.confidence==="مؤكد").slice(0,40);
  let exactHtml=exactMatches.length?`
    <div class="recon-ref-help"><b>🎯 تطابقات مؤكدة برقم الحركة:</b> ${exactMatches.length}
    <br><small>هذه الحركات تطابقت باستخدام رقم حركة السيستم الذي أدخلته في السجل، بالإضافة إلى النوع والمبلغ.</small></div>
    <table class="recon-table">
      <thead><tr><th>رقم حركة السيستم</th><th>عملية السجل</th><th>النوع</th><th>المبلغ</th><th>البيان</th></tr></thead>
      <tbody>${exactMatches.map(m=>`<tr><td>#${esc(m.system.ref)}</td><td>${m.local.number}</td><td>${esc(m.system.type)}</td><td>${reconMoney(m.system.amount)}</td><td>${esc(m.local.description||m.system.description||"—")}</td></tr>`).join("")}</tbody>
    </table>`
    :'<div class="recon-ref-help"><b>💡 تحسين دقة المطابقة:</b> يمكنك كتابة رقم حركة السيستم في عمود <b>مرجع السيستم</b> أمام العملية في السجل. عندها سيستخدم النظام الرقم كأقوى دليل للمطابقة.</div>';

  let unmatched="";
  data.systemOnly.slice(0,100).forEach(x=>unmatched+=`<tr><td>السيستم فقط</td><td>${esc(x.ref)}</td><td>${esc(x.type)}</td><td>${reconMoney(x.amount)}</td><td>${esc(x.description||"—")}</td></tr>`);
  data.localOnly.slice(0,100).forEach(x=>unmatched+=`<tr><td>السجل فقط</td><td>${x.number}</td><td>${esc(x.type)}</td><td>${reconMoney(x.amount)}</td><td>${esc(x.description||"—")}</td></tr>`);
  const reviewMatches=data.matches.filter(m=>m.amountMismatch||m.typeMismatch||m.dateMismatch||m.confidence==="مراجعة").slice(0,100);
  const reviewHtml=reviewMatches.length?`<table class="recon-table"><thead><tr><th>مرجع السيستم</th><th>رقم السجل</th><th>النوع</th><th>مبلغ السيستم</th><th>مبلغ السجل</th><th>تاريخ السيستم</th><th>الحالة</th></tr></thead><tbody>${reviewMatches.map(m=>`<tr><td>${esc(m.system.ref||"—")}</td><td>${m.local.number}</td><td>${esc(m.system.type)} / ${esc(m.local.type)}</td><td>${reconMoney(m.system.amount)}</td><td>${reconMoney(m.local.amount)}</td><td>${esc(m.system.date||"—")} / ${esc(m.local.date||"—")}</td><td>${[m.amountMismatch&&"اختلاف مبلغ",m.typeMismatch&&"اختلاف نوع",m.dateMismatch&&"اختلاف تاريخ"].filter(Boolean).join("، ")||"أدلة غير كافية"}</td></tr>`).join("")}</tbody></table>`:"<p>لا توجد مطابقات مرتبطة مع اختلافات ظاهرة.</p>";
  const parseNote=data.parseWarning?`<div class="recon-cause recon-warning-box"><strong>⚠️ فحص قراءة التقرير:</strong> ${esc(data.parseWarning)}<br><small>قارن عدد الحركات المستخرج بملف PDF الأصلي قبل اعتماد النتيجة.</small></div>`:"";

  let causeHtml="<p>أدخل المبلغ النقدي المعدود وارفع تقرير PDF أولًا لحساب الأوفر أو العجز.</p>";
  if(Number.isFinite(physicalDiff)&&Math.abs(physicalDiff)<.005)causeHtml="<p>لا يوجد فرق بين النقدية المعدودة ورصيد نهاية التقرير.</p>";
  else if(Number.isFinite(physicalDiff)&&Math.abs(physicalDiff)>=.005){
    const likely=causeCandidates.slice().sort((a,b)=>Math.abs(a.amount-target)-Math.abs(b.amount-target)).slice(0,8);
    const likelyRows=likely.map(x=>{const desc=x.description?" — "+esc(x.description):"";return '<div class="combo-row"><b>'+esc(x.causeLabel)+'</b> — '+esc(x.source)+' #'+esc(x.ref||x.number||"—")+' — '+esc(x.type)+' '+reconMoney(x.amount)+desc+'</div>'}).join("");
    causeHtml=likely.length?'<div class="recon-cause recon-warning-box"><strong>حركات تستحق الفحص بحسب اتجاه الفرق:</strong><small>هذه قرائن فقط. طابق الحركة مع المستند أو الإيصال قبل اعتبارها السبب.</small>'+likelyRows+'</div>':'<div class="recon-cause"><strong>لم تظهر حركة غير متطابقة في الاتجاه الذي يفسر الفرق.</strong><small>راجع الحركات المتطابقة باختلاف المبلغ، والرصيد الافتتاحي، وإدخال مبلغ النقدية المعدود.</small></div>';
  }
  if(combos.length){
    causeHtml=`<div class="recon-cause recon-warning-box">
      <strong>🟠 وُجدت مجموعة حركات تساوي قيمة الفرق تمامًا:</strong>
      <small>هذه أقوى قرينة حسابية، وليست إثباتًا للسبب قبل مراجعة الإيصالات والحركات.</small>
      ${combos.slice(0,4).map((c,i)=>`<div class="combo-row"><b>الاحتمال ${i+1}:</b> ${c.map(x=>`${esc(x.source)} #${esc(x.ref||x.number||"—")} (${esc(x.type)}) ${reconMoney(x.amount)}`).join(" + ")} = <b>${reconMoney(target)}</b></div>`).join("")}
    </div>`;
  }

  const firstHtml=`<div class="recon-cause recon-warning-box"><strong>ℹ️ ملاحظة مهمة:</strong><br>لا يتم استخدام ترتيب صفوف تقرير السيستم أو ترتيب السجل كدليل على وجود فرق. يمكن أن تكون الحركات نفسها مرتبة بشكل مختلف في المصدرين، ومع ذلك تعتبر متطابقة ماليًا إذا تطابقت الأدلة الأخرى.<br><small>لا يمكن تحديد أول لحظة ظهر فيها الفرق إلا عند توفر تاريخ/وقت موثوق للحركات.</small></div>`;
  const timelineHtml=firstHtml;

  let dupHtml=dup.length?dup.map(g=>`<div class="recon-cause"><strong>⚠️ تكرار محتمل:</strong>${g.map(x=>`#${esc(x.ref)} — ${esc(x.type)} — ${reconMoney(x.amount)} — ${esc(x.description||"")}`).join("<br>")}</div>`).join(""):"<p>لم يتم اكتشاف تكرار واضح في رقم الحركة + النوع + المبلغ.</p>";

  box.hidden=false;
  box.innerHTML=`
    <div class="recon-summary">
      <div class="recon-card"><span>رصيد التقرير الختامي</span><strong>${Number.isFinite(sys)?reconMoney(sys):"غير مستخرج"}</strong><small>من PDF</small></div>
      <div class="recon-card"><span>الرصيد الفعلي</span><strong>${Number.isFinite(actual)?reconMoney(actual):"غير مدخل"}</strong><small>من الخزنة</small></div>
      <div class="recon-card ${cls}"><span>الفرق الفعلي (النقدية − PDF)</span><strong>${Number.isFinite(physicalDiff)?reconMoney(Math.abs(physicalDiff)):"—"}</strong><small>${state==="مطابق"?"لا يوجد فرق":state==="غير مكتمل"?"أدخل النقدية المعدودة":physicalDiff>0?"النقدية أوفر من التقرير":"النقدية أقل من التقرير"}</small></div>
      <div class="recon-card ${cls}"><span>الحالة</span><strong>${state}</strong></div>
    </div>
    <div class="recon-grid-3">
      <div class="recon-card"><span>رصيد افتتاح التقرير</span><strong>${Number.isFinite(data.opening)?reconMoney(data.opening):"—"}</strong></div>
      <div class="recon-card"><span>رصيد السجل المحسوب</span><strong>${reconMoney(localBal)}</strong></div>
      <div class="recon-card"><span>فرق السجل عن السيستم</span><strong>${Number.isFinite(localVsSystem)?reconMoney(Math.abs(localVsSystem)):"—"}</strong><small>${Number.isFinite(localVsSystem)?(localVsSystem>0?"السجل أعلى":"السجل أقل"):""}</small></div>
    </div>
    ${parseNote}<h4 class="recon-section-title">🧠 تحليل سبب الفرق</h4>${causeHtml}
    <h4 class="recon-section-title">🕒 تحليل التسلسل الزمني</h4>${timelineHtml}
    <h4 class="recon-section-title">⚠️ العمليات المكررة المحتملة</h4>${dupHtml}
    <h4 class="recon-section-title">🎯 المطابقة برقم الحركة</h4>${exactHtml}
    <h4 class="recon-section-title">🧾 مطابقات مرتبطة بها اختلافات</h4>${reviewHtml}
    <h4 class="recon-section-title">📋 العمليات التي تحتاج مراجعة</h4>
    ${unmatched?`<table class="recon-table"><thead><tr><th>المصدر</th><th>رقم الحركة</th><th>النوع</th><th>المبلغ</th><th>البيان</th></tr></thead><tbody>${unmatched}</tbody></table>`:"<p>لا توجد عمليات غير متطابقة وفق المطابقة الحالية.</p>"}
    <p><b>صفوف التقرير:</b> ${data.systemRows.length} | <b>مطابقة:</b> ${data.matches.length} | <b>السيستم فقط:</b> ${data.systemOnly.length} | <b>السجل فقط:</b> ${data.localOnly.length}</p>
    <div class="recon-note"><b>تنبيه:</b> النتيجة التحليلية تساعدك على تضييق نطاق البحث، لكنها لا تعتبر سببًا مؤكدًا إلا إذا كانت العملية موثقة ومتطابقة مع قيمة الفرق وسياق الحركة.</div>`;
}
function persistReconciliation(report,cmp,actualValue){
  const all=records(),r=all[currentDate];
  if(!r) return;
  r.reconciliation={fileName:report.fileName||"",reportDate:report.date,opening:report.opening,closing:report.closing,actual:actualValue,rows:report.rows,candidateRows:report.candidateRows,parseWarning:report.parseWarning,analyzedAt:new Date().toISOString()};
  saveRecords(all);
}
function restoreReconciliation(){
  const r=records()[currentDate],saved=r&&r.reconciliation;
  if(!saved||!Array.isArray(saved.rows)||!saved.rows.length) return;
  const localRows=localRegisterTransactions();
  const cmp=matchTransactions(saved.rows,localRows);
  const localIn=localRows.filter(x=>x.type==="إيداع").reduce((s,x)=>s+x.amount,0);
  const localOut=localRows.filter(x=>x.type==="سحب").reduce((s,x)=>s+x.amount,0);
  renderRecon({closing:saved.closing,opening:saved.opening,actual:saved.actual,systemRows:saved.rows,localRows,openingLocal:Number(r.opening)||0,localIn,localOut,parseWarning:saved.parseWarning,...cmp});
  const diff=Number.isFinite(saved.closing)&&Number.isFinite(saved.actual)?saved.actual-saved.closing:NaN; renderSmartAudit(runSmartAudit(saved.rows,localRows,diff,auditSettings()),diff);
  if($("systemPdf")) $("pdfName").textContent=saved.fileName||"تقرير محفوظ";
}
async function analyzeSystemPdf(){
  const status=$("reconciliationStatus"),file=$("systemPdf")?.files?.[0];
  if(!file){status.textContent="اختر تقرير PDF أولًا.";status.classList.add("show");return;}
  status.textContent="جاري قراءة تقرير السيستم وتحليل الحركات...";status.classList.add("show");
  try{
    const report=await extractSystemReport(file);
    if(!report.rows.length)throw new Error(report.parseWarning||"لم يتم استخراج أي حركة من التقرير.");
    report.fileName=file.name;
    const mainActual=parseReconNumber(actual.value);
    const secondaryActual=parseReconNumber($("actualVaultBalance")?.value);
    const actualValue=Number.isFinite(mainActual)?mainActual:secondaryActual;
    const localRows=localRegisterTransactions();
    const cmp=matchTransactions(report.rows,localRows);
    const r=records()[currentDate]||{};
    const openingLocal=Number(r.opening)||0;
    const localIn=localRows.filter(x=>x.type==="إيداع").reduce((s,x)=>s+x.amount,0);
    const localOut=localRows.filter(x=>x.type==="سحب").reduce((s,x)=>s+x.amount,0);
    renderRecon({closing:report.closing,opening:report.opening,actual:actualValue,systemRows:report.rows,localRows,openingLocal,localIn,localOut,parseWarning:report.parseWarning,...cmp});
    const diff=Number.isFinite(report.closing)&&Number.isFinite(actualValue)?actualValue-report.closing:NaN; renderSmartAudit(runSmartAudit(report.rows,localRows,diff,auditSettings()),diff);
    persistReconciliation(report,cmp,actualValue);
    if(Number.isFinite(report.closing)){
      systemInput.value=report.closing;
      save();calculate();
    }
    if(Number.isFinite(actualValue)){
      actual.value=actualValue;
      if($("actualVaultBalance"))$("actualVaultBalance").value=actualValue;
      save();calculate();
    }
    localStorage.setItem(RECON_KEY,JSON.stringify({date:currentDate,fileName:file.name,reportDate:report.date,closing:report.closing,opening:report.opening,actual:actualValue,rows:report.rows.length,candidateRows:report.candidateRows,systemOnly:cmp.systemOnly.length,localOnly:cmp.localOnly.length,analyzedAt:new Date().toISOString()}));
    status.textContent=`تم تحليل التقرير: ${file.name} — ${report.rows.length} حركة مقروءة من ${report.candidateRows} سطرًا مرشحًا. ${report.parseWarning}`;
  }catch(e){
    console.error(e);
    status.textContent=`تعذر تحليل التقرير: ${e.message||"خطأ غير معروف"}. إذا كان PDF صورة ممسوحة ضوئيًا، يلزم OCR.`;
    status.classList.add("show");
  }
}
$("actualBalance")?.addEventListener("input",()=>{if($("actualVaultBalance"))$("actualVaultBalance").value=actual.value});
$("actualVaultBalance")?.addEventListener("input",()=>{actual.value=$("actualVaultBalance").value;calculate();save()});
$("systemPdf")?.addEventListener("change",e=>$("pdfName").textContent=e.target.files?.[0]?.name||"لم يتم اختيار ملف");

$("clearReconciliation")?.addEventListener("click",()=>{
  $("reconciliationResult").hidden=true;$("reconciliationResult").innerHTML="";$("reconciliationStatus").classList.remove("show");
  $("systemPdf").value="";$("pdfName").textContent="لم يتم اختيار ملف";localStorage.removeItem(RECON_KEY);
  const all=records(),r=all[currentDate];if(r){delete r.reconciliation;saveRecords(all)}
});

restoreReconciliation();

["auditFindCombinations"].forEach(id=>$(id)?.addEventListener("change",()=>{const r=records()[currentDate]?.reconciliation;if(r&&Array.isArray(r.rows)){const l=localRegisterTransactions(),d=Number.isFinite(r.closing)&&Number.isFinite(r.actual)?r.actual-r.closing:NaN;renderSmartAudit(runSmartAudit(r.rows,l,d,auditSettings()),d)}}));

/* ========================= V12 EXTENSIONS ========================= */
function rowReviewKey(side,row,index){
  return `${side}:${row.ref||row.number||index}:${row.type||''}:${Number(row.amount||0).toFixed(2)}`;
}
function currentRecon(){return records()[currentDate]?.reconciliation||null}
function saveReview(side,row,index,status,comment){
  const all=records(),r=all[currentDate]; if(!r)return;
  r.reconciliation=r.reconciliation||{};
  r.reconciliation.reviews=r.reconciliation.reviews||{};
  const key=rowReviewKey(side,row,index);
  r.reconciliation.reviews[key]={status:status||"",comment:comment||"",updatedAt:new Date().toISOString()};
  saveRecords(all);
}
function reviewValue(side,row,index){return currentRecon()?.reviews?.[rowReviewKey(side,row,index)]||{status:"",comment:""}}
function applyRowLocks(){
 const closed=!!records()[currentDate]?.closed;
 const savedRows=(records()[currentDate]?.rows||[]).filter(hasOperationData);
 [...ops.rows].forEach((tr,i)=>{
  const saved=savedRows[i];
  if(saved?.locked)tr.classList.add("row-locked");
  tr.querySelectorAll("input").forEach(x=>x.disabled=closed||tr.classList.contains("row-locked"));
  const b=tr.querySelector(".row-lock");if(b){b.textContent=tr.classList.contains("row-locked")?"🔒":"🔓";b.disabled=closed;}
 });
}
const _oldRenderRows=renderRows;
renderRows=function(data){_oldRenderRows(data);applyRowLocks();};

function renderVisualMatchMap(data){
 const box=$("visualMatchMap"); if(!box)return;
 const manual=currentRecon()?.manualMatches||{};
 const pairs=[]; const manuallyUsedLocal=new Set(); const manuallyUsedSystem=new Set();
 Object.entries(manual).forEach(([sysKey,localNumber])=>{
   const si=(data.systemRows||[]).findIndex((x,i)=>(x.ref||rowReviewKey("system",x,i))===sysKey);
   const li=(data.localRows||[]).findIndex(x=>x.number===Number(localNumber));
   if(si>=0&&li>=0){pairs.push({kind:"manual",system:data.systemRows[si],local:data.localRows[li],score:null,confidence:"يدوي"});manuallyUsedSystem.add(si);manuallyUsedLocal.add(li);}
 });
 (data.matches||[]).forEach(m=>pairs.push({kind:"matched",system:m.system,local:m.local,score:m.score,confidence:m.confidence}));
 (data.systemOnly||[]).forEach(x=>{const si=(data.systemRows||[]).indexOf(x);if(!manuallyUsedSystem.has(si))pairs.push({kind:"systemOnly",system:x,local:null});});
 (data.localOnly||[]).forEach(x=>{const li=(data.localRows||[]).indexOf(x);if(!manuallyUsedLocal.has(li))pairs.push({kind:"localOnly",system:null,local:x});});
 const card=(side,row,index,extra="")=>{
  if(!row)return '<div class="match-card empty-side">لا توجد حركة مقابلة</div>';
  const rv=reviewValue(side,row,index);
  const key=rowReviewKey(side,row,index);
  return `<div class="match-card ${extra}" draggable="${vaultCanEdit?"true":"false"}" data-side="${side}" data-key="${esc(key)}">
   <div class="match-card-head"><b>${side==="system"?"السيستم":"السجل"}</b><span>${row.ref?"#"+esc(row.ref):"#"+esc(row.number||index)}</span></div>
   <div class="match-amount">${reconMoney(row.amount)}</div><div>${esc(row.type||"")}</div><small>${esc(row.description||"—")}</small>
   <select class="review-status" ${vaultCanEdit?"":"disabled"}><option value="" ${!rv.status?"selected":""}>بدون حالة</option><option value="verified" ${rv.status==="verified"?"selected":""}>تم التحقق</option><option value="review" ${rv.status==="review"?"selected":""}>يحتاج مراجعة</option></select>
   <textarea class="review-comment" placeholder="تعليق على العملية" ${vaultCanEdit?"":"disabled"}>${esc(rv.comment||"")}</textarea>
   <button type="button" class="save-review" ${vaultCanEdit?"":"disabled"}>💾 حفظ التعليق</button>
  </div>`;
 };
 const rowsHtml=pairs.map((p,n)=>{
  const cls=p.kind==="matched"||p.kind==="manual"?"matched-row":p.kind==="systemOnly"?"system-only-row":"local-only-row";
  const badge=p.kind==="manual"?"<small class='manual-badge'>مطابقة يدوية</small>":p.kind==="matched"?`<small class='auto-badge'>${esc(p.confidence||"مطابقة")}</small>`:"";
  return `<div class="match-pair ${cls}" data-pair="${n}">${card("system",p.system,n,p.kind)}<div class="match-link">${p.kind==="matched"||p.kind==="manual"?"↔":"⇄"}${badge}</div>${card("local",p.local,n,p.kind)}</div>`;
 }).join("");
 box.innerHTML=rowsHtml||'<div class="empty-visual">لا توجد حركات لعرضها.</div>';
 box.querySelectorAll(".match-card").forEach(cardEl=>{
  cardEl.addEventListener("dragstart",e=>e.dataTransfer.setData("text/plain",JSON.stringify({side:cardEl.dataset.side,key:cardEl.dataset.key})));
  cardEl.addEventListener("dragover",e=>e.preventDefault());
  cardEl.addEventListener("drop",e=>{e.preventDefault();handleManualDrop(cardEl,e.dataTransfer.getData("text/plain"),data)});
  cardEl.querySelector(".save-review")?.addEventListener("click",()=>{
   const side=cardEl.dataset.side,key=cardEl.dataset.key,arr=side==="system"?data.systemRows:data.localRows;const index=arr.findIndex((x,i)=>rowReviewKey(side,x,i)===key);const row=index>=0?arr[index]:null;
   if(!row)return; saveReview(side,row,index,cardEl.querySelector(".review-status")?.value||"",cardEl.querySelector(".review-comment")?.value||""); setStatus("⏳ تم تسجيل الملاحظة — جارٍ الحفظ على الخادم");
  });
 });
}
function handleManualDrop(target,raw,data){
 try{
  const src=JSON.parse(raw); if(!src||src.side===target.dataset.side)return;
  const sourceArr=src.side==="system"?data.systemRows:data.localRows;
  const targetArr=target.dataset.side==="system"?data.systemRows:data.localRows;
  const sourceIndex=sourceArr.findIndex((x,i)=>rowReviewKey(src.side,x,i)===src.key);
  const targetIndex=targetArr.findIndex((x,i)=>rowReviewKey(target.dataset.side,x,i)===target.dataset.key);
  const source=sourceIndex>=0?sourceArr[sourceIndex]:null, dest=targetIndex>=0?targetArr[targetIndex]:null; if(!source||!dest)return;
  const system=src.side==="system"?source:dest, local=src.side==="local"?source:dest;
  const all=records(),r=all[currentDate]; r.reconciliation=r.reconciliation||{};r.reconciliation.manualMatches=r.reconciliation.manualMatches||{};
  r.reconciliation.manualMatches[system.ref||rowReviewKey("system",system,sourceIndex)]=local.number;
  saveRecords(all);
  const cmp=matchTransactions(data.systemRows,data.localRows); renderRecon({...data,...cmp}); renderVisualMatchMap({...data,...cmp});
  setStatus("⏳ تمت المطابقة اليدوية — جارٍ الحفظ على الخادم");
 }catch(e){console.error(e)}
}

function periodRange(days){const end=new Date();const start=new Date(end);start.setDate(end.getDate()-days+1);return [localDate(start),localDate(end)]}
function updatePeriodStats(){
 const from=$("periodFrom")?.value,to=$("periodTo")?.value;if(!from||!to)return;
 const all=records(),days=Object.keys(all).filter(d=>d>=from&&d<=to).sort();
 let inSum=0,outSum=0,short=0,sur=0,max=0,avg=0,count=0;const points=[];
 days.forEach(d=>{const r=all[d];if(!r)return;const tin=(r.rows||[]).reduce((s,x)=>s+(parseFloat(x.income)||0),0),tout=(r.rows||[]).reduce((s,x)=>s+(parseFloat(x.outcome)||0),0);const diff=Number.isFinite(r.actual)&&Number.isFinite(r.system)?r.actual-r.system:null;inSum+=tin;outSum+=tout;if(diff!=null){count++;avg+=Math.abs(diff);max=Math.max(max,Math.abs(diff));if(diff<0)short++;if(diff>0)sur++;}points.push({d,b:getDayClosing(r)});});
 avg=count?avg/count:0;
 $("periodStats").innerHTML=`<div><span>الأيام</span><b>${days.length}</b></div><div><span>إجمالي الدخول</span><b>${money(inSum)}</b></div><div><span>إجمالي الخروج</span><b>${money(outSum)}</b></div><div><span>أيام العجز</span><b>${short}</b></div><div><span>أيام الأوفر</span><b>${sur}</b></div><div><span>أكبر فرق</span><b>${money(max)}</b></div><div><span>متوسط الفرق</span><b>${money(avg)}</b></div>`;
 drawBalanceChart(points);
}
function drawBalanceChart(points){const c=$("balanceChart");if(!c)return;const ctx=c.getContext("2d"),w=c.width=c.clientWidth*2,h=c.height=260*2;ctx.clearRect(0,0,w,h);if(!points.length){ctx.font="28px Arial";ctx.fillText("لا توجد بيانات",w/2-80,h/2);return;}const pad=55,vals=points.map(x=>x.b),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;ctx.strokeStyle="#9aa8b5";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(pad,20);ctx.lineTo(pad,h-pad);ctx.lineTo(w-20,h-pad);ctx.stroke();ctx.strokeStyle="#1976d2";ctx.lineWidth=4;ctx.beginPath();points.forEach((p,i)=>{const x=pad+i*(w-pad-25)/Math.max(points.length-1,1),y=h-pad-(p.b-min)/range*(h-pad-35);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.fillStyle="#173b63";ctx.font="20px Arial";points.forEach((p,i)=>{const x=pad+i*(w-pad-25)/Math.max(points.length-1,1),y=h-pad-(p.b-min)/range*(h-pad-35);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();if(points.length<=14)ctx.fillText(p.d.slice(5),x-22,h-15);});}
function setupPeriod(){const [f,t]=periodRange(7);$("periodFrom").value=f;$("periodTo").value=t;updatePeriodStats();}
$("periodWeek")?.addEventListener("click",()=>{const [f,t]=periodRange(7);$("periodFrom").value=f;$("periodTo").value=t;updatePeriodStats()});
$("periodMonth")?.addEventListener("click",()=>{const [f,t]=periodRange(30);$("periodFrom").value=f;$("periodTo").value=t;updatePeriodStats()});
$("periodRefresh")?.addEventListener("click",updatePeriodStats);$("periodFrom")?.addEventListener("change",updatePeriodStats);$("periodTo")?.addEventListener("change",updatePeriodStats);

function quickCompare(){const s=parseFloat($("quickSystem")?.value),a=parseFloat($("quickActual")?.value),box=$("quickResult");if(!Number.isFinite(s)||!Number.isFinite(a)){box.textContent="أدخل القيم لحساب الفرق";box.className="quick-result";return;}const d=a-s;box.className="quick-result "+(Math.abs(d)<.005?"ok":d<0?"shortage":"surplus");box.textContent=Math.abs(d)<.005?"مطابق تمامًا":`${d<0?"عجز":"أوفر"}: ${money(Math.abs(d))}`;}
$("quickSystem")?.addEventListener("input",quickCompare);$("quickActual")?.addEventListener("input",quickCompare);

// Repeated shortage alert: only when three or more consecutive recorded days have a shortage.
function repeatedShortageAlert(){document.querySelectorAll(".repeat-alert").forEach(x=>x.remove());const all=records(),dates=Object.keys(all).sort();let streak=[];for(const d of dates){const r=all[d],diff=Number.isFinite(r?.actual)&&Number.isFinite(r?.system)?r.actual-r.system:null;if(diff!==null&&diff<-.005)streak.push(d);else streak=[];if(streak.length>=3){const el=document.createElement("div");el.className="repeat-alert";el.textContent=`⚠️ تنبيه: ظهر عجز في 3 أيام متتالية على الأقل (${streak.slice(-3).join("، ")}). هذا تنبيه للمراجعة وليس إثباتًا لسبب العجز.`;document.querySelector(".container")?.prepend(el);break;}}}

// Preserve review/manual matching fields when a new reconciliation is saved.
const _oldPersistReconciliation=persistReconciliation;
persistReconciliation=function(report,cmp,actualValue){const prev=currentRecon()||{};_oldPersistReconciliation(report,cmp,actualValue);const all=records(),r=all[currentDate];r.reconciliation.manualMatches=prev.manualMatches||{};r.reconciliation.reviews=prev.reviews||{};saveRecords(all);};

const _oldAnalyze=analyzeSystemPdf;
analyzeSystemPdf=async function(){await _oldAnalyze();const r=records()[currentDate]?.reconciliation;if(r?.rows?.length){const l=localRegisterTransactions(),cmp=matchTransactions(r.rows,l);renderVisualMatchMap({systemRows:r.rows,localRows:l,...cmp});}updatePeriodStats();repeatedShortageAlert();};
const _oldRestore=restoreReconciliation;
restoreReconciliation=function(){_oldRestore();const r=records()[currentDate]?.reconciliation;if(r?.rows?.length){const l=localRegisterTransactions(),cmp=matchTransactions(r.rows,l);renderVisualMatchMap({systemRows:r.rows,localRows:l,...cmp});}};
setupPeriod();
repeatedShortageAlert();

$("analyzeSystemReport")?.addEventListener("click",analyzeSystemPdf);
initializeVault();
