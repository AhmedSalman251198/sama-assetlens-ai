# AssetLens AI R14.1 — QR Offline, Mobile Web Picker, Super Admin

## QR Offline

- أزيل الاعتماد على `api.qrserver.com` بالكامل.
- رمز كل أصل يُنشأ محليًا من سجل Supabase الذي تم تحميله للمستخدم المصرح له.
- الرمز يحمل Asset ID والبيانات القياسية وكل حقول AI والحقول المخصصة غير الفارغة.
- البيانات تُضغط داخل QR وتُعرض في `/scan` بدون طلب قاعدة البيانات.
- صفحة المسح مضمنة في PWA cache، كما يتعرف عليها ماسح QR داخل صفحة Capture.

## Web Mobile Photo Source

- حقل المعرض لا يستخدم خاصية `capture`، ولذلك يفتح ملفات/معرض الهاتف.
- حقل كاميرا مستقل يستخدم `capture="environment"` لفتح الكاميرا الخلفية.
- تظهر للمستخدم أزرار منفصلة للكاميرا والمعرض قبل وبعد إضافة أول صورة.

## Account Security

- أزيل تبويب إنشاء الحساب وكل كود التسجيل الذاتي من صفحة Login.
- عمليات إنشاء المستخدم والدعوة والتفعيل محمية في API ببريد السوبر أدمن.
- Migration 007 تمنع إنشاء Auth user غير موجود مسبقًا في `app_users` كحساب معتمد.
- سياسات إدارة المستخدمين وتعيينات المشاريع أصبحت للسوبر أدمن فقط.

## Verification

- ESLint: passed.
- TypeScript: passed.
- Next.js production build: passed, including `/scan`.
- Quality tests: 18/18 passed.
- QR encode/decode round trip: passed with 37 fields.
- npm audit: 0 vulnerabilities.
