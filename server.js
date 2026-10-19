"use strict";

// Shared LAN server. Requires Node.js 18+.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {fifoConsume,reorderSuggestion,transactionProfit,verifyTotp}=require("./domain");
const root=__dirname,dataDir=process.env.GCA_DATA_DIR?path.resolve(process.env.GCA_DATA_DIR):path.join(root,"data"),dbPath=path.join(dataDir,"accounts.json"),backupDir=process.env.GCA_BACKUP_DIR?path.resolve(process.env.GCA_BACKUP_DIR):path.join(dataDir,"backups");
fs.mkdirSync(dataDir,{recursive:true});fs.mkdirSync(backupDir,{recursive:true});
const keyPath=path.join(dataDir,".secret-key");let secretKey;if(process.env.GCA_SECRET_KEY){const configured=String(process.env.GCA_SECRET_KEY);secretKey=/^[a-f0-9]{64}$/i.test(configured)?Buffer.from(configured,"hex"):Buffer.from(configured,"base64");if(secretKey.length!==32)throw new Error("GCA_SECRET_KEY must be a 32-byte hex or base64 key.");}else{try{secretKey=fs.readFileSync(keyPath);if(secretKey.length!==32)throw new Error("Invalid local encryption key length.");}catch(error){if(error.code!=="ENOENT")throw error;secretKey=crypto.randomBytes(32);fs.writeFileSync(keyPath,secretKey,{mode:0o600,flag:"wx"});}}
const defaultPrintBrand=()=>({arabicName:"العزيز بالله",englishName:"AL-AZIZ BELLAH",tagline:"JEWELRY",address:"",phones:"",footerNote:"",logoDataUrl:"",qrDataUrl:""});
const emptyState=()=>({customers:[],transactions:[],inventoryItems:[],inventoryMovements:[],inventoryLots:[],nextCustomer:1,nextTransaction:1,settings:{branchName:"الفرع الرئيسي",goldPrice24:0,makingPerGram:0,taxRate:0,employeeDaysOff:{},idleTimeoutMinutes:30,goldAlertThresholdPercent:3,goldAlertWindowMinutes:60,reorderPeriodDays:30,reorderLeadDays:7,reorderSafetyDays:7,pledgeReminderDays:7,pledgeFeePercent:0,anomalyCancelCount:3,anomalyCancelMinutes:30,workStart:"09:00",workEnd:"23:00",anomalyDiscountPercent:15,printBrand:defaultPrintBrand()}});
const DEFAULT_BRANCH_ID="main";
const defaultBranch=()=>({id:DEFAULT_BRANCH_ID,name:"الفرع الرئيسي",address:"",phone:"",active:true,createdAt:new Date().toISOString()});
let store;try{store=JSON.parse(fs.readFileSync(dbPath,"utf8"));}catch{store={users:[],version:0,state:emptyState(),audit:[]};}
store.users ||= [];store.version ||= 0;store.state={...emptyState(),...(store.state||{})};store.state.settings={...emptyState().settings,...(store.state.settings||{})};store.state.settings.printBrand={...defaultPrintBrand(),...(store.state.settings.printBrand||{})};store.state.inventoryLots ||= [];store.audit ||= [];
// ── Multi-branch migration ──────────────────────────────────────────────────
store.branches ||= [defaultBranch()];
if(!store.branches.some(b=>b.id===DEFAULT_BRANCH_ID))store.branches.unshift(defaultBranch());
// Assign existing records to default branch if they don't have a branchId
for(const c of store.state.customers)c.branchId ||= DEFAULT_BRANCH_ID;
for(const t of store.state.transactions)t.branchId ||= DEFAULT_BRANCH_ID;
for(const i of store.state.inventoryItems)i.branchId ||= DEFAULT_BRANCH_ID;
for(const m of store.state.inventoryMovements)m.branchId ||= DEFAULT_BRANCH_ID;
for(const l of store.state.inventoryLots)l.branchId ||= DEFAULT_BRANCH_ID;
for(const u of store.users)u.branchId ||= DEFAULT_BRANCH_ID;
// ────────────────────────────────────────────────────────────────────────────
store.vault ||= {};store.vaultVersion ||= 0;
store.goldPrices ||= {mode:"auto",auto:{prices:null,updatedAt:null,source:"goldprice.dev"},manual:null,error:null};
store.goldPrices.auto ||= {prices:null,updatedAt:null,source:"goldprice.dev"};
store.goldPrices.mode=store.goldPrices.mode==="manual"?"manual":"auto";
store.goldPriceHistory ||= [];store.alerts ||= [];store.pieces ||= [];store.manufacturingOrders ||= [];store.pledges ||= [];store.suppliers ||= [];store.supplierPurchases ||= [];store.supplierPayments ||= [];store.cashClosings ||= [];store.backupStatus ||= {lastAttemptAt:null,lastSuccessAt:null,lastError:""};
for(const item of store.state.inventoryItems){if(Number(item.quantity)>0&&!store.state.inventoryLots.some(l=>l.itemId===item.id)){store.state.inventoryLots.push({id:`legacy-${item.id}`,itemId:item.id,receivedAt:item.createdAt||new Date().toISOString(),quantityReceived:Number(item.quantity),quantityRemaining:Number(item.quantity),unitCost:null,unitMakingCost:null,legacy:true});}}
const sessions=new Map(),mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const publicFiles=new Set(["index.html","app.js","advanced.js","style.css","vault/index.html","vault/script.js","vault/style.css"]);
const json=(res,status,value,headers={})=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers});res.end(JSON.stringify(value));};
function persist(){const temp=dbPath+".tmp";fs.writeFileSync(temp,JSON.stringify(store,null,2),{mode:0o600});fs.renameSync(temp,dbPath);}
function readBody(req){return new Promise((resolve,reject)=>{let body="";req.on("data",chunk=>{body+=chunk;if(body.length>5_000_000){reject(new Error("حجم الطلب أكبر من المسموح."));req.destroy();}});req.on("end",()=>{try{resolve(JSON.parse(body||"{}"));}catch{reject(new Error("بيانات الطلب غير صالحة."));}});req.on("error",reject);});}
function hasPermission(user,permission){return !!(user&&(user.role==="manager"||(((user.permissions||[]).includes(permission)||(permission==="vault:view"&&(user.permissions||[]).includes("vault:edit")))&&(!user.permissionsExpiresAt||Date.parse(user.permissionsExpiresAt)>Date.now()))));}
function userView(u){return{id:u.id,username:u.username,name:u.name,role:u.role,active:!!u.active,permissions:u.permissionsExpiresAt&&Date.parse(u.permissionsExpiresAt)<=Date.now()?[]:(u.permissions||[]),permissionsExpiresAt:u.permissionsExpiresAt||null,mustChangePassword:!!u.mustChangePassword,twoFactorEnabled:!!u.twoFactorEnabled,branchId:u.branchId||DEFAULT_BRANCH_ID};}
// Returns the branch the current user is allowed to see.
// Manager with ?branchId= query gets that branch; employees see their own.
function resolveUserBranch(u,url){
  if(u.role==="manager"){
    const bid=url.searchParams.get("branchId")||u.branchId||DEFAULT_BRANCH_ID;
    if(bid==="all")return"all";
    const b=store.branches.find(x=>x.id===bid&&x.active);
    return b?b.id:DEFAULT_BRANCH_ID;
  }
  return u.branchId||DEFAULT_BRANCH_ID;
}
function branchFilter(branchId){
  return branchId==="all"?(()=>true):((rec)=>rec.branchId===branchId);
}
function stateForBranch(branchId){
  const s=store.state;
  const bf=branchFilter(branchId);
  return{
    ...s,
    customers:s.customers.filter(bf),
    transactions:s.transactions.filter(bf),
    inventoryItems:s.inventoryItems.filter(bf),
    inventoryMovements:s.inventoryMovements.filter(bf),
    inventoryLots:s.inventoryLots.filter(bf),
    nextCustomer:s.nextCustomer,
    nextTransaction:s.nextTransaction,
    settings:s.settings,
  };
}
function currentUser(req){const c=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("gca_session=")),token=c?.slice(12),session=token&&sessions.get(token);if(!session)return null;const timeout=Math.max(1,Number(store.state.settings?.idleTimeoutMinutes)||30)*60000;if(Date.now()-session.lastActivityAt>timeout){sessions.delete(token);return null;}if(req.headers["x-gca-background"]!=="1")session.lastActivityAt=Date.now();return store.users.find(u=>u.id===session.userId&&u.active)||null;}
const cookie=(token,age=43200)=>`gca_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
function passwordHash(password,salt=crypto.randomBytes(16).toString("hex")){return{salt,hash:crypto.scryptSync(password,salt,64).toString("hex")};}
function sealSecret(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",secretKey,iv),encrypted=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]);return`v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;}
function openSecret(value){const parts=String(value||"").split(":");if(parts.length!==4||parts[0]!=="v1")return String(value||"");const[,ivHex,tagHex,bodyHex]=parts;if(!/^[a-f0-9]{24}$/i.test(ivHex)||!/^[a-f0-9]{32}$/i.test(tagHex)||!/^(?:[a-f0-9]{2})*$/i.test(bodyHex))throw new Error("تعذر فك سر التحقق المشفر.");const decipher=crypto.createDecipheriv("aes-256-gcm",secretKey,Buffer.from(ivHex,"hex"));decipher.setAuthTag(Buffer.from(tagHex,"hex"));return Buffer.concat([decipher.update(Buffer.from(bodyHex,"hex")),decipher.final()]).toString("utf8");}
let migratedTotpSecrets=false;for(const user of store.users)for(const field of ["twoFactorSecret","twoFactorPendingSecret"]){if(user[field]&&!String(user[field]).startsWith("v1:")){user[field]=sealSecret(user[field]);migratedTotpSecrets=true;}}if(migratedTotpSecrets)persist();
function sameOrigin(req){if(!req.headers.origin)return true;try{return new URL(req.headers.origin).host===req.headers.host;}catch{return false;}}
function requireUser(req,res,role){const u=currentUser(req);if(!u){json(res,401,{error:"انتهت الجلسة أو يلزم تسجيل الدخول."});return null;}const pathname=new URL(req.url,"http://localhost").pathname;if(u.mustChangePassword&&!(["/api/password","/api/logout","/api/me"].includes(pathname))){json(res,428,{error:"يجب تغيير كلمة المرور قبل استخدام النظام."});return null;}if(role&&u.role!==role){json(res,403,{error:"هذه الصلاحية للمدير فقط."});return null;}return u;}
function requirePermission(user,permission,res){if(hasPermission(user,permission))return true;json(res,403,{error:"لا يملك حسابك صلاحية تنفيذ هذا الإجراء أو انتهت صلاحيتها."});return false;}
function cleanPrintBrand(input){const src=input&&typeof input==="object"&&!Array.isArray(input)?input:{},out={...defaultPrintBrand()};for(const[key,max]of [["arabicName",100],["englishName",100],["tagline",100],["address",240],["phones",180],["footerNote",600]])out[key]=String(src[key]??out[key]).trim().slice(0,max);for(const key of ["logoDataUrl","qrDataUrl"]){const value=String(src[key]||"");if(value.length>1_400_000||value&&!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error("صورة قالب الطباعة غير صالحة أو أكبر من 1 ميجابايت.");out[key]=value;}return out;}
function validImageData(value,maxBytes){const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value||""));if(!match)return false;const bytes=Buffer.from(match[2],"base64");if(bytes.length>maxBytes)return false;if(match[1]==="png")return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(match[1]==="jpeg")return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;return bytes.length>=12&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP";}
function validDateOnly(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return false;const date=new Date(String(value)+"T00:00:00.000Z");return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function cleanPrintBrand(input){const src=input&&typeof input==="object"&&!Array.isArray(input)?input:{},out={...defaultPrintBrand()};for(const[key,max]of [["arabicName",100],["englishName",100],["tagline",100],["address",240],["phones",180],["footerNote",600]])out[key]=String(src[key]??out[key]).trim().slice(0,max);for(const key of ["logoDataUrl","qrDataUrl"]){const value=String(src[key]||"");if(value&&!validImageData(value,1024*1024))throw new Error("صورة قالب الطباعة غير صالحة أو أكبر من 1 ميجابايت.");out[key]=value;}return out;}
function cleanState(s){if(!s||!Array.isArray(s.customers)||!Array.isArray(s.transactions))throw new Error("صيغة بيانات النظام غير صالحة.");const items=Array.isArray(s.inventoryItems)?s.inventoryItems:[];for(const item of items){const image=String(item.image||"");if(image&&!validImageData(image,300*1024))throw new Error("صورة صنف المخزون غير صالحة أو أكبر من 300 كيلوبايت.");}const settings={...store.state.settings,...(s.settings||{})};settings.printBrand=cleanPrintBrand(s.settings?.printBrand??settings.printBrand);return{customers:s.customers,transactions:s.transactions,inventoryItems:items,inventoryMovements:Array.isArray(s.inventoryMovements)?s.inventoryMovements:[],inventoryLots:Array.isArray(s.inventoryLots)?s.inventoryLots:store.state.inventoryLots||[],nextCustomer:Number(s.nextCustomer)||1,nextTransaction:Number(s.nextTransaction)||1,settings};}
function newUser(name,username,password,role,branchId=DEFAULT_BRANCH_ID){const p=passwordHash(password);return{id:crypto.randomUUID(),username,name,role,salt:p.salt,passwordHash:p.hash,active:true,mustChangePassword:role==="employee",twoFactorEnabled:false,branchId,permissions:role==="manager"?[]:["customers:create","transactions:create","transactions:cancel","inventory:view","inventory:edit","reports:view","vault:view","vault:edit"],createdAt:new Date().toISOString()};}
function log(user,action,details={}){store.audit.push({id:crypto.randomUUID(),date:new Date().toISOString(),userId:user?.id||null,userName:user?.name||"النظام",action,details});if(store.audit.length>20000)store.audit=store.audit.slice(-20000);}
function createAlert(type,title,message,details={},audience="manager",dedupeKey="") {if(dedupeKey&&store.alerts.some(a=>a.dedupeKey===dedupeKey&&!a.resolvedAt))return null;const alert={id:crypto.randomUUID(),type,title,message,details,audience,dedupeKey,createdAt:new Date().toISOString(),reviewedAt:null,reviewedBy:null,resolvedAt:null};store.alerts.push(alert);if(store.alerts.length>10000)store.alerts=store.alerts.slice(-10000);log(null,"تنبيه آلي",{type,title,details});return alert;}
function alertForStock(item){const active=Number(item.quantity)<=Number(item.minimum||0),key=`stock:${item.id}`;if(active)createAlert("stock-low","مخزون منخفض",`الصنف ${item.name} وصل إلى حد التنبيه أو أقل.`,{itemId:item.id,quantity:item.quantity,minimum:item.minimum},"manager",key);else for(const a of store.alerts)if(a.dedupeKey===key&&!a.resolvedAt)a.resolvedAt=new Date().toISOString();}
function addGoldSnapshot(prices,source,updatedBy="") {if(!prices||[24,21,18].some(k=>!Number.isFinite(Number(prices[k]))||Number(prices[k])<=0))return;const now=new Date(),snapshot={id:crypto.randomUUID(),at:now.toISOString(),prices:{24:Number(prices[24]),21:Number(prices[21]),18:Number(prices[18])},source,updatedBy};const last=store.goldPriceHistory.at(-1);if(last&&[24,21,18].every(k=>last.prices[k]===snapshot.prices[k])&&last.source===source&&last.updatedBy===updatedBy)return;store.goldPriceHistory.push(snapshot);if(store.goldPriceHistory.length>10000)store.goldPriceHistory=store.goldPriceHistory.slice(-10000);const settings=store.state.settings,windowMs=Math.max(1,Number(settings.goldAlertWindowMinutes)||60)*60000,threshold=Math.max(.1,Number(settings.goldAlertThresholdPercent)||3),recent=store.goldPriceHistory.slice(0,-1).reverse().find(x=>now-Date.parse(x.at)<=windowMs);if(recent){for(const k of [24,21,18]){const percent=(snapshot.prices[k]-recent.prices[k])/recent.prices[k]*100;if(Math.abs(percent)>=threshold)createAlert("gold-move",`تغير ملحوظ في سعر عيار ${k}`,`تغير السعر ${percent>0?"بالارتفاع":"بالانخفاض"} بنسبة ${Math.abs(percent).toFixed(2)}% خلال الفترة المحددة.`,{karat:k,from:recent.prices[k],to:snapshot.prices[k],percent:Number(percent.toFixed(2)),windowMinutes:Math.round((now-Date.parse(recent.at))/60000)},"all",`gold:${k}:${Math.floor(Date.now()/windowMs)}`);}}}
function runOperationalAlerts(){const now=new Date(),today=now.toISOString().slice(0,10),days=Math.max(0,Number(store.state.settings.pledgeReminderDays??7)||0),limit=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+days)).toISOString().slice(0,10);for(const p of store.pledges){const due=String(p.dueDate||"").slice(0,10);if(p.status==="active"&&validDateOnly(due)&&due>=today&&due<=limit)createAlert("pledge-due","اقتراب موعد استرداد رهن",`اقترب موعد استرداد الرهن ${p.number} للعميل ${p.customerName}.`,{pledgeId:p.id,dueDate:p.dueDate,customerName:p.customerName},"manager",`pledge:${p.id}:${due}`);else if(p.status==="active"&&validDateOnly(due)&&due<today)createAlert("pledge-overdue","تجاوز موعد استرداد رهن",`تجاوز الرهن ${p.number} موعد الاسترداد للعميل ${p.customerName}.`,{pledgeId:p.id,dueDate:p.dueDate,customerName:p.customerName},"manager",`pledge-overdue:${p.id}:${due}`);}for(const target of store.users){if(target.role==="employee"&&target.active&&target.permissionsExpiresAt){const expiry=Date.parse(target.permissionsExpiresAt);if(expiry>now.getTime()&&expiry<=now.getTime()+7*86400000)createAlert("permission-expiring","اقتراب انتهاء صلاحية موظف","تنتهي صلاحيات "+target.name+" المؤقتة خلال 7 أيام.",{userId:target.id,expiresAt:target.permissionsExpiresAt},"manager","permission-expiring:"+target.id+":"+target.permissionsExpiresAt.slice(0,10));}}for(const item of store.state.inventoryItems)alertForStock(item);}
function makeBackup(reason="تلقائي"){
 const now=new Date(),stamp=now.toISOString().replace(/[:.]/g,"-").replace(/Z$/,"");
 const file=`backup-${stamp}.json`,snapshot={createdAt:now.toISOString(),reason,version:store.version,state:store.state,vault:store.vault,vaultVersion:store.vaultVersion,goldPrices:store.goldPrices,goldPriceHistory:store.goldPriceHistory,alerts:store.alerts,pieces:store.pieces,manufacturingOrders:store.manufacturingOrders,pledges:store.pledges,suppliers:store.suppliers,supplierPurchases:store.supplierPurchases,supplierPayments:store.supplierPayments,cashClosings:store.cashClosings,backupStatus:{lastAttemptAt:now.toISOString(),lastSuccessAt:now.toISOString(),lastError:""},audit:store.audit};
 fs.writeFileSync(path.join(backupDir,file),JSON.stringify(snapshot,null,2),{mode:0o600});
 const cutoff=Date.now()-30*24*60*60*1000;
 for(const name of fs.readdirSync(backupDir)){if(!/^backup-[\dTZ-]+\.json$/.test(name))continue;const target=path.join(backupDir,name);try{if(fs.statSync(target).mtimeMs<cutoff)fs.unlinkSync(target);}catch{}}
 store.backupStatus={lastAttemptAt:now.toISOString(),lastSuccessAt:now.toISOString(),lastError:""};for(const a of store.alerts)if(a.type==="backup-failure"&&!a.resolvedAt)a.resolvedAt=now.toISOString();return file;
}
function backupFailure(error){const at=new Date().toISOString();store.backupStatus={lastAttemptAt:at,lastSuccessAt:store.backupStatus?.lastSuccessAt||null,lastError:String(error?.message||error).slice(0,500)};createAlert("backup-failure","فشل النسخ الاحتياطي التلقائي",`تعذر إنشاء نسخة تلقائية: ${store.backupStatus.lastError}`,{at},"manager","backup-failure");try{persist();}catch{}console.error("Backup failed",error);}
function scheduleDailyBackup(){const now=new Date(),next=new Date(now);next.setHours(2,0,0,0);if(next<=now)next.setDate(next.getDate()+1);setTimeout(()=>{try{makeBackup();persist();}catch(e){backupFailure(e);}setInterval(()=>{try{makeBackup();persist();}catch(e){backupFailure(e);}},24*60*60*1000);},Math.max(1000,next-now));}
if(store.users.length||store.state.customers.length||store.state.transactions.length){try{if(!fs.readdirSync(backupDir).length){makeBackup("تهيئة أولية");persist();}}catch(e){backupFailure(e);}}
scheduleDailyBackup();

const GOLD_PRICE_REFRESH_MS=5*60*1000;
let goldPriceLastAttempt=0,goldPriceRefreshPromise=null;
function goldPricesView(){
 const g=store.goldPrices,active=g.mode==="manual"?g.manual:g.auto;
 return{mode:g.mode,prices:active?.prices||null,updatedAt:active?.updatedAt||null,updatedBy:g.mode==="manual"?(g.manual?.updatedBy||""):"",source:g.mode==="manual"?"تعديل يدوي":(g.auto?.source||"goldprice.dev"),automaticPrices:g.auto?.prices||null,automaticUpdatedAt:g.auto?.updatedAt||null,error:g.mode==="auto"?(g.error||""):"",currency:"EGP",unit:"ج.م/جرام"};
}
async function refreshGoldPrices(force=false){
 if(store.goldPrices.mode!=="auto")return;
 if(goldPriceRefreshPromise)return goldPriceRefreshPromise;
 const now=Date.now(),minimumDelay=force?60_000:GOLD_PRICE_REFRESH_MS;
 if(goldPriceLastAttempt&&now-goldPriceLastAttempt<minimumDelay)return;
 goldPriceLastAttempt=now;
 goldPriceRefreshPromise=(async()=>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch("https://api.goldprice.dev/v1/carat?currency=EGP",{signal:controller.signal,headers:{Accept:"application/json"}});
   if(!response.ok)throw new Error("HTTP "+response.status);
   const body=await response.json(),updated=Date.parse(body.timestamp);
   const prices={24:Number(body.price_gram_24k),21:Number(body.price_gram_21k),18:Number(body.price_gram_18k)};
   if(body.currency!=="EGP"||!Number.isFinite(updated)||updated>Date.now()+5*60*1000||Date.now()-updated>7*24*60*60*1000||Object.values(prices).some(v=>!Number.isFinite(v)||v<=0))throw new Error("استجابة سعر الذهب غير صالحة أو قديمة.");
   store.goldPrices.auto={prices,updatedAt:new Date(updated).toISOString(),source:"goldprice.dev"};
   store.goldPrices.error=null;addGoldSnapshot(prices,"تلقائي","goldprice.dev");persist();
  }catch(e){store.goldPrices.error="تعذر تحديث السعر العالمي؛ يتم عرض آخر سعر محفوظ إن وجد.";console.warn("Gold price refresh failed",e.message);}
  finally{clearTimeout(timeout);}
 })().finally(()=>{goldPriceRefreshPromise=null;});
 return goldPriceRefreshPromise;
}
if(process.env.GCA_DISABLE_EXTERNAL_REFRESH!=="1"){setTimeout(()=>refreshGoldPrices(),2000);setInterval(()=>refreshGoldPrices(),GOLD_PRICE_REFRESH_MS);}

function supplierBalance(supplierId){const purchased=store.supplierPurchases.filter(p=>p.supplierId===supplierId).reduce((sum,p)=>sum+Number(p.totalCost||0),0),paid=store.supplierPayments.filter(p=>p.supplierId===supplierId).reduce((sum,p)=>sum+Number(p.amount||0),0);return Number((purchased-paid).toFixed(2));}
function cashDayLocked(day){return store.cashClosings.some(c=>c.date===day&&(c.status==="submitted"||c.status==="approved"));}
function cashSummaryForDate(day){const entries=[];for(const tx of store.state.transactions){if(tx.status==="cancelled"||String(tx.date||"").slice(0,10)!==day)continue;let amount=0,label="";const cashMethod=!tx.paymentMethod||tx.paymentMethod==="cash";if(tx.type==="sell"&&cashMethod){amount=Number(tx.paid)||0;label="تحصيل نقدي من فاتورة بيع";}else if(tx.type==="buy"&&cashMethod){amount=-(Number(tx.paid)||0);label="مدفوع نقدًا لشراء من عميل";}else if(tx.type==="payment"&&cashMethod){amount=Number(tx.amount)||0;label="تحصيل نقدي";}else if(tx.type==="cash-deposit"){amount=Number(tx.amount)||0;label="إيداع نقدي";}else if(tx.type==="cash-refund"){amount=-(Number(tx.amount)||0);label="رد نقدي للعميل";}if(amount)entries.push({label,amount:Number(amount.toFixed(2)),source:"customer",by:tx.createdBy?.name||"غير معروف",reference:tx.number||""});}for(const p of store.supplierPayments){if(p.paymentMethod==="cash"&&String(p.date||"").slice(0,10)===day&&Number(p.amount)>0)entries.push({label:"سداد نقدي لمورد",amount:-Number(p.amount),source:"supplier",by:p.createdBy?.name||"غير معروف",reference:p.note||""});}const cashIn=Number(entries.filter(x=>x.amount>0).reduce((s,x)=>s+x.amount,0).toFixed(2)),cashOut=Number(-entries.filter(x=>x.amount<0).reduce((s,x)=>s+x.amount,0).toFixed(2));return{date:day,cashIn,cashOut,net:Number((cashIn-cashOut).toFixed(2)),entries};}
let stateSaveRollback=null;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(url.pathname.startsWith("/api/")&&req.method!=="GET"&&!sameOrigin(req))return json(res,403,{error:"مصدر الطلب غير موثوق."});
 let m;
 try{
  if(req.method==="GET"&&url.pathname==="/api/status")return json(res,200,{setupRequired:store.users.length===0});
  if(req.method==="GET"&&url.pathname==="/api/gold-prices"){
   const u=requireUser(req,res);if(!u)return;
   const force=url.searchParams.get("refresh")==="1";if(force&&u.role!=="manager")return json(res,403,{error:"تحديث السعر يدويًا للمدير فقط."});
   await refreshGoldPrices(force);return json(res,200,goldPricesView());
  }
  if(req.method==="PUT"&&url.pathname==="/api/gold-prices"){
   const u=requireUser(req,res,"manager");if(!u)return;
   const b=await readBody(req);
   if(b.mode==="auto"){
    store.goldPrices.mode="auto";store.goldPrices.error=null;goldPriceLastAttempt=0;log(u,"إعادة أسعار الذهب إلى التحديث التلقائي");persist();
    await refreshGoldPrices(true);return json(res,200,goldPricesView());
   }
   if(b.mode!=="manual")return json(res,400,{error:"اختر التحديث التلقائي أو التعديل اليدوي."});
   const prices={24:Number(b.prices?.[24]),21:Number(b.prices?.[21]),18:Number(b.prices?.[18])};
   if(Object.values(prices).some(v=>!Number.isFinite(v)||v<=0||v>100000000))return json(res,400,{error:"أدخل أسعارًا موجبة وصالحة للعيارات الثلاثة."});
   store.goldPrices.mode="manual";store.goldPrices.manual={prices,updatedAt:new Date().toISOString(),updatedBy:u.name};store.goldPrices.error=null;addGoldSnapshot(prices,"يدوي",u.name);
   log(u,"تعديل أسعار الذهب العالمية يدويًا",{currency:"EGP",prices});persist();return json(res,200,goldPricesView());
  }
  if(req.method==="POST"&&url.pathname==="/api/setup"){
   const b=await readBody(req);if(store.users.length)return json(res,409,{error:"تم إنشاء حساب المدير بالفعل."});
   if(!/^[\p{L}\p{N}_.-]{3,40}$/u.test(String(b.username||""))||String(b.name||"").trim().length<2||String(b.password||"").length<10)return json(res,400,{error:"أدخل اسم مستخدم صالحًا، واسمًا لا يقل عن حرفين، وكلمة مرور من 10 أحرف على الأقل."});
   const u=newUser(String(b.name).trim(),String(b.username).trim(),String(b.password),"manager");store.users.push(u);log(u,"إنشاء حساب المدير");persist();const token=crypto.randomBytes(32).toString("hex");sessions.set(token,{userId:u.id,lastActivityAt:Date.now()});return json(res,201,{user:userView(u)},{"Set-Cookie":cookie(token)});
  }
  if(req.method==="POST"&&url.pathname==="/api/login"){
   const b=await readBody(req),u=store.users.find(x=>x.username===String(b.username||"").trim()&&x.active);if(!u)return json(res,401,{error:"اسم المستخدم أو كلمة المرور غير صحيحة."});
   const h=Buffer.from(passwordHash(String(b.password||""),u.salt).hash,"hex"),saved=Buffer.from(u.passwordHash,"hex");if(h.length!==saved.length||!crypto.timingSafeEqual(h,saved))return json(res,401,{error:"اسم المستخدم أو كلمة المرور غير صحيحة."});
   if(u.twoFactorEnabled&&!verifyTotp(openSecret(u.twoFactorSecret),b.otp))return json(res,401,{error:"رمز التحقق غير صحيح."});
   const token=crypto.randomBytes(32).toString("hex");sessions.set(token,{userId:u.id,lastActivityAt:Date.now()});return json(res,200,{user:userView(u)},{"Set-Cookie":cookie(token)});
  }
  if(req.method==="POST"&&url.pathname==="/api/logout"){const c=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("gca_session="));if(c)sessions.delete(c.slice(12));return json(res,200,{ok:true},{"Set-Cookie":cookie("",0)});}
  if(req.method==="GET"&&url.pathname==="/api/me"){const u=requireUser(req,res);if(u)return json(res,200,{user:userView(u)});return;}
  if(req.method==="POST"&&url.pathname==="/api/password"){
   const u=requireUser(req,res);if(!u)return;const b=await readBody(req);if(String(b.password||"").length<10)return json(res,400,{error:"كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل."});
   const check=Buffer.from(passwordHash(String(b.currentPassword||""),u.salt).hash,"hex"),saved=Buffer.from(u.passwordHash,"hex");if(check.length!==saved.length||!crypto.timingSafeEqual(check,saved))return json(res,403,{error:"كلمة المرور الحالية غير صحيحة."});
   const p=passwordHash(String(b.password));u.salt=p.salt;u.passwordHash=p.hash;u.mustChangePassword=false;log(u,"تغيير كلمة المرور");persist();return json(res,200,{ok:true});
  }
  if(req.method==="POST"&&url.pathname==="/api/session/ping"){const u=requireUser(req,res);if(!u)return;return json(res,200,{ok:true,timeoutMinutes:Math.max(1,Number(store.state.settings?.idleTimeoutMinutes)||30)});}
  if(req.method==="POST"&&url.pathname==="/api/two-factor/setup"){const u=requireUser(req,res);if(!u)return;if(u.twoFactorEnabled)return json(res,409,{error:"التحقق بخطوتين مفعّل بالفعل. أدخل رمزًا صالحًا لإيقافه أولًا."});const secret=crypto.randomBytes(20).toString("hex");u.twoFactorPendingSecret=sealSecret(secret);persist();const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";for(const byte of Buffer.from(secret,"hex"))bits+=byte.toString(2).padStart(8,"0");let base32="";for(let i=0;i<bits.length;i+=5)base32+=alphabet[parseInt(bits.slice(i,i+5).padEnd(5,"0"),2)];const uri=`otpauth://totp/${encodeURIComponent(`GoldAccounts:${u.username}`)}?secret=${base32}&issuer=GoldAccounts&digits=6&period=30`;return json(res,200,{secret:base32,uri});}
  if(req.method==="POST"&&url.pathname==="/api/two-factor/confirm"){const u=requireUser(req,res);if(!u)return;if(!u.twoFactorPendingSecret||!verifyTotp(openSecret(u.twoFactorPendingSecret),(await readBody(req)).code))return json(res,400,{error:"رمز التحقق غير صحيح. راجع الوقت والرمز في تطبيق المصادقة."});u.twoFactorSecret=u.twoFactorPendingSecret;delete u.twoFactorPendingSecret;u.twoFactorEnabled=true;log(u,"تفعيل التحقق بخطوتين");persist();return json(res,200,{ok:true,user:userView(u)});}
  if(req.method==="POST"&&url.pathname==="/api/two-factor/disable"){const u=requireUser(req,res);if(!u)return;const b=await readBody(req);if(!u.twoFactorEnabled||!verifyTotp(openSecret(u.twoFactorSecret),b.code))return json(res,400,{error:"رمز التحقق غير صحيح."});u.twoFactorEnabled=false;delete u.twoFactorSecret;delete u.twoFactorPendingSecret;log(u,"إيقاف التحقق بخطوتين");persist();return json(res,200,{ok:true});}
  if(req.method==="GET"&&url.pathname==="/api/state"){const u=requireUser(req,res);if(!u)return;
  const branchId=resolveUserBranch(u,url);
  const state=stateForBranch(branchId);
  if(!hasPermission(u,"inventory:view")){state.inventoryItems=[];state.inventoryMovements=[];state.serialPieces=[];}else{const pieceBranchId=branchId==="all"?null:branchId;state.serialPieces=(pieceBranchId?store.pieces.filter(p=>p.branchId===pieceBranchId||!p.branchId):store.pieces).map(p=>u.role==="manager"?p:({...p,unitCost:undefined,unitMakingCost:undefined}));}
  if(u.role!=="manager")state.inventoryLots=[];
  return json(res,200,{...state,version:store.version,user:userView(u),branchId,branches:u.role==="manager"?store.branches:store.branches.filter(b=>b.id===u.branchId||b.id===DEFAULT_BRANCH_ID).filter(b=>b.active)});}
  m=url.pathname.match(/^\/api\/inventory-lots\/([\w-]+)\/cost$/);if(req.method==="PUT"&&m){const u=requireUser(req,res,"manager");if(!u)return;const b=await readBody(req),lot=store.state.inventoryLots.find(x=>x.id===m[1]),unitCost=Number(b.unitCost),unitMakingCost=Number(b.unitMakingCost??0);if(!lot)return json(res,404,{error:"دفعة المخزون غير موجودة."});if(lot.unitCost!=null)return json(res,409,{error:"توجد تكلفة محفوظة لهذه الدفعة ولا يمكن استبدالها من هذا الإجراء."});if(Number(lot.quantityRemaining)<=0)return json(res,409,{error:"لا توجد كمية متبقية لتسجيل تكلفة افتتاحية لها."});if(!Number.isFinite(unitCost)||unitCost<0||!Number.isFinite(unitMakingCost)||unitMakingCost<0)return json(res,400,{error:"أدخل تكلفة شراء وتصنيع غير سالبتين."});lot.unitCost=unitCost;lot.unitMakingCost=unitMakingCost;lot.costSetAt=new Date().toISOString();lot.costSetBy={id:u.id,name:u.name};log(u,"تسجيل تكلفة افتتاحية لدفعة مخزون",{lotId:lot.id,itemId:lot.itemId,remaining:lot.quantityRemaining,unitCost,unitMakingCost});store.version++;persist();return json(res,200,{lot,version:store.version});}
  if(req.method==="GET"&&url.pathname==="/api/vault"){
   const u=requireUser(req,res);if(!u)return;if(!hasPermission(u,"vault:view"))return json(res,403,{error:"لا يملك حسابك صلاحية عرض مطابقة الخزنة."});
   return json(res,200,{records:store.vault,version:store.vaultVersion,user:userView(u)});
  }
  if(req.method==="PUT"&&url.pathname==="/api/vault"){
   const u=requireUser(req,res);if(!u)return;if(!hasPermission(u,"vault:edit"))return json(res,403,{error:"لا يملك حسابك صلاحية تعديل مطابقة الخزنة."});
   const b=await readBody(req),incoming=b.records,base=b.baseRecords;if(!incoming||typeof incoming!=="object"||Array.isArray(incoming)||!base||typeof base!=="object"||Array.isArray(base))return json(res,400,{error:"بيانات مطابقة الخزنة غير صالحة."});
   const keys=new Set([...Object.keys(base),...Object.keys(incoming)]),changed=[...keys].filter(d=>JSON.stringify(base[d]??null)!==JSON.stringify(incoming[d]??null));
   for(const d of changed){if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return json(res,400,{error:"تاريخ سجل الخزنة غير صالح."});if(JSON.stringify(store.vault[d]??null)!==JSON.stringify(base[d]??null)&&JSON.stringify(store.vault[d]??null)!==JSON.stringify(incoming[d]??null))return json(res,409,{error:`عدّل مستخدم آخر سجل الخزنة ليوم ${d}. حدّث الصفحة وراجع التغييرات قبل المتابعة.`,version:store.vaultVersion,records:store.vault});if(u.role!=="manager"&&((store.vault[d]?.closed&&JSON.stringify(store.vault[d]??null)!==JSON.stringify(incoming[d]??null))||(!Object.prototype.hasOwnProperty.call(incoming,d)&&Object.prototype.hasOwnProperty.call(store.vault,d))))return json(res,403,{error:"اليوم مغلق أو لا يمكن للموظف حذف سجل يوم. اطلب من المدير فتح اليوم أو إجراء التعديل."});}
   for(const d of changed){if(Object.prototype.hasOwnProperty.call(incoming,d))store.vault[d]=incoming[d];else delete store.vault[d];const r=incoming[d]||{},system=r.system==null||String(r.system).trim()===""?NaN:Number(r.system),actual=r.actual==null||String(r.actual).trim()===""?NaN:Number(r.actual),difference=Number.isFinite(system)&&Number.isFinite(actual)?Number((actual-system).toFixed(2)):null;log(u,"تحديث مطابقة الخزنة",{date:d,closed:!!r.closed,difference,operations:(Array.isArray(r.rows)?r.rows:[]).filter(x=>x&&(x.income||x.outcome||x.description)).length});if(difference!==null&&Math.abs(difference)>=.01){const occurrences=store.audit.filter(a=>a.userId===u.id&&a.action==="تحديث مطابقة الخزنة"&&Number.isFinite(Number(a.details?.difference))&&Math.abs(Number(a.details.difference))>=.01).length;if(occurrences>=2)createAlert("repeat-vault-difference","تكرر فرق الخزنة لموظف",`ظهر فرق خزنة في ${occurrences} سجلات لهذا المستخدم. راجع العمليات المسجلة.`,{userId:u.id,userName:u.name,occurrences,date:d,difference},"manager",`vault-difference:${u.id}`);}}
   if(changed.length){store.vaultVersion++;persist();}return json(res,200,{version:store.vaultVersion,records:store.vault});
  }
  if(req.method==="GET"&&url.pathname==="/api/suppliers"){
   const manager=requireUser(req,res,"manager");if(!manager)return;const suppliers=store.suppliers.map(s=>({...s,balance:supplierBalance(s.id)}));return json(res,200,{suppliers,purchases:store.supplierPurchases.slice().reverse(),payments:store.supplierPayments.slice().reverse(),version:store.version});
  }
  if(req.method==="POST"&&url.pathname==="/api/suppliers"){
   const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),name=String(b.name||"").trim(),phone=String(b.phone||"").trim();if(name.length<2||name.length>100||phone.length>30)return json(res,400,{error:"أدخل اسم مورد صالحًا ورقم هاتف لا يتجاوز 30 حرفًا."});if(store.suppliers.some(s=>s.name.toLocaleLowerCase()===name.toLocaleLowerCase()&&s.phone===phone))return json(res,409,{error:"المورد مسجل بالفعل بهذا الاسم ورقم الهاتف."});const supplier={id:crypto.randomUUID(),name,phone,notes:String(b.notes||"").trim().slice(0,300),createdAt:new Date().toISOString(),createdBy:{id:manager.id,name:manager.name}};store.suppliers.push(supplier);store.audit=store.audit.slice();log(manager,"إضافة مورد",{supplierId:supplier.id,name});store.version++;persist();return json(res,201,{supplier:{...supplier,balance:0},version:store.version});
  }
  if(req.method==="POST"&&url.pathname==="/api/supplier-purchases"){
   const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),supplier=store.suppliers.find(s=>s.id===String(b.supplierId||"")),name=String(b.itemName||"").trim(),sku=String(b.sku||"").trim(),karat=String(b.karat||""),weight=Number(b.weight),quantity=Number(b.quantity),unitCost=Number(b.unitCost),unitMakingCost=Number(b.unitMakingCost||0),paidNow=Number(b.paidNow||0),date=String(b.date||new Date().toISOString().slice(0,10)),paymentMethod=String(b.paymentMethod||"cash"),invoiceNo=String(b.invoiceNo||"").trim();if(!supplier)return json(res,404,{error:"اختر موردًا موجودًا."});if(name.length<2||name.length>100||sku.length>40||! /^(24|22|21|18|14|9)$/.test(karat)||!Number.isFinite(weight)||weight<=0||!Number.isInteger(quantity)||quantity<1||quantity>100000||!Number.isFinite(unitCost)||unitCost<0||!Number.isFinite(unitMakingCost)||unitMakingCost<0||!validDateOnly(date)||invoiceNo.length>80||!["cash","bank","other"].includes(paymentMethod))return json(res,400,{error:"راجع بيانات الصنف والعيار والوزن والكمية والتكاليف والتاريخ."});const totalCost=Number(((unitCost+unitMakingCost)*quantity).toFixed(2));if(!Number.isFinite(paidNow)||paidNow<0||paidNow>totalCost)return json(res,400,{error:"المبلغ المدفوع يجب أن يكون بين صفر وإجمالي فاتورة المورد."});if(paidNow>0&&paymentMethod==="cash"&&cashDayLocked(date))return json(res,409,{error:"يوم النقدية مقفل. اطلب من المدير إعادة فتح الإقفال قبل تسجيل حركة نقدية بتاريخ سابق."});let item=sku?store.state.inventoryItems.find(i=>String(i.sku||"").trim().toLowerCase()===sku.toLowerCase()):store.state.inventoryItems.find(i=>i.name===name&&String(i.karat)===karat&&Math.abs(Number(i.weight)-weight)<.0001);if(item&&(String(item.karat)!==karat||Math.abs(Number(item.weight)-weight)>.0001))return json(res,409,{error:"رمز الصنف مرتبط بعيار أو وزن مختلف. راجع رمز المخزون."});const at=new Date(date+"T12:00:00").toISOString(),purchaseId=crypto.randomUUID(),movementId=crypto.randomUUID(),lotId=crypto.randomUUID(),itemId=item?.id||crypto.randomUUID();if(!item)item={id:itemId,name,sku,karat,weight,quantity:0,minimum:0,createdAt:at};const nextItems=store.state.inventoryItems.map(i=>i.id===item.id?{...i,quantity:Number(i.quantity||0)+quantity}:i);if(!store.state.inventoryItems.some(i=>i.id===item.id))nextItems.push({...item,quantity});const purchase={id:purchaseId,supplierId:supplier.id,supplierName:supplier.name,invoiceNo,date,itemId:item.id,itemName:name,sku,karat,weight,quantity,unitCost,unitMakingCost,totalCost,paidNow,paymentMethod,notes:String(b.notes||"").trim().slice(0,300),createdAt:new Date().toISOString(),createdBy:{id:manager.id,name:manager.name}};const movement={id:movementId,itemId:item.id,direction:"in",quantity,notes:"شراء من المورد "+supplier.name+(invoiceNo?" · فاتورة "+invoiceNo:""),date:at,createdBy:{id:manager.id,name:manager.name},supplierPurchaseId:purchaseId};const lot={id:lotId,itemId:item.id,receivedAt:at,quantityReceived:quantity,quantityRemaining:quantity,unitCost,unitMakingCost,supplierPurchaseId:purchaseId};const previous={state:store.state,supplierPurchases:store.supplierPurchases,supplierPayments:store.supplierPayments,audit:store.audit,version:store.version};store.state={...store.state,inventoryItems:nextItems,inventoryMovements:[...store.state.inventoryMovements,movement],inventoryLots:[...store.state.inventoryLots,lot]};store.supplierPurchases=[...store.supplierPurchases,purchase];if(paidNow>0)store.supplierPayments=[...store.supplierPayments,{id:crypto.randomUUID(),supplierId:supplier.id,purchaseId,amount:paidNow,date,paymentMethod,note:"دفعة عند الشراء "+(invoiceNo||""),createdAt:new Date().toISOString(),createdBy:{id:manager.id,name:manager.name}}];store.audit=store.audit.slice();log(manager,"تسجيل مشتريات مورد واستلام مخزون",{supplierId:supplier.id,supplierName:supplier.name,purchaseId,itemId:item.id,quantity,totalCost,paidNow});store.version++;try{persist();}catch(error){Object.assign(store,previous);throw error;}alertForStock(nextItems.find(i=>i.id===item.id));return json(res,201,{purchase,balance:supplierBalance(supplier.id),version:store.version});
  }
  if(req.method==="POST"&&url.pathname==="/api/supplier-payments"){
   const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),supplier=store.suppliers.find(s=>s.id===String(b.supplierId||"")),amount=Number(b.amount),date=String(b.date||new Date().toISOString().slice(0,10)),paymentMethod=String(b.paymentMethod||"cash"),note=String(b.note||"").trim().slice(0,300);if(!supplier)return json(res,404,{error:"المورد غير موجود."});if(!Number.isFinite(amount)||amount<=0||!validDateOnly(date)||!["cash","bank","other"].includes(paymentMethod))return json(res,400,{error:"أدخل مبلغًا وطريقة دفع وتاريخًا صالحًا."});if(amount>supplierBalance(supplier.id)+.001)return json(res,409,{error:"المبلغ أكبر من رصيد المورد المستحق."});if(paymentMethod==="cash"&&cashDayLocked(date))return json(res,409,{error:"يوم النقدية مقفل. اطلب من المدير إعادة فتح الإقفال قبل تسجيل حركة نقدية بتاريخ سابق."});const payment={id:crypto.randomUUID(),supplierId:supplier.id,amount:Number(amount.toFixed(2)),date,paymentMethod,note,createdAt:new Date().toISOString(),createdBy:{id:manager.id,name:manager.name}};store.supplierPayments=[...store.supplierPayments,payment];store.audit=store.audit.slice();log(manager,"سداد رصيد مورد",{supplierId:supplier.id,amount,paymentMethod});store.version++;persist();return json(res,201,{payment,balance:supplierBalance(supplier.id),version:store.version});
  }
  if(req.method==="GET"&&url.pathname==="/api/cash-close"){
   const user=requireUser(req,res);if(!user)return;if(!hasPermission(user,"vault:view"))return json(res,403,{error:"لا يملك حسابك صلاحية عرض ملخص النقدية."});const day=url.searchParams.get("date")||new Date().toISOString().slice(0,10);if(!validDateOnly(day))return json(res,400,{error:"التاريخ غير صالح."});const closing=store.cashClosings.slice().reverse().find(c=>c.date===day&&c.status!=="reopened")||null;return json(res,200,{summary:cashSummaryForDate(day),closing,recent:store.cashClosings.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30)});
  }
  if(req.method==="POST"&&url.pathname==="/api/cash-close"){
   const user=requireUser(req,res);if(!user)return;if(!hasPermission(user,"vault:edit"))return json(res,403,{error:"لا يملك حسابك صلاحية تسجيل إقفال النقدية."});const b=await readBody(req),date=String(b.date||""),openingFloat=Number(b.openingFloat||0),actualCash=Number(b.actualCash);if(!validDateOnly(date)||!Number.isFinite(openingFloat)||openingFloat<0||!Number.isFinite(actualCash)||actualCash<0||openingFloat>1000000000||actualCash>1000000000)return json(res,400,{error:"أدخل تاريخًا ومبالغ نقدية صالحة غير سالبة."});const prior=store.cashClosings.slice().reverse().find(c=>c.date===date&&c.status!=="reopened");if(prior)return json(res,409,{error:prior.status==="approved"?"تم اعتماد إقفال هذا اليوم. أعد فتحه من حساب المدير قبل التعديل.":"يوجد إقفال مسجل لهذا اليوم بالفعل."});const summary=cashSummaryForDate(date),systemCash=Number((openingFloat+summary.net).toFixed(2)),closing={id:crypto.randomUUID(),date,openingFloat, cashIn:summary.cashIn,cashOut:summary.cashOut,systemCash,actualCash:Number(actualCash.toFixed(2)),difference:Number((actualCash-systemCash).toFixed(2)),notes:String(b.notes||"").trim().slice(0,500),status:"submitted",submittedAt:new Date().toISOString(),submittedBy:{id:user.id,name:user.name},approvedAt:null,approvedBy:null};store.cashClosings=[...store.cashClosings,closing];store.audit=store.audit.slice();log(user,"تسجيل إقفال نقدية يومي",{date,systemCash,actualCash:closing.actualCash,difference:closing.difference});store.version++;persist();return json(res,201,{closing,summary,version:store.version});
  }
  m=url.pathname.match(/^\/api\/cash-close\/([\w-]+)$/);if(req.method==="PATCH"&&m){const manager=requireUser(req,res,"manager");if(!manager)return;const closing=store.cashClosings.find(c=>c.id===m[1]);if(!closing)return json(res,404,{error:"إقفال النقدية غير موجود."});const b=await readBody(req);if(b.action==="approve"&&closing.status==="submitted"){closing.status="approved";closing.approvedAt=new Date().toISOString();closing.approvedBy={id:manager.id,name:manager.name};log(manager,"اعتماد إقفال نقدية يومي",{date:closing.date,difference:closing.difference});}else if(b.action==="reopen"&&closing.status==="approved"){closing.status="reopened";closing.reopenedAt=new Date().toISOString();closing.reopenedBy={id:manager.id,name:manager.name};log(manager,"إعادة فتح إقفال نقدية يومي",{date:closing.date,difference:closing.difference});}else return json(res,409,{error:"لا يمكن تنفيذ الإجراء على حالة الإقفال الحالية."});store.version++;persist();return json(res,200,{closing,version:store.version});}
  if(req.method==="PUT"&&url.pathname==="/api/state"){
   const u=requireUser(req,res);if(!u)return;const b=await readBody(req),version=Number(b.version);if(version!==store.version)return json(res,409,{error:"حُفظت تغييرات من مستخدم آخر. حدّث الصفحة قبل المتابعة.",version:store.version});
   const activeBranchId=b.branchId||(u.branchId||DEFAULT_BRANCH_ID);
   const activeBranch=store.branches.find(x=>x.id===activeBranchId&&x.active);
   if(!activeBranch)return json(res,400,{error:"الفرع المحدد غير موجود أو غير نشط."});
   if(u.role!=="manager"&&u.branchId!==activeBranchId)return json(res,403,{error:"لا يمكنك تعديل بيانات فرع آخر."});
   const old=store.state,next=cleanState(b.state),oldCustomers=new Map(old.customers.filter(c=>c.branchId===activeBranchId).map(x=>[x.id,x])),oldTx=new Map(old.transactions.filter(t=>t.branchId===activeBranchId).map(x=>[x.id,x])),oldItems=new Map(old.inventoryItems.filter(i=>i.branchId===activeBranchId).map(x=>[x.id,x]));
   // Strip foreign-branch records from next so they can't be tampered with
   const otherCustomers=old.customers.filter(c=>c.branchId!==activeBranchId);
   const otherTx=old.transactions.filter(t=>t.branchId!==activeBranchId);
   const otherItems=old.inventoryItems.filter(i=>i.branchId!==activeBranchId);
   const otherMovements=old.inventoryMovements.filter(m=>m.branchId!==activeBranchId);
   const otherLots=old.inventoryLots.filter(l=>l.branchId!==activeBranchId);
   // Ensure new records inherit the correct branchId
   next.customers=next.customers.map(c=>c.branchId&&c.branchId!==activeBranchId?c:{...c,branchId:activeBranchId});
   next.transactions=next.transactions.map(t=>t.branchId&&t.branchId!==activeBranchId?t:{...t,branchId:activeBranchId});
   next.inventoryItems=next.inventoryItems.map(i=>i.branchId&&i.branchId!==activeBranchId?i:{...i,branchId:activeBranchId});
   next.inventoryMovements=next.inventoryMovements.map(m=>m.branchId&&m.branchId!==activeBranchId?m:{...m,branchId:activeBranchId});
   next.inventoryLots=(next.inventoryLots||[]).map(l=>l.branchId&&l.branchId!==activeBranchId?l:{...l,branchId:activeBranchId});
   if(u.role!=="manager"){const oldLotIds=new Set((old.inventoryLots||[]).map(x=>x.id));next.inventoryLots=[...(old.inventoryLots||[]),...(next.inventoryLots||[]).filter(x=>!oldLotIds.has(x.id))];}
   if(u.role!=="manager"){
    if(JSON.stringify(next.settings)!==JSON.stringify(old.settings))return json(res,403,{error:"إعدادات الفرع والتسعير للمدير فقط."});
    if(!hasPermission(u,"inventory:view")){next.inventoryItems=old.inventoryItems;next.inventoryMovements=old.inventoryMovements;next.inventoryLots=old.inventoryLots;}
    const incomingCustomers=new Map(next.customers.map(x=>[x.id,x]));if(old.customers.some(x=>JSON.stringify(incomingCustomers.get(x.id))!==JSON.stringify(x)))return json(res,403,{error:"لا يمكن للموظف حذف بيانات عميل موجودة أو تعديلها."});
    const incomingTx=new Map(next.transactions.map(x=>[x.id,x]));if(old.transactions.some(x=>!incomingTx.has(x.id)))return json(res,403,{error:"لا يمكن للموظف حذف الحركات."});
    for(const t of old.transactions){const n=incomingTx.get(t.id);if(JSON.stringify(t)!==JSON.stringify(n)&&!(t.status!=="cancelled"&&n.status==="cancelled"))return json(res,403,{error:"لا يمكن تعديل حركة محفوظة إلا بإلغائها."});}
    if(old.customers.length<next.customers.length&&!requirePermission(u,"customers:create",res))return;
    if(old.transactions.length<next.transactions.length&&!requirePermission(u,"transactions:create",res))return;
    if(next.transactions.some(t=>oldTx.has(t.id)&&oldTx.get(t.id).status!=="cancelled"&&t.status==="cancelled")&&!requirePermission(u,"transactions:cancel",res))return;
    const items=new Map(next.inventoryItems.map(x=>[x.id,x]));if(old.inventoryItems.some(x=>JSON.stringify(items.get(x.id))!==JSON.stringify(x))&&!requirePermission(u,"inventory:edit",res))return;
    if(next.inventoryItems.length>old.inventoryItems.length&&!requirePermission(u,"inventory:edit",res))return;
    const movements=new Map(next.inventoryMovements.map(x=>[x.id,x]));if(old.inventoryMovements.some(x=>JSON.stringify(movements.get(x.id))!==JSON.stringify(x)))return json(res,403,{error:"لا يمكن تعديل حركات المخزون السابقة."});
    if(next.inventoryMovements.length>old.inventoryMovements.length&&!requirePermission(u,"inventory:edit",res))return;
   }
   const incomingMovementMap=new Map(next.inventoryMovements.map(x=>[x.id,x]));if(old.inventoryMovements.some(x=>JSON.stringify(incomingMovementMap.get(x.id))!==JSON.stringify(x))||next.inventoryMovements.length<old.inventoryMovements.length)return json(res,403,{error:"حركات المخزون السابقة سجل تدقيق ولا يمكن تعديلها أو حذفها."});
   const oldLots=new Map((old.inventoryLots||[]).map(x=>[x.id,x])),nextLots=new Map((next.inventoryLots||[]).map(x=>[x.id,x]));
   if(u.role!=="manager"&&!hasPermission(u,"inventory:edit"))next.inventoryLots=old.inventoryLots||[];
   if((old.inventoryLots||[]).some(x=>JSON.stringify(nextLots.get(x.id))!==JSON.stringify(x)))return json(res,403,{error:"لا يمكن تعديل دفعات التكلفة السابقة."});
   const addedLots=(next.inventoryLots||[]).filter(x=>!oldLots.has(x.id));
   if(addedLots.length&&u.role!=="manager"&&!requirePermission(u,"inventory:edit",res))return;
   for(const lot of addedLots){if(!next.inventoryItems.some(i=>i.id===lot.itemId)||!Number.isInteger(Number(lot.quantityReceived))||Number(lot.quantityReceived)<=0||!Number.isFinite(Number(lot.quantityRemaining))||Math.abs(Number(lot.quantityRemaining)-Number(lot.quantityReceived))>.000001||(lot.unitCost!=null&&(!Number.isFinite(Number(lot.unitCost))||Number(lot.unitCost)<0))||(lot.unitMakingCost!=null&&(!Number.isFinite(Number(lot.unitMakingCost))||Number(lot.unitMakingCost)<0)))return json(res,400,{error:"بيانات دفعة التكلفة غير صالحة."});}
   const incomingMovements=next.inventoryMovements.filter(x=>!old.inventoryMovements.some(y=>y.id===x.id)),movementDelta=new Map(),matchedLots=new Set();for(const mv of incomingMovements){if(!["in","out"].includes(mv.direction)||!Number.isInteger(Number(mv.quantity))||Number(mv.quantity)<=0)return json(res,400,{error:"حركة المخزون غير صالحة."});movementDelta.set(mv.itemId,(movementDelta.get(mv.itemId)||0)+(mv.direction==="in"?1:-1)*Number(mv.quantity));if(mv.direction==="in"){const lot=addedLots.find(x=>!matchedLots.has(x.id)&&x.itemId===mv.itemId&&Math.abs(Number(x.quantityReceived)-Number(mv.quantity))<.000001);if(lot)matchedLots.add(lot.id);else if(addedLots.some(x=>x.itemId===mv.itemId))return json(res,400,{error:"كمية دفعة التكلفة لا تطابق حركة الاستلام."});}}
   if(addedLots.some(lot=>!matchedLots.has(lot.id)))return json(res,400,{error:"لا يمكن إضافة دفعة تكلفة دون حركة استلام مطابقة."});
   for(const item of next.inventoryItems){const prior=oldItems.get(item.id),expected=(Number(prior?.quantity)||0)+(movementDelta.get(item.id)||0);if(Math.abs(Number(item.quantity)-expected)>.000001)return json(res,400,{error:"يجب أن يطابق رصيد الصنف مجموع حركات الاستلام والصرف."});}
   stateSaveRollback={state:store.state,version:store.version,audit:store.audit,alerts:store.alerts,pieces:store.pieces};store.audit=store.audit.slice();store.alerts=store.alerts.map(x=>({...x}));store.pieces=store.pieces.map(x=>({...x,history:[...(x.history||[])]}));
   if(u.role==="manager"){
    if(old.customers.length>next.customers.length)log(u,"حذف عملاء",{count:old.customers.length-next.customers.length});
    if(old.transactions.length>next.transactions.length)log(u,"حذف حركات",{count:old.transactions.length-next.transactions.length});
    if(old.inventoryItems.length>next.inventoryItems.length)log(u,"حذف أصناف مخزون",{count:old.inventoryItems.length-next.inventoryItems.length});
   }
   if(JSON.stringify(old.settings)!==JSON.stringify(next.settings))log(u,"تحديث إعدادات الفرع والتسعير",{before:old.settings,after:next.settings});
   next.customers=next.customers.map(x=>{if(!oldCustomers.has(x.id)){x={...x,createdBy:{id:u.id,name:u.name}};log(u,"إضافة عميل",{customerId:x.id,name:x.name});}return x;});
   let workingLots=(next.inventoryLots||[]).map(x=>({...x}));
   next.inventoryMovements=next.inventoryMovements.map(m=>{if(!old.inventoryMovements.some(x=>x.id===m.id)){const movement={...m,createdBy:{id:u.id,name:u.name}};if(m.direction==="out"){const consumed=fifoConsume(workingLots,m.itemId,Number(m.quantity));if(consumed.shortfall>0)throw new Error("الكمية المصروفة أكبر من دفعات المخزون المتاحة.");workingLots=consumed.lots;movement.cost=consumed.cost;movement.costComplete=consumed.completeCost;movement.costLayers=consumed.layers;}else if(m.direction==="in"&&!addedLots.some(l=>l.itemId===m.itemId&&Math.abs(Number(l.quantityRemaining)-Number(m.quantity))<.000001)){workingLots.push({id:crypto.randomUUID(),itemId:m.itemId,receivedAt:m.date||new Date().toISOString(),quantityReceived:Number(m.quantity),quantityRemaining:Number(m.quantity),unitCost:null,unitMakingCost:0,legacy:true});}log(u,"حركة مخزون",{itemId:m.itemId,direction:m.direction,quantity:m.quantity,costComplete:movement.costComplete});return movement;}return m;});
   const newTransactions=[],pendingPieceSales=[],pendingPieceReturns=[];
   next.transactions=next.transactions.map(tx=>{
    const prev=oldTx.get(tx.id);
    if(!prev){
     const created={...tx,createdBy:{id:u.id,name:u.name}},lines=Array.isArray(created.items)?created.items.map(line=>({...line})):[],pieceIds=[];if(!["cash","bank","other"].includes(created.paymentMethod||"cash"))throw new Error("طريقة الدفع غير صالحة.");if(["sell","buy","payment","cash-deposit","cash-refund"].includes(created.type)&&cashDayLocked(String(created.date||"").slice(0,10)))throw new Error("يوم النقدية مقفل. اطلب من المدير إعادة فتح الإقفال قبل إضافة حركات بتاريخ هذا اليوم.");
     for(const line of lines){
      const quantity=Number(line.quantity)||1;
      if(line.serialPieceId){
       if(created.type!=="sell"||line.inventoryItemId||quantity!==1)throw new Error("القطعة المسلسلة تُباع منفردة ومن خلال فاتورة بيع.");
       if(!hasPermission(u,"inventory:edit"))throw new Error("لا تملك صلاحية بيع قطعة مسلسلة.");
       const piece=store.pieces.find(x=>x.id===line.serialPieceId);if(!piece||piece.status!=="in-stock")throw new Error("القطعة المسلسلة لم تعد متاحة للبيع.");
       if(pendingPieceSales.some(x=>x.pieceId===piece.id))throw new Error("لا يمكن إضافة القطعة المسلسلة مرتين إلى الفواتير.");
       const known=piece.unitCost!=null&&Number.isFinite(Number(piece.unitCost))&&Number(piece.unitCost)>=0;
       line.inventoryCost={cost:known?Number(piece.unitCost)+(Number(piece.unitMakingCost)||0):0,completeCost:known,knownQuantity:known?1:0,layers:[{pieceId:piece.id,unitCost:known?Number(piece.unitCost):null,unitMakingCost:known?(Number(piece.unitMakingCost)||0):null}]};
       pieceIds.push(piece.id);pendingPieceSales.push({pieceId:piece.id,transactionId:created.id,customerId:created.customerId,number:created.number});
       continue;
      }
      if(!line.inventoryItemId)continue;
      if(!["sell","buy"].includes(created.type))throw new Error("يمكن ربط المخزون بفاتورة بيع أو شراء فقط.");
      if(!hasPermission(u,"inventory:edit"))throw new Error("لا تملك صلاحية تحريك هذا الصنف من المخزون.");
      const item=next.inventoryItems.find(x=>x.id===line.inventoryItemId);if(!item||!Number.isInteger(quantity)||quantity<1)throw new Error("بيانات صنف الفاتورة غير صالحة.");
      const at=created.date||new Date().toISOString();
      if(created.type==="sell"){
       if(Number(item.quantity)<quantity)throw new Error("الكمية المتاحة من صنف الفاتورة غير كافية.");
       const consumed=fifoConsume(workingLots,item.id,quantity);if(consumed.shortfall>0)throw new Error("لا توجد دفعات مخزون كافية لهذا الصنف.");workingLots=consumed.lots;line.inventoryCost={cost:consumed.cost,completeCost:consumed.completeCost,knownQuantity:consumed.knownQuantity,layers:consumed.layers};item.quantity-=quantity;
       next.inventoryMovements.push({id:crypto.randomUUID(),itemId:item.id,direction:"out",quantity,notes:"بيع مرتبط بالحركة "+created.number,transactionId:created.id,date:at,createdBy:{id:u.id,name:u.name},cost:consumed.cost,costComplete:consumed.completeCost,costLayers:consumed.layers});
      }else{
       const lineCost=Number(line.total);if(!Number.isFinite(lineCost)||lineCost<0)throw new Error("قيمة الصنف غير صالحة لتسجيل دفعة الشراء.");const unitCost=Number((lineCost/quantity).toFixed(4)),lotId=crypto.randomUUID();item.quantity+=quantity;workingLots.push({id:lotId,itemId:item.id,receivedAt:at,quantityReceived:quantity,quantityRemaining:quantity,unitCost,unitMakingCost:0,sourceTransactionId:created.id});line.inventoryCost={cost:lineCost,completeCost:true,knownQuantity:quantity,layers:[{lotId,quantity,unitCost,unitMakingCost:0}]};next.inventoryMovements.push({id:crypto.randomUUID(),itemId:item.id,direction:"in",quantity,notes:"شراء مرتبط بالحركة "+created.number,transactionId:created.id,date:at,createdBy:{id:u.id,name:u.name},unitCost});
      }
     }
     created.items=lines;if(pieceIds.length)created.pieceIds=pieceIds;newTransactions.push(created);log(u,"تسجيل حركة",{transactionId:tx.id,number:tx.number,type:tx.type,customerId:tx.customerId,linkedStockItems:lines.filter(x=>x.inventoryItemId).length,linkedPieces:pieceIds.length});return created;
    }
    if(prev.status!=="cancelled"&&tx.status==="cancelled"){
     if((prev.items||[]).some(x=>x.inventoryItemId||x.serialPieceId)&&!hasPermission(u,"inventory:edit"))throw new Error("تحتاج صلاحية المخزون لإلغاء فاتورة مرتبطة بالمخزون.");
     const at=new Date().toISOString();
     for(const line of prev.items||[]){const quantity=Number(line.quantity)||1;if(line.inventoryItemId){const item=next.inventoryItems.find(x=>x.id===line.inventoryItemId);if(!item)throw new Error("الصنف المرتبط بالفاتورة غير موجود.");if(prev.type==="sell"){item.quantity+=quantity;for(const layer of line.inventoryCost?.layers||[]){const lot=workingLots.find(x=>x.id===layer.lotId);if(lot)lot.quantityRemaining=Number((Number(lot.quantityRemaining)+Number(layer.quantity||quantity)).toFixed(6));}next.inventoryMovements.push({id:crypto.randomUUID(),itemId:item.id,direction:"in",quantity,notes:"عكس بيع ملغى "+prev.number,transactionId:prev.id,date:at,createdBy:{id:u.id,name:u.name}});}else if(prev.type==="buy"){const layer=(line.inventoryCost?.layers||[])[0],lot=workingLots.find(x=>x.id===layer?.lotId);if(!lot||Number(lot.quantityRemaining)<quantity)throw new Error("لا يمكن إلغاء الشراء؛ جزء من دفعة الشراء صُرف بالفعل.");lot.quantityRemaining=0;item.quantity-=quantity;next.inventoryMovements.push({id:crypto.randomUUID(),itemId:item.id,direction:"out",quantity,notes:"عكس شراء ملغى "+prev.number,transactionId:prev.id,date:at,createdBy:{id:u.id,name:u.name}});}}
      if(line.serialPieceId)pendingPieceReturns.push({pieceId:line.serialPieceId,transactionId:prev.id,number:prev.number,reason:tx.cancelReason||"إلغاء الفاتورة"});}
     log(u,"إلغاء حركة",{transactionId:tx.id,number:tx.number,reason:tx.cancelReason||""});const windowMs=Math.max(1,Number(next.settings.anomalyCancelMinutes)||30)*60000,recent=store.audit.filter(a=>a.userId===u.id&&a.action==="إلغاء حركة"&&Date.now()-Date.parse(a.date)<=windowMs).length;if(recent>=Math.max(2,Number(next.settings.anomalyCancelCount)||3))createAlert("repeat-cancel","إلغاءات متكررة",u.name+" ألغى "+recent+" حركات خلال فترة قصيرة.",{userId:u.id,count:recent},"manager","cancel:"+u.id+":"+Math.floor(Date.now()/windowMs));
     return{...prev,status:"cancelled",cancelReason:String(tx.cancelReason||""),cancelledAt:String(tx.cancelledAt||at),createdBy:prev.createdBy||null,cancelledBy:{id:u.id,name:u.name}};
    }
    return{...tx,createdBy:prev.createdBy||tx.createdBy||null,cancelledBy:prev.cancelledBy||tx.cancelledBy||null};
   });
   for(const sale of pendingPieceSales){const piece=store.pieces.find(x=>x.id===sale.pieceId),customer=next.customers.find(x=>x.id===sale.customerId);piece.status="sold";piece.soldAt=new Date().toISOString();piece.soldTo=customer?.name||"";piece.soldToCustomerId=sale.customerId||"";piece.transactionId=sale.transactionId;piece.history.push({type:"sold",at:piece.soldAt,by:{id:u.id,name:u.name},customerName:piece.soldTo,transactionId:sale.transactionId,number:sale.number});log(u,"بيع قطعة مسلسلة",{pieceId:piece.id,serial:piece.serial,transactionId:sale.transactionId});}
   for(const sale of pendingPieceReturns){const piece=store.pieces.find(x=>x.id===sale.pieceId);if(piece&&piece.status==="sold"){piece.status="return-pending";piece.history.push({type:"return-requested",at:new Date().toISOString(),by:{id:u.id,name:u.name},transactionId:sale.transactionId,reason:sale.reason});createAlert("piece-return","اعتماد إرجاع قطعة مسلسلة","أُلغيت فاتورة مرتبطة بالقطعة "+piece.serial+"؛ اعتمد الإرجاع قبل إتاحتها.",{pieceId:piece.id,transactionId:sale.transactionId},"manager","piece-return:"+piece.id+":"+sale.transactionId);}}
   next.inventoryLots=workingLots;
   next.inventoryItems=next.inventoryItems.map(item=>{if(!oldItems.has(item.id)){log(u,"إضافة صنف للمخزون",{itemId:item.id,name:item.name,branchId:activeBranchId});return{...item,createdBy:{id:u.id,name:u.name}};}return item;});
   // Re-merge other branches' records back in
   next.customers=[...otherCustomers,...next.customers];
   next.transactions=[...otherTx,...next.transactions];
   next.inventoryItems=[...otherItems,...next.inventoryItems];
   next.inventoryMovements=[...otherMovements,...next.inventoryMovements];
   next.inventoryLots=[...otherLots,...next.inventoryLots];
   for(const tx of newTransactions){if(tx.type==="reversal")continue;const localDate=new Date(tx.date||Date.now()),time=String(localDate.getHours()).padStart(2,"0")+":"+String(localDate.getMinutes()).padStart(2,"0"),settings=next.settings;if(time<settings.workStart||time>settings.workEnd)createAlert("after-hours","حركة خارج ساعات العمل","سُجّلت حركة "+tx.number+" خارج ساعات العمل المحددة.",{transactionId:tx.id,number:tx.number,time,employee:u.name},"manager","after-hours:"+tx.id);const lineValue=(tx.items||[]).reduce((s,x)=>s+(Number(x.total)||0),0);const derivedDiscount=lineValue>Number(tx.amount||0)?(lineValue-Number(tx.amount||0))*100/lineValue:0;const discount=Math.max(Number(tx.discountPercent)||0,derivedDiscount);if(discount>Number(settings.anomalyDiscountPercent??15))createAlert("large-discount","خصم مرتفع","خصم "+discount.toFixed(2)+"% على الحركة "+tx.number+".",{transactionId:tx.id,percent:Number(discount.toFixed(2)),employee:u.name},"manager","discount:"+tx.id);}
   for(const item of next.inventoryItems){const before=oldItems.get(item.id);if(!before||Number(before.quantity)!==Number(item.quantity))alertForStock(item);}
   store.state=next;store.version++;persist();stateSaveRollback=null;const committed={inventoryItems:next.inventoryItems,inventoryMovements:next.inventoryMovements};if(u.role==="manager")committed.inventoryLots=next.inventoryLots;return json(res,200,{version:store.version,state:committed});
  }
  if(req.method==="GET"&&url.pathname==="/api/advanced"){
   const u=requireUser(req,res);if(!u)return;const alertCount=store.alerts.length;runOperationalAlerts();if(store.alerts.length!==alertCount)persist();const from=url.searchParams.get("from"),to=url.searchParams.get("to"),prices=store.goldPriceHistory.filter(x=>(!from||x.at.slice(0,10)>=from)&&(!to||x.at.slice(0,10)<=to));
   const canSeeInventory=hasPermission(u,"inventory:view"),manager=u.role==="manager";
   const branchId=resolveUserBranch(u,url);
   const bf=branchFilter(branchId);
   const branchItems=store.state.inventoryItems.filter(bf),branchMovements=store.state.inventoryMovements.filter(bf),branchTx=store.state.transactions.filter(bf);
   const transactionById=new Map(branchTx.map(t=>[t.id,t]));
   const reorder=canSeeInventory?branchItems.map(item=>({...item,...reorderSuggestion({quantity:item.quantity,minimum:item.minimum,movements:branchMovements.filter(m=>m.itemId===item.id&&m.transactionId&&transactionById.get(m.transactionId)?.type==="sell"&&transactionById.get(m.transactionId)?.status!=="cancelled"),periodDays:store.state.settings.reorderPeriodDays,leadDays:store.state.settings.reorderLeadDays,safetyDays:store.state.settings.reorderSafetyDays})})):[];
   const alerts=store.alerts.filter(a=>a.audience==="all"||manager).slice(-500).reverse();
   const pieceBranchId=branchId==="all"?null:branchId;
   const allPieces=pieceBranchId?store.pieces.filter(p=>p.branchId===pieceBranchId||!p.branchId):store.pieces;
   const pieces=canSeeInventory?(manager?allPieces:allPieces.map(({unitCost,unitMakingCost,...piece})=>piece)):[];
   return json(res,200,{goldPriceHistory:prices.slice(-3000),alerts,pieces,manufacturingOrders:manager?store.manufacturingOrders:[],pledges:manager?store.pledges:[],reorder,backupStatus:manager?store.backupStatus:null,settings:manager?store.state.settings:null,user:userView(u),branchId,branches:manager?store.branches:store.branches.filter(b=>b.active)});
  }
  if(req.method==="GET"&&url.pathname==="/api/profit-report"){
   const manager=requireUser(req,res,"manager");if(!manager)return;
   const branchId=resolveUserBranch(manager,url);
   const bf=branchFilter(branchId);
   const from=url.searchParams.get("from"),to=url.searchParams.get("to"),sales=store.state.transactions.filter(t=>bf(t)&&t.type==="sell"&&t.status!=="cancelled"&&(!from||t.date.slice(0,10)>=from)&&(!to||t.date.slice(0,10)<=to));
   const rows=sales.map(t=>({id:t.id,number:t.number,date:t.date,employee:t.createdBy?.name||"غير معروف",customer:store.state.customers.find(c=>c.id===t.customerId)?.name||"عميل غير معروف",branchId:t.branchId,...transactionProfit(t)}));return json(res,200,{rows,eligibleProfit:Number(rows.filter(x=>x.eligible).reduce((s,x)=>s+x.profit,0).toFixed(2)),eligibleCount:rows.filter(x=>x.eligible).length,unverifiedCount:rows.filter(x=>!x.eligible).length,branchId});
  }
  if(req.method==="PUT"&&url.pathname==="/api/advanced-settings"){
   const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),current=store.state.settings,keys={idleTimeoutMinutes:[5,720],goldAlertThresholdPercent:[.1,100],goldAlertWindowMinutes:[1,1440],reorderPeriodDays:[1,365],reorderLeadDays:[0,365],reorderSafetyDays:[0,365],pledgeReminderDays:[0,365],pledgeFeePercent:[0,100],anomalyCancelCount:[2,100],anomalyCancelMinutes:[1,1440],anomalyDiscountPercent:[0,100]};for(const[key,[min,max]]of Object.entries(keys)){if(b[key]!==undefined){const n=Number(b[key]);if(!Number.isFinite(n)||n<min||n>max)return json(res,400,{error:`قيمة الإعداد ${key} خارج النطاق المسموح.`});current[key]=n;}}for(const key of ["workStart","workEnd"]){if(b[key]!==undefined){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b[key])))return json(res,400,{error:"أدخل وقتًا صالحًا بصيغة ساعة:دقيقة."});current[key]=String(b[key]);}}store.version++;log(manager,"تحديث إعدادات التنبيهات والأمان والتحليلات",b);persist();return json(res,200,{settings:current,version:store.version});
  }
  m=url.pathname.match(/^\/api\/reorder-suggestions\/([\w-]+)$/);if(req.method==="PUT"&&m){const u=requireUser(req,res);if(!u)return;if(!requirePermission(u,"inventory:edit",res))return;const b=await readBody(req),item=store.state.inventoryItems.find(x=>x.id===m[1]),quantity=Number(b.quantity);if(!item)return json(res,404,{error:"صنف المخزون غير موجود."});if(!Number.isInteger(quantity)||quantity<0||quantity>1000000)return json(res,400,{error:"كمية الطلب المقترحة غير صالحة."});item.suggestedOrderQuantity=quantity;item.suggestedOrderUpdatedAt=new Date().toISOString();item.suggestedOrderUpdatedBy=u.name;log(u,"تعديل كمية إعادة الطلب المقترحة",{itemId:item.id,quantity});store.version++;persist();return json(res,200,{ok:true,quantity,version:store.version});}
  m=url.pathname.match(/^\/api\/alerts\/([\w-]+)\/review$/);if(req.method==="PATCH"&&m){const manager=requireUser(req,res,"manager");if(!manager)return;const alert=store.alerts.find(x=>x.id===m[1]);if(!alert)return json(res,404,{error:"التنبيه غير موجود."});alert.reviewedAt=new Date().toISOString();alert.reviewedBy={id:manager.id,name:manager.name};log(manager,"مراجعة تنبيه",{alertId:alert.id,type:alert.type});persist();return json(res,200,{ok:true});}
  if(req.method==="POST"&&url.pathname==="/api/pieces"){
   const u=requireUser(req,res);if(!u)return;if(!requirePermission(u,"inventory:edit",res))return;const b=await readBody(req),name=String(b.name||"").trim(),weight=Number(b.weight),karat=String(b.karat||""),unitCost=b.unitCost==null||String(b.unitCost)===""?null:Number(b.unitCost),unitMakingCost=Number(b.unitMakingCost)||0;if(name.length<2||!Number.isFinite(weight)||weight<=0||!/^(24|22|21|18|14|9)$/.test(karat)||(unitCost!==null&&(!Number.isFinite(unitCost)||unitCost<0))||unitMakingCost<0)return json(res,400,{error:"أدخل اسمًا ووزنًا وعيارًا وتكلفة صالحة للقطعة."});let image=String(b.image||"");if(image&&!validImageData(image,300*1024))return json(res,400,{error:"صورة القطعة غير صالحة أو أكبر من 300 كيلوبايت."});const date=new Date(),day=date.toISOString().slice(0,10);let serial;do{serial=`AZ-${day.replace(/-/g,"")}-${String(store.pieces.filter(x=>x.serial?.startsWith(`AZ-${day.replace(/-/g,"")}-`)).length+1).padStart(4,"0")}`;}while(store.pieces.some(x=>x.serial===serial));const piece={id:crypto.randomUUID(),serial,name,weight,karat,unitCost,unitMakingCost,description:String(b.description||"").slice(0,500),source:String(b.source||"").slice(0,160),image,status:"in-stock",createdAt:date.toISOString(),createdBy:{id:u.id,name:u.name},history:[{type:"received",at:date.toISOString(),by:{id:u.id,name:u.name},source:String(b.source||"")} ]};store.pieces.push(piece);log(u,"تسجيل قطعة برقم تسلسلي",{pieceId:piece.id,serial,name,weight,karat});persist();return json(res,201,{piece});
  }
  m=url.pathname.match(/^\/api\/pieces\/([\w-]+)$/);if(req.method==="PATCH"&&m){const u=requireUser(req,res);if(!u)return;if(!requirePermission(u,"inventory:edit",res))return;const b=await readBody(req),piece=store.pieces.find(x=>x.id===m[1]);if(!piece)return json(res,404,{error:"القطعة غير موجودة."});const at=new Date().toISOString();if(b.action==="sell"){return json(res,409,{error:"سجّل البيع من الفاتورة واربط القطعة بها حتى لا يتكرر تسجيلها."});}
   else if(b.action==="return-request"){if(piece.status!=="sold")return json(res,409,{error:"لا يمكن طلب إرجاع قطعة لم تُبع."});piece.status="return-pending";piece.history.push({type:"return-requested",at,by:{id:u.id,name:u.name},reason:String(b.reason||"").slice(0,240)});log(u,"طلب إرجاع قطعة مسلسلة",{pieceId:piece.id,serial:piece.serial});}
   else if(b.action==="return-approve"){if(u.role!=="manager")return json(res,403,{error:"اعتماد الإرجاع للمدير فقط."});if(piece.status!=="return-pending")return json(res,409,{error:"لا يوجد طلب إرجاع معلق لهذه القطعة."});const replacementSerial=String(b.replacementSerial||"").trim(),replacement=replacementSerial?store.pieces.find(x=>x.serial===replacementSerial):null;if(replacementSerial&&(!replacement||replacement.id===piece.id||replacement.status!=="sold"||(piece.soldToCustomerId&&replacement.soldToCustomerId&&piece.soldToCustomerId!==replacement.soldToCustomerId)))return json(res,409,{error:"يجب أن تكون القطعة البديلة مباعة للعميل نفسه قبل اعتماد الاستبدال."});piece.status="in-stock";piece.returnedAt=at;piece.exchangedForPieceId=replacement?.id||null;piece.history.push({type:replacement?"exchange-return-approved":"return-approved",at,by:{id:u.id,name:u.name},replacementPieceId:replacement?.id||null,replacementSerial:replacement?.serial||"",reason:String(b.reason||"").slice(0,240)});if(replacement)replacement.history.push({type:"exchange-linked",at,by:{id:u.id,name:u.name},returnedPieceId:piece.id,returnedSerial:piece.serial});log(u,replacement?"اعتماد استبدال قطعة مسلسلة":"اعتماد إرجاع قطعة مسلسلة",{pieceId:piece.id,serial:piece.serial,replacementPieceId:replacement?.id||null});for(const alert of store.alerts)if(alert.details?.pieceId===piece.id&&alert.type==="piece-return"&&!alert.resolvedAt)alert.resolvedAt=at;}
   else return json(res,400,{error:"إجراء القطعة غير معروف."});persist();return json(res,200,{piece});}
  if(req.method==="POST"&&url.pathname==="/api/manufacturing-orders"){
   const u=requireUser(req,res,"manager");if(!u)return;
   const b=await readBody(req),customerId=String(b.customerId||""),customer=customerId?store.state.customers.find(c=>c.id===customerId):null;
   const customerName=String(customer?.name||b.customerName||"").trim(),specification=String(b.specification||"").trim(),total=Number(b.totalPrice),deposit=Number(b.deposit)||0,weight=Number(b.weight)||0,workshopMakingCost=Number(b.workshopMakingCost)||0;
   const workshopDueDate=String(b.workshopDueDate||""),dueDate=String(b.dueDate||""),karat=String(b.karat||"");
   if(customerId&&!customer)return json(res,400,{error:"العميل المحدد غير موجود."});
   if(customerName.length<2||specification.length<3||!Number.isFinite(total)||total<=0||!Number.isFinite(deposit)||deposit<0||deposit>total||!Number.isFinite(weight)||weight<0||!Number.isFinite(workshopMakingCost)||workshopMakingCost<0||(karat&&!/^(24|22|21|18|14|9)$/.test(karat))||(workshopDueDate&&!validDateOnly(workshopDueDate))||(dueDate&&!validDateOnly(dueDate)))return json(res,400,{error:"راجع اسم العميل والمواصفات والعيار والوزن والسعر والعربون ومواعيد التسليم."});
   const at=new Date().toISOString(),order={id:crypto.randomUUID(),number:`MFG-${String(store.manufacturingOrders.length+1).padStart(6,"0")}`,customerId,customerName,specification,karat,weight,totalPrice:total,deposit,remaining:Number((total-deposit).toFixed(2)),workshop:String(b.workshop||"").trim().slice(0,120),workshopMakingCost,workshopDueDate,dueDate,status:"materials-received",createdAt:at,updatedAt:at,createdBy:{id:u.id,name:u.name},history:[{status:"materials-received",at,by:{id:u.id,name:u.name}}]};
   store.manufacturingOrders.push(order);log(u,"إنشاء طلب تصنيع",{orderId:order.id,number:order.number,customerName});persist();return json(res,201,{order});
  }
  m=url.pathname.match(/^\/api\/manufacturing-orders\/([\w-]+)$/);if(req.method==="PATCH"&&m){const u=requireUser(req,res,"manager");if(!u)return;const b=await readBody(req),order=store.manufacturingOrders.find(x=>x.id===m[1]);if(!order)return json(res,404,{error:"طلب التصنيع غير موجود."});const allowed={"materials-received":"in-progress","in-progress":"ready","ready":"delivered"};if(allowed[order.status]!==b.status)return json(res,409,{error:"انتقل الطلب إلى المرحلة التالية بالترتيب."});order.status=b.status;order.updatedAt=new Date().toISOString();order.history.push({status:order.status,at:order.updatedAt,by:{id:u.id,name:u.name},notes:String(b.notes||"").slice(0,240)});log(u,"تحديث حالة طلب تصنيع",{orderId:order.id,number:order.number,status:order.status});persist();return json(res,200,{order});}
  if(req.method==="POST"&&url.pathname==="/api/pledges"){
   const u=requireUser(req,res,"manager");if(!u)return;
   const b=await readBody(req),customerId=String(b.customerId||""),customer=customerId?store.state.customers.find(c=>c.id===customerId):null,customerName=String(customer?.name||b.customerName||"").trim(),amount=Number(b.amount),weight=Number(b.weight),karat=String(b.karat||"21"),dateText=String(b.date||new Date().toISOString().slice(0,10)),dueText=String(b.dueDate||""),feePercent=Number(store.state.settings.pledgeFeePercent)||0;
   if(customerId&&!customer)return json(res,400,{error:"العميل المحدد غير موجود."});
   if(customerName.length<2||!Number.isFinite(amount)||amount<=0||!Number.isFinite(weight)||weight<=0||!/^(24|22|21|18|14|9)$/.test(karat)||!validDateOnly(dateText)||!validDateOnly(dueText)||dueText<=dateText)return json(res,400,{error:"أدخل بيانات الرهن والعيار وتواريخ صحيحة، مع موعد استرداد بعد تاريخ الرهن."});
   const at=new Date().toISOString(),date=new Date(dateText+"T00:00:00.000Z"),due=new Date(dueText+"T00:00:00.000Z"),pledge={id:crypto.randomUUID(),number:`PL-${String(store.pledges.length+1).padStart(6,"0")}`,customerId,customerName,amount,weight,karat,date:date.toISOString(),dueDate:due.toISOString(),feePercent,feeAmount:Number((amount*feePercent/100).toFixed(2)),status:"active",notes:String(b.notes||"").slice(0,500),createdAt:at,createdBy:{id:u.id,name:u.name},history:[{type:"pledged",at,by:{id:u.id,name:u.name}}]};pledge.totalDue=Number((pledge.amount+pledge.feeAmount).toFixed(2));store.pledges.push(pledge);log(u,"تسجيل رهن أو ضمان",{pledgeId:pledge.id,number:pledge.number,customerName,weight,amount});persist();return json(res,201,{pledge});
  }
  m=url.pathname.match(/^\/api\/pledges\/([\w-]+)$/);if(req.method==="PATCH"&&m){const u=requireUser(req,res,"manager");if(!u)return;const b=await readBody(req),pledge=store.pledges.find(x=>x.id===m[1]);if(!pledge)return json(res,404,{error:"سجل الرهن غير موجود."});if(pledge.status!=="active"||!(["redeem","close"].includes(b.action)))return json(res,409,{error:"لا يمكن إغلاق هذا الرهن بالحالة الحالية."});pledge.status=b.action==="redeem"?"redeemed":"closed";pledge.closedAt=new Date().toISOString();pledge.history.push({type:pledge.status,at:pledge.closedAt,by:{id:u.id,name:u.name},notes:String(b.notes||"").slice(0,240)});for(const alert of store.alerts)if(alert.details?.pledgeId===pledge.id&&!alert.resolvedAt)alert.resolvedAt=pledge.closedAt;log(u,b.action==="redeem"?"استرداد رهن":"إغلاق رهن",{pledgeId:pledge.id,number:pledge.number});persist();return json(res,200,{pledge});}
  if(req.method==="GET"&&url.pathname==="/api/staff-roster"){
   const u=requireUser(req,res);if(!u)return;
   const employees=store.users.filter(target=>target.role==="employee"&&target.active).map(target=>({id:target.id,name:target.name}));
   return json(res,200,{employees});
  }
  if(req.method==="GET"&&url.pathname==="/api/print-brand"){
   const u=requireUser(req,res);if(!u)return;
   const s=store.state.settings||{};return json(res,200,{branchName:s.branchName||"الفرع الرئيسي",brand:cleanPrintBrand(s.printBrand)});
  }
  // ── Branches API ──────────────────────────────────────────────────────────
  if(req.method==="GET"&&url.pathname==="/api/branches"){
    const u=requireUser(req,res);if(!u)return;
    const visible=u.role==="manager"?store.branches:store.branches.filter(b=>b.active);
    return json(res,200,{branches:visible});
  }
  if(req.method==="POST"&&url.pathname==="/api/branches"){
    const manager=requireUser(req,res,"manager");if(!manager)return;
    const b=await readBody(req),name=String(b.name||"").trim(),address=String(b.address||"").trim(),phone=String(b.phone||"").trim();
    if(name.length<2||name.length>100)return json(res,400,{error:"أدخل اسم فرع بين 2 و 100 حرف."});
    if(store.branches.some(x=>x.name===name))return json(res,409,{error:"يوجد فرع بهذا الاسم بالفعل."});
    const branch={id:crypto.randomUUID(),name,address,phone,active:true,createdAt:new Date().toISOString(),createdBy:{id:manager.id,name:manager.name}};
    store.branches.push(branch);log(manager,"إضافة فرع",{branchId:branch.id,name});store.version++;persist();
    return json(res,201,{branch});
  }
  m=url.pathname.match(/^\/api\/branches\/([\w-]+)$/);if(req.method==="PATCH"&&m){
    const manager=requireUser(req,res,"manager");if(!manager)return;
    const branch=store.branches.find(x=>x.id===m[1]);if(!branch)return json(res,404,{error:"الفرع غير موجود."});
    if(branch.id===DEFAULT_BRANCH_ID&&b?.active===false)return json(res,400,{error:"لا يمكن تعطيل الفرع الرئيسي."});
    const b=await readBody(req);
    if(b.name!==undefined){const n=String(b.name).trim();if(n.length<2||n.length>100)return json(res,400,{error:"اسم الفرع غير صالح."});if(store.branches.some(x=>x.id!==branch.id&&x.name===n))return json(res,409,{error:"اسم الفرع مستخدم بالفعل."});branch.name=n;}
    if(b.address!==undefined)branch.address=String(b.address).trim().slice(0,300);
    if(b.phone!==undefined)branch.phone=String(b.phone).trim().slice(0,40);
    if(b.active!==undefined)branch.active=!!b.active;
    log(manager,"تعديل فرع",{branchId:branch.id,name:branch.name});store.version++;persist();
    return json(res,200,{branch});
  }
  // Assign user to branch
  m=url.pathname.match(/^\/api\/users\/([\w-]+)\/branch$/);if(req.method==="PUT"&&m){
    const manager=requireUser(req,res,"manager");if(!manager)return;
    const b=await readBody(req),target=store.users.find(u=>u.id===m[1]);
    if(!target)return json(res,404,{error:"المستخدم غير موجود."});
    const branch=store.branches.find(x=>x.id===b.branchId&&x.active);
    if(!branch)return json(res,404,{error:"الفرع المحدد غير موجود أو غير نشط."});
    target.branchId=branch.id;log(manager,"تغيير فرع موظف",{userId:target.id,branchId:branch.id,branchName:branch.name});persist();
    return json(res,200,{ok:true,branchId:branch.id});
  }
  // ── End Branches API ──────────────────────────────────────────────────────
  if(req.method==="GET"&&url.pathname==="/api/users"){const u=requireUser(req,res,"manager");if(!u)return;return json(res,200,{users:store.users.map(userView)});}
  if(req.method==="POST"&&url.pathname==="/api/users"){
   const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),username=String(b.username||"").trim();if(!/^[\p{L}\p{N}_.-]{3,40}$/u.test(username)||String(b.name||"").trim().length<2||String(b.password||"").length<10)return json(res,400,{error:"أدخل اسم مستخدم صالحًا، واسمًا لا يقل عن حرفين، وكلمة مرور من 10 أحرف على الأقل."});
   if(store.users.some(u=>u.username===username))return json(res,409,{error:"اسم المستخدم مستخدم بالفعل."});
   const newBranchId=String(b.branchId||DEFAULT_BRANCH_ID);
   const targetBranch=store.branches.find(x=>x.id===newBranchId&&x.active);
   if(!targetBranch)return json(res,400,{error:"الفرع المحدد غير موجود أو غير نشط."});
   const u=newUser(String(b.name).trim(),username,String(b.password),"employee",newBranchId);store.users.push(u);log(manager,"إنشاء حساب موظف",{userId:u.id,username:u.username,branchId:newBranchId});persist();return json(res,201,{user:userView(u)});
  }
  m=url.pathname.match(/^\/api\/users\/([\w-]+)\/active$/);if(req.method==="PATCH"&&m){const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),target=store.users.find(u=>u.id===m[1]);if(!target||target.role!=="employee")return json(res,404,{error:"الموظف غير موجود."});target.active=!!b.active;if(!target.active)for(const[token,session]of sessions)if(session.userId===target.id)sessions.delete(token);log(manager,target.active?"تفعيل حساب موظف":"تعطيل حساب موظف",{userId:target.id,username:target.username});persist();return json(res,200,{ok:true});}
  m=url.pathname.match(/^\/api\/users\/([\w-]+)\/password$/);if(req.method==="PUT"&&m){const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),target=store.users.find(u=>u.id===m[1]);if(!target||target.role!=="employee")return json(res,404,{error:"الموظف غير موجود."});if(String(b.password||"").length<10)return json(res,400,{error:"كلمة المرور يجب أن تكون 10 أحرف على الأقل."});const p=passwordHash(String(b.password));target.salt=p.salt;target.passwordHash=p.hash;target.mustChangePassword=true;for(const[token,session]of sessions)if(session.userId===target.id)sessions.delete(token);log(manager,"إعادة تعيين كلمة مرور موظف",{userId:target.id,username:target.username});persist();return json(res,200,{ok:true});}
  if(req.method==="PUT"&&url.pathname==="/api/permissions"){const manager=requireUser(req,res,"manager");if(!manager)return;const b=await readBody(req),target=store.users.find(u=>u.id===b.userId&&u.role==="employee"),allowed=new Set(["customers:create","transactions:create","transactions:cancel","inventory:view","inventory:edit","reports:view","backup:export","vault:view","vault:edit"]);if(!target)return json(res,404,{error:"الموظف غير موجود."});if(!Array.isArray(b.permissions)||b.permissions.some(p=>!allowed.has(p)))return json(res,400,{error:"قائمة الصلاحيات غير صالحة."});let expiresAt=null;if(b.expiresAt){expiresAt=new Date(b.expiresAt).toISOString();if(Date.parse(expiresAt)<=Date.now())return json(res,400,{error:"يجب أن يكون انتهاء الصلاحية في المستقبل."});}target.permissions=[...new Set(b.permissions)];target.permissionsExpiresAt=expiresAt;log(manager,"تعديل صلاحيات موظف",{userId:target.id,permissions:target.permissions,expiresAt});persist();return json(res,200,{ok:true});}
  if(req.method==="GET"&&url.pathname==="/api/audit"){const manager=requireUser(req,res,"manager");if(!manager)return;return json(res,200,{entries:store.audit.slice(-1000).reverse()});}
  if(req.method==="GET"&&url.pathname==="/api/backups"){const manager=requireUser(req,res,"manager");if(!manager)return;const files=fs.readdirSync(backupDir).filter(x=>/^backup-[\dTZ-]+\.json$/.test(x)).map(name=>({name,modifiedAt:fs.statSync(path.join(backupDir,name)).mtime.toISOString(),size:fs.statSync(path.join(backupDir,name)).size})).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));return json(res,200,{files});}
  if(req.method==="POST"&&url.pathname==="/api/backups"){const manager=requireUser(req,res,"manager");if(!manager)return;const name=makeBackup("يدوي");log(manager,"إنشاء نسخة احتياطية",{name});persist();return json(res,201,{name});}
  m=url.pathname.match(/^\/api\/backups\/(backup-[\dTZ-]+\.json)\/restore$/);if(req.method==="POST"&&m){const manager=requireUser(req,res,"manager");if(!manager)return;const backup=JSON.parse(fs.readFileSync(path.join(backupDir,m[1]),"utf8"));if(!backup.state||!Array.isArray(backup.state.customers)||!Array.isArray(backup.state.transactions))return json(res,400,{error:"ملف النسخة الاحتياطية غير صالح."});store.state={...emptyState(),...backup.state};store.state.inventoryLots||=[];for(const item of store.state.inventoryItems){if(Number(item.quantity)>0&&!store.state.inventoryLots.some(l=>l.itemId===item.id))store.state.inventoryLots.push({id:`legacy-${item.id}`,itemId:item.id,receivedAt:item.createdAt||new Date().toISOString(),quantityReceived:Number(item.quantity),quantityRemaining:Number(item.quantity),unitCost:null,unitMakingCost:null,legacy:true});}if(Object.prototype.hasOwnProperty.call(backup,"vault"))store.vault=backup.vault&&typeof backup.vault==="object"?backup.vault:{};if(backup.goldPrices&&typeof backup.goldPrices==="object")store.goldPrices=backup.goldPrices;for(const key of ["goldPriceHistory","alerts","pieces","manufacturingOrders","pledges","suppliers","supplierPurchases","supplierPayments","cashClosings","backupStatus"])if(backup[key]!==undefined)store[key]=backup[key];store.suppliers=Array.isArray(backup.suppliers)?backup.suppliers:[];store.supplierPurchases=Array.isArray(backup.supplierPurchases)?backup.supplierPurchases:[];store.supplierPayments=Array.isArray(backup.supplierPayments)?backup.supplierPayments:[];store.cashClosings=Array.isArray(backup.cashClosings)?backup.cashClosings:[];store.version++;store.vaultVersion++;log(manager,"استعادة نسخة احتياطية",{name:m[1]});persist();return json(res,200,{ok:true,version:store.version});}
  if(req.method==="GET"&&url.pathname.startsWith("/api/")===false){const requested=decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname),relative=requested.replace(/^\/+/,""),file=path.resolve(root,"."+requested);if(!publicFiles.has(relative)||!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:"الصفحة غير موجودة."});res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-cache"});return fs.createReadStream(file).pipe(res);}
  return json(res,404,{error:"المسار غير موجود."});
 }catch(e){if(stateSaveRollback){Object.assign(store,stateSaveRollback);stateSaveRollback=null;}console.error(e);return json(res,400,{error:e.message||"تعذر إكمال الطلب."});}
});
const port=Number(process.env.PORT)||3000;server.listen(port,"0.0.0.0",()=>console.log(`Gold Customer Accounts listening on port ${port}`));
