# نشر AssetLens AI R16.3 على Vercel

## 1. إعداد قاعدة البيانات

نفّذ `supabase/setup.sql` ثم migrations من `002` إلى `012` بالترتيب. الملف `006_performance_config_snapshot.sql` ضروري للحصول على أسرع تنقل، والملف `007_super_admin_account_control.sql` يمنع التسجيل العام، والملف `009_roles_offices_accounts.sql` يضيف الحسابات المباشرة والأدوار والمستويات المكانية الديناميكية، والملف `010_asset_condition_rating.sql` يضيف تقييم حالة الأصل، والملف `011_asset_criticality_weighted_dashboard.sql` يضيف أهمية الأصل والوزن التلقائي، والملف `012_condition_justification_module_permissions.sql` يضيف سبب الحالة وصلاحيات التابات والإجراءات.

## 2. متغيرات البيئة

أضف القيم التالية من Vercel → Project → Settings → Environment Variables:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
# Legacy fallback: SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

AI_PROVIDER=gemini
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-3.7-flash
SUPER_ADMIN_EMAIL=eng.ahmedsalman96@gmail.com

# اختياري عند استخدام OpenAI
OPENAI_API_KEY=
OPENAI_VISION_MODEL=gpt-4o

NEXT_PUBLIC_SITE_URL=https://YOUR_DOMAIN
```

المشروع يقبل أيضًا `NEXT_PUBLIC_SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_ANON_KEY` للتوافق، لكن يفضّل الأسماء غير العامة أعلاه لأن إعدادات Supabase تصل للعميل من endpoint مخصص.

## 3. إعدادات البناء

- Framework Preset: `Next.js`
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: الافتراضي
- Node.js: `22.x`

ملف `vercel.json` يحدد 60 ثانية لمسارات التحليل والرفع والطابور. تحليل الخلفية يبدأ باستخدام `after()` بعد إرسال الاستجابة، والصور تُضغط في المتصفح إلى طلب أقل من 4 MB.

## 4. فحص ما قبل النشر

```bash
npm ci
npm audit --omit=dev
npm test
```

بعد النشر اختبر بحساب Surveyor وحساب Admin:

1. تسجيل الدخول والخروج.
2. فتح وإغلاق قائمة الموبايل.
3. التأكد أن لوحة التحكم تعرض المؤشرات والشارتات فقط، وأن كل زر جانبي يفتح صفحته المستقلة.
4. رفع أصل وتشغيل AI ومراجعة النتيجة.
5. البحث والترقيم في سجل الأصول.
6. فتح Location والانتقال منه إلى Capture.
7. نقل أصل داخل المشروع نفسه.
8. تنزيل Excel وفتح تقرير أصل من رابط مباشر.
9. تثبيت PWA، ثم تجربة Offline Queue وإعادة المزامنة.
10. إنشاء QR لأصل من التقارير؛ يجب أن يجلب النظام Snapshot جديدة بالـID، ثم امسحه أثناء وضع الطيران وتأكد من ظهور كل البيانات من داخل الرمز.
11. على الموبايل، التأكد من ظهور خياري الكاميرا ومعرض الصور كلٌ على حدة.
12. إنشاء حساب مباشر من السوبر أدمن بإدخال كلمة المرور، تسجيل الدخول به، ثم تجربة تغييرها من الحساب ومن السوبر أدمن.
13. إضافة مستوى مكاني جديد مثل «مكتب»، تحديده كإلزامي، إضافة قيمة، ثم التأكد من ظهوره في Capture والنقل والتقارير وQR.
14. حذف تعريف مستوى تجريبي والتأكد من بقاء القيمة التاريخية في سجل الأصل الذي حُفظ سابقًا.
15. اختر حالة الأصل ودرجة أهميته قبل إرفاق الصور، ثم تأكد أن الوزن مشتق تلقائيًا وأن القيم تظهر في التقارير وExcel وQR Offline.
16. من التقارير اختر فلتر «أهمية الأصل» مع نطاق زمني وصدّر النتائج، ثم جرّب فلتر المشروع/الفرع في الداشبورد وتأكد من تغير توزيع الأهمية ونسبة الأعطال الموزونة.
17. أنشئ مستخدمًا بصلاحيات تابات محددة، ثم تحقق أن التابات الأخرى مخفية وأن فتح رابطها المباشر أو API يعيد منع وصول.
18. قيّم أصلًا Critical أو Poor وتأكد أن سبب الحالة إلزامي، ثم اختبر أصلًا يدويًا وضغط زر الإنشاء مرتين للتأكد من عدم التكرار وتصفير النموذج.

`SUPABASE_SECRET_KEY` (أو `SUPABASE_SERVICE_ROLE_KEY` القديم) مطلوب لإنشاء حسابات Auth وإعادة تعيين كلمات مرور المستخدمين بواسطة السوبر أدمن. احفظه كـSecret في Vercel Production فقط، ولا تستخدم له اسمًا يبدأ بـ`NEXT_PUBLIC_` ولا تمرّره إلى المتصفح أو GitHub. تغيير المستخدم لكلمة مروره الشخصية لا يحتاج هذا المفتاح.
