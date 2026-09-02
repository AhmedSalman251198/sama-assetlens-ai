# نشر AssetLens AI R14 على Vercel

## 1. إعداد قاعدة البيانات

نفّذ `supabase/setup.sql` ثم migrations من `002` إلى `006` بالترتيب. الملف `006_performance_config_snapshot.sql` ضروري للحصول على أسرع تنقل؛ أنشئ أول حساب وعيّنه مديرًا بالطريقة الموضحة في `README.md`.

## 2. متغيرات البيئة

أضف القيم التالية من Vercel → Project → Settings → Environment Variables:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY

AI_PROVIDER=gemini
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-3.7-flash

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

لا تضع `SUPABASE_SERVICE_ROLE_KEY` أو أي مفتاح إداري داخل هذا المشروع أو Vercel Client Environment.
