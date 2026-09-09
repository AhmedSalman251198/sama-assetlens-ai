# AssetLens AI R16.3

## التعديلات المنفذة

- أضيف `condition_justification` إلى الأصول مع تحقق قاعدة بيانات للحالات Critical وPoor.
- رُبط Condition وCriticality بمسارات الكاميرا والمعرض والإضافة اليدوية وBulk Zone.
- كل صورة في Bulk لها تقييم حالة وCriticality وسبب حالة مستقل.
- أصبح إنشاء الأصل اليدوي idempotent باستخدام `offline_client_id`، ويُصفّر النموذج كاملًا بعد النجاح.
- أضيفت صلاحيات مستقلة للتابات والإجراءات في جدول `user_module_permissions` مع RLS.
- يُنشئ السوبر أدمن الحساب بكلمة مرور يكتبها، ويمكنه تغييرها لاحقًا من داخل الإدارة.
- استُبدل مخطط النشاط برسم Criticality شعاعي تفاعلي مرتبط بفلاتر التقارير.
- يظهر سبب الحالة في شاشة المراجعة، تفاصيل التقرير، البحث وتصدير Excel، ولا يدخل في QR لتقليل حجمه.

## المطلوب قبل التشغيل

1. نفّذ `supabase/migrations/012_condition_justification_module_permissions.sql` في Supabase SQL Editor.
2. تأكد من وجود `SUPABASE_SECRET_KEY` أو `SUPABASE_SERVICE_ROLE_KEY` كمتغير خادم فقط.
3. أعد نشر المشروع أو أعد تشغيل الخادم المحلي.

## التحقق

- ESLint: ناجح.
- TypeScript: ناجح.
- Next.js production build: ناجح.
- اختبارات الجودة: 28/28 ناجحة.
