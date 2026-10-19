#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const slug = String(process.argv[2] || "").trim();
if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) {
  console.error("الاستخدام: node scripts/create-shop.js <shop-slug> [base-directory] [port]");
  console.error("مثال: node scripts/create-shop.js al-nour ~/GoldShopInstances 3101");
  process.exit(2);
}

const baseArg = process.argv[3] || path.join(os.homedir(), "GoldShopInstances");
const baseDir = path.resolve(baseArg.replace(/^~(?=$|[\\/])/, os.homedir()));
const shopDir = path.join(baseDir, slug);
const portArg = process.argv[4];
const existingShops = fs.existsSync(baseDir) ? fs.readdirSync(baseDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).length : 0;
const port = portArg ? Number(portArg) : 3100 + existingShops;
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("أدخل رقم منفذ بين 1024 و65535.");
  process.exit(2);
}
if (fs.existsSync(shopDir)) {
  console.error(`المجلد موجود بالفعل ولن يتم استبداله: ${shopDir}`);
  process.exit(1);
}

fs.mkdirSync(path.join(shopDir, "data"), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(shopDir, "backups"), { recursive: true, mode: 0o700 });
fs.chmodSync(shopDir, 0o700);
fs.chmodSync(path.join(shopDir, "data"), 0o700);
fs.chmodSync(path.join(shopDir, "backups"), 0o700);

const guide = `مساحة مستقلة لمحل: ${slug}

بيانات هذا المحل ونسخه الاحتياطية منفصلة عن بقية المحلات:
${path.join(shopDir, "data")}
${path.join(shopDir, "backups")}

لتشغيل المحل، افتح Terminal من مجلد تطبيق gold_customer_accounts ونفّذ:
GCA_DATA_DIR="${path.join(shopDir, "data")}" GCA_BACKUP_DIR="${path.join(shopDir, "backups")}" PORT=${port} npm start

ثم افتح http://localhost:${port} على جهاز الخادم. أنشئ حساب المدير عند أول تشغيل، وبعدها أضف حسابًا منفصلًا لكل موظف.
اترك نافذة الخادم مفتوحة أثناء العمل. للوصول من جهاز آخر على شبكة المحل استخدم عنوان IP لجهاز الخادم بدل localhost.

لا تشغّل محلين على المنفذ نفسه. احتفظ بنسخ إضافية مشفرة أو على وسيط آمن خارج جهاز الخادم.
هذه أداة لعزل بيانات التشغيل محليًا لكل محل، وليست استضافة سحابية أو نظام اشتراكات/فوترة.
`;
fs.writeFileSync(path.join(shopDir, "START.txt"), guide, { mode: 0o600, flag: "wx" });
fs.chmodSync(path.join(shopDir, "START.txt"), 0o600);
console.log(`تم تجهيز مساحة بيانات مستقلة للمحل ${slug}.`);
console.log(`الدليل: ${path.join(shopDir, "START.txt")}`);
console.log(`المنفذ المقترح: ${port}`);
