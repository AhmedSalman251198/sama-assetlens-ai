# AssetLens AI R16.3

## الجديد في R16.3

- تقييم الحالة وCriticality إلزاميان قبل إدخال أي أصل بالصور أو بالكاميرا أو يدويًا، مع تقييم مستقل لكل صورة في Bulk Zone.
- عند الحالة Critical أو Poor يصبح سبب الحالة إلزاميًا، ويظهر في التقارير وتصدير Excel من دون زيادة حجم QR.
- الإنشاء اليدوي محمي بمعرّف idempotency لمنع التكرار، ثم يعرض رسالة نجاح ويصفّر المشروع والموقع والحقول والتقييمات.
- السوبر أدمن يكتب البريد وكلمة المرور عند إنشاء الحساب مباشرة، ويستطيع تغيير كلمة المرور لاحقًا من داخل النظام.
- صلاحيات مستقلة لكل تاب ولكل إجراء: عرض، إضافة، تعديل، حذف، اعتماد وتصدير، مع منع المسار والـAPI معًا.
- استبدال مخطط نشاط 7 أيام برسم Criticality شعاعي تفاعلي؛ الضغط على مستوى يفتح التقارير مفلترة عليه.

## ما تم في R16

- هيكل مكاني مرن: `مبنى ← طابق ← زون` ثم أي عدد من المستويات التي يعرّفها الأدمن مثل مكتب أو غرفة أو جناح أو قسم.
- يستطيع الأدمن إضافة المستوى أو حذفه، جعله إلزاميًا أو اختياريًا، وإدارة قيمه وربطها بمبنى/طابق/زون.
- تُحفظ قيم المستويات الإضافية كنسخة تاريخية مع الأصل؛ لذلك لا يؤدي حذف تعريف مستوى لاحقًا إلى محو بيانات الأصول القديمة.
- خمسة أدوار فعلية: مدير نظام، مدير مشروع، مراجع، مساح ميداني، ومشاهد فقط.
- إنشاء حساب دخول مباشر بكلمة مرور يحددها السوبر أدمن وتغييرها لاحقًا، من دون إرسال دعوة بريدية.
- إظهار الحقول الأساسية دائمًا في نتيجة التحليل: اسم الأصل، البراند/الشركة المصنعة، رقم الموديل، والرقم التسلسلي.
- اختيار إلزامي لحالة الأصل وأهميته قبل إرفاق الصور، مع اشتقاق الوزن تلقائيًا من Criticality بدرجات 1–5.
- فلاتر Criticality في التقارير وتصدير Excel للنتائج المفلترة، وداشبورد بصري يوزع الأصول ويحسب تأثير الأعطال بالوزن.
- تمرير الهيكل الديناميكي كاملًا إلى الالتقاط اليدوي/بالصور، النقل، التقارير، Excel وQR Offline.

## ما تم في R15

- رحلة إضافة أصل من ثلاث مراحل: الموقع، الصور أو الإدخال اليدوي، ثم المراجعة.
- حقول ديناميكية حسب نوع الأصل مع تحكم إلزامي/اختياري ووحدة القياس والاستخراج بالذكاء الاصطناعي والظهور في التقارير وQR.
- فلاتر إدارية مترابطة للداشبورد تُعيد حساب المؤشرات والرسوم من Supabase.
- دمج سجل الأصول في صفحة التقارير مع العرض والنقل والحذف والتصدير والطباعة.
- ملصقات QR أصغر مع الاحتفاظ ببيانات Supabase داخل الرمز للقراءة دون إنترنت.
- مؤشر انتقال متحرك بشعار AssetLens AI وخط Cairo مع System Fonts كبديل سريع.
- إدارة الحسابات والأدوار والمشاريع من حساب السوبر أدمن فقط.

شغّل migrations حتى `supabase/migrations/012_condition_justification_module_permissions.sql` بالترتيب قبل نشر هذا الإصدار.

منصة عربية متجاوبة لمسح لوحات بيانات الأصول (`Nameplates`) وتحويل الصور إلى بيانات منظمة باستخدام Gemini أو OpenAI، مع سجل أصول، مواقع هرمية، نقل أصول، تقارير Excel، صلاحيات مشاريع، وعمل ميداني Offline.

## ما الذي يحتويه الإصدار R14؟

### إصلاح QR في R14.2

- عند الطباعة يُعاد جلب كل أصل مباشرة من Supabase بواسطة `Asset ID`؛ لا يُستخدم صف التقارير المؤقت أو المخزن في المتصفح.
- يحتوي QR على Snapshot خفيف من الهوية والمعلومات الفنية والموقع والحالة والأهمية والحقول التي اختار الأدمن إظهارها؛ وتُحذف منه أوقات الالتقاط وهوية الماسح والثقة والبيانات التشغيلية غير الضرورية.
- يمنع النظام طباعة QR فارغ، ويعرض خطأ واضحًا إن كان السجل غير موجود أو تجاوزت البيانات السعة الفيزيائية لرمز واحد.
- تنسيق مضغوط أصغر مع QR عالي الدقة، مع استمرار قراءة رموز R14.1 السابقة.

### إضافات R14.1

- QR ذاتي يحتوي Asset ID ونسخة مضغوطة من كل بيانات الأصل والحقول المخصصة القادمة من Supabase، مع صفحة `/scan` مخزنة داخل PWA لعرض البيانات بدون إنترنت.
- توليد QR محلي داخل المتصفح دون الاعتماد على خدمة صور خارجية.
- فصل اختيار الصور على Web Mobile إلى زرين واضحين: التقاط بالكاميرا أو اختيار من معرض الهاتف.
- إزالة التسجيل العام، وقصر إنشاء الحسابات والدعوات وإدارة المستخدمين على السوبر أدمن `eng.ahmedsalman96@gmail.com` من الواجهة والـAPI وقواعد Supabase.

- داشبورد تحليلي فقط: مؤشرات وشارتات الجودة والنشاط والمشاريع والمواقع، من دون تكرار محتوى الصفحات الفرعية.
- صفحات مستقلة لـ Capture، Asset Register، Organization، Locations، Asset Transfer، Reports وAdministration.
- قائمة جانبية موحدة بروابط حقيقية، Drawer فعّال للموبايل، تنقل سفلي، وحالات Loading/Error/Empty متناسقة.
- Cache قصير وآمن لكل مستخدم، دمج الطلبات المتزامنة، Prefetch للصفحات، ومهلة زمنية للاتصال لمنع تعليق الواجهة.
- Snapshot واحد للداشبورد وآخر للإعدادات والهيكل؛ ما يقلّل عدد رحلات Supabase عند فتح الصفحات.
- ضغط صور تلقائي قبل الرفع، طابور FIFO، معالجة AI بعد الاستجابة، وحد زمني واضح للمزود.
- بحث وترقيم صفحات من الخادم في سجل الأصول.
- PWA قابلة للتثبيت مع Offline Queue وGPS وQR/Barcode، مع منع تخزين RSC القديم أو تكرار واجهة سابقة بعد التحديث.
- اختيار تلقائي لموديل Gemini الحديث المتاح للمفتاح، مع تجاوز إعدادات 1.x/2.x القديمة وتجربة Gemini 3.7 ثم 3.6 و3.5.
- Supabase Auth وRLS وتدقيق تغييرات وصور خاصة.
- تصدير واستيراد Excel عبر `exceljs` المحمّل عند الطلب فقط.

## المتطلبات

- Node.js `>=22.13.0`
- مشروع Supabase
- مفتاح Gemini أو OpenAI واحد على الأقل

## التشغيل المحلي

```bash
npm ci
cp .env.example .env.local
npm run dev
```

ثم افتح `http://localhost:3000`.

املأ `.env.local` بالقيم الصحيحة:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_ONLY_SECRET_KEY
# Legacy fallback: SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

AI_PROVIDER=gemini
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-3.7-flash

# بديل اختياري
OPENAI_API_KEY=
OPENAI_VISION_MODEL=gpt-4o

NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

يمكن للمستخدم إدخال مفتاح Gemini داخل شاشة Capture؛ يُحفظ في `sessionStorage` للتبويب الحالي فقط ولا يُكتب في قاعدة البيانات.

## إعداد Supabase

نفّذ الملفات التالية بالترتيب من Supabase SQL Editor:

1. `supabase/setup.sql`
2. `supabase/migrations/002_asset_workflow.sql`
3. `supabase/migrations/003_custom_fields_audit.sql`
4. `supabase/migrations/004_mobile_offline_capture.sql`
5. `supabase/migrations/005_dashboard_snapshot.sql`
6. `supabase/migrations/006_performance_config_snapshot.sql`
7. `supabase/migrations/007_super_admin_account_control.sql`
8. `supabase/migrations/008_global_product_upgrade.sql`
9. `supabase/migrations/009_roles_offices_accounts.sql`
10. `supabase/migrations/010_asset_condition_rating.sql`
11. `supabase/migrations/011_asset_criticality_weighted_dashboard.sql`
12. `supabase/migrations/012_condition_justification_module_permissions.sql`

تأكد أن حساب السوبر أدمن مفعّل:

```sql
update public.app_users
set role = 'admin', active = true
where email = lower('eng.ahmedsalman96@gmail.com');
```

## خريطة الصفحات

| المسار | الوظيفة |
|---|---|
| `/` | مؤشرات وشارتات فقط: الجودة، Criticality الشعاعي، التأثير الموزون، المشاريع وتغطية المواقع |
| `/capture` | كاميرا/رفع، موقع الأصل، GPS، Barcode، Offline وطابور AI |
| `/assets` | يحوّل تلقائيًا إلى التقارير؛ سجل الأصول موحّد داخلها |
| `/organization` | خريطة المشاريع والمباني والطوابق والزونات |
| `/locations` | دليل مواقع مع روابط مباشرة للمسح والنقل |
| `/transfers` | نقل أصل داخل مشروعه فقط مع تحقق من الموقع |
| `/reports` | فلاتر متقدمة، جودة، QR، Excel واستيراد Legacy |
| `/admin` | المشاريع والمواقع والمستخدمون والقواعد وسجل التدقيق |

## أوامر الجودة

```bash
npm run lint
npm run typecheck
npm run build
npm run test:quality

# ينفذ جميع ما سبق
npm test
```

## ملاحظات الإنتاج

- استخدم `npm ci` في CI حتى يلتزم `package-lock.json` حرفيًا.
- اترك Supabase RLS مفعلة. يستخدم الخادم `SUPABASE_SECRET_KEY` (أو `SUPABASE_SERVICE_ROLE_KEY` القديم) فقط لإنشاء حسابات Auth وإعادة تعيين كلمات مرور المستخدمين؛ لا تسمّه مطلقًا `NEXT_PUBLIC_*` ولا تستخدمه في أي Client Component. تغيير المستخدم لكلمة مروره الشخصية يتم بجلسة دخوله ولا يحتاج المفتاح السري.
- طبّق migration `006` بعد `005` للحصول على Snapshot محسّن للداشبورد والإعدادات وبيانات المستخدم؛ توجد مسارات fallback تلقائية قبل تطبيقها لكنها أبطأ.
- طلب الرفع بعد التحسين لا يتجاوز 4 MB لتفادي حدود أجسام الطلبات الشائعة في Serverless.
- طابور التحليل يحد كل مستخدم بـ50 مهمة نشطة ويعالج مهمة واحدة ذريًا في كل مرة.
- راجع [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md) للنشر.

## هيكل تقني مختصر

- Next.js 16 App Router + React 19 + TypeScript
- Supabase Auth, Postgres, RLS وStorage
- Gemini structured JSON أو OpenAI Responses JSON Schema
- ExcelJS dynamic import
- Service Worker + IndexedDB Offline Queue
