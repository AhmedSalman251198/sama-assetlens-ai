import Link from "next/link";

export default function NotFound() {
  return (
    <section className="al-page al-card route-error">
      <span>404</span>
      <h2>الصفحة غير موجودة</h2>
      <p>ربما تغير الرابط أو لم تعد الصفحة متاحة لهذا الحساب.</p>
      <Link className="al-primary-button" href="/">العودة إلى لوحة التحكم</Link>
    </section>
  );
}
