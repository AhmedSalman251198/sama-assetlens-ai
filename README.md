# AssetLens AI R14

منصة عربية متجاوبة لمسح لوحات بيانات الأصول (`Nameplates`) وتحويل الصور إلى بيانات منظمة باستخدام Gemini أو OpenAI، مع سجل أصول، مواقع هرمية، نقل أصول، تقارير Excel، صلاحيات مشاريع، وعمل ميداني Offline.

## ما الذي يحتويه الإصدار R14؟

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

بعد إنشاء أول حساب من صفحة التسجيل، عيّنه مديرًا مرة واحدة من SQL Editor:

```sql
update public.app_users
set role = 'admin', active = true
where email = lower('admin@your-company.com');
```

لا توجد عناوين بريد أو مفاتيح أو معرّفات Supabase ثابتة داخل المشروع.

## خريطة الصفحات

| المسار | الوظيفة |
|---|---|
| `/` | مؤشرات وشارتات فقط: الجودة، نشاط 7 أيام، المشاريع وتغطية المواقع |
| `/capture` | كاميرا/رفع، موقع الأصل، GPS، Barcode، Offline وطابور AI |
| `/assets` | سجل سريع ببحث وفلترة وترقيم صفحات من الخادم |
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
- اترك Supabase RLS مفعلة؛ لا تستخدم Service Role Key داخل الواجهة أو متغيرات `NEXT_PUBLIC_*`.
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
