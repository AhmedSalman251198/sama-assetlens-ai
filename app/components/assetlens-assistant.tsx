"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { getAccessToken } from "../lib/supabase-auth";
import type { UiLanguage } from "../lib/ui-preferences";

type Project = { id: string; name: string };
type Match = { id: string; assetNo: string; assetType: string; location: string; replacementCost: number | null; priceCurrency?: string };
type Message = { role: "user" | "assistant"; text: string; mode?: "ai" | "register_search" | "calculation"; matches?: Match[]; citations?: string[]; limitation?: string };
type Answer = { summary: string; mode: "ai" | "register_search" | "calculation"; matches?: Match[]; citations?: string[]; limitation?: string; error?: string };

export default function AssetLensAssistant({ language }: { language: UiLanguage }) {
  const ar = language === "ar";
  const [open, setOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [comparisonAsset, setComparisonAsset] = useState<Match | null>(null);
  const [repairCost, setRepairCost] = useState("");
  const [replacementCost, setReplacementCost] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const token = await getAccessToken(); if (!token) return;
        const response = await fetch("/api/assistant", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const body = await response.json() as { projects?: Project[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Unable to load projects.");
        if (alive) { setProjects(body.projects || []); setProjectId(body.projects?.[0]?.id || ""); }
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Unable to load projects."); }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (open && threadRef.current) threadRef.current.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy, open]);
  useEffect(() => {
    if (!open) return;
    const focus = window.setTimeout(() => inputRef.current?.focus(), 220);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggleRef.current?.focus(); } };
    window.addEventListener("keydown", escape);
    return () => { window.clearTimeout(focus); window.removeEventListener("keydown", escape); };
  }, [open]);

  async function request(payload: Record<string, unknown>) {
    const token = await getAccessToken(); if (!token) throw new Error(ar ? "انتهت جلسة الدخول." : "Sign in again.");
    const response = await fetch("/api/assistant", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, projectId, language }) });
    const body = await response.json() as Answer;
    if (!response.ok) throw new Error(body.error || (ar ? "تعذر إكمال الطلب." : "The request could not be completed."));
    return body;
  }
  async function send(event?: FormEvent, suggested?: string) {
    event?.preventDefault();
    const question = (suggested || text).trim();
    if (!question || !projectId || busy) return;
    const history = messages.slice(-6).map(item => ({ role: item.role, text: item.text }));
    setMessages(current => [...current, { role: "user", text: question }]);
    setText(""); setShowWelcome(false); setError(""); setBusy(true);
    try {
      const result = await request({ question, history });
      setMessages(current => [...current, { role: "assistant", text: result.summary, mode: result.mode, matches: result.matches, citations: result.citations, limitation: result.limitation }]);
      if (/(repair|replace|تصليح|إصلاح|اصلاح|استبدال)/i.test(question) && result.matches?.length === 1) setComparisonAsset(result.matches[0]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : (ar ? "تعذر الإجابة." : "Could not answer.")); }
    finally { setBusy(false); }
  }
  async function compare(event: FormEvent) {
    event.preventDefault();
    if (!comparisonAsset || !repairCost.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const result = await request({ action: "compare", assetId: comparisonAsset.id, repairCost, replacementCost });
      setMessages(current => [...current, { role: "assistant", text: result.summary, mode: "calculation", citations: [comparisonAsset.id] }]);
      setComparisonAsset(null); setRepairCost(""); setReplacementCost("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : (ar ? "تعذرت المقارنة." : "Could not compare.")); }
    finally { setBusy(false); }
  }
  function switchProject(next: string) {
    setProjectId(next); setMessages([]); setComparisonAsset(null); setError("");
  }

  return <aside className={`assistant-dock ${open ? "is-open" : ""}`} dir={ar ? "rtl" : "ltr"} aria-label={ar ? "مساعد AssetLens الذكي" : "AssetLens AI Assistant"}>
    {!open && showWelcome && <button type="button" className="assistant-welcome" onClick={() => { setOpen(true); setShowWelcome(false); }}>{ar ? "أهلًا، كيف أقدر أساعدك؟" : "Hi! How can I help you?"}<span aria-hidden="true">✦</span></button>}
    <section id="assetlens-assistant-panel" className="assistant-panel" role="dialog" aria-label={ar ? "محادثة مساعد AssetLens الذكي" : "AssetLens AI Assistant chat"} aria-hidden={!open} inert={!open}>
      <header className="assistant-head"><div className="assistant-mark" aria-hidden="true">✦</div><div><strong>{ar ? "مساعد AssetLens الذكي" : "AssetLens AI Assistant"}</strong><small>{ar ? "إجابات من سجل الأصول المسموح لك به" : "Answers grounded in your asset register"}</small></div><button type="button" className="assistant-close" onClick={() => { setOpen(false); toggleRef.current?.focus(); }} aria-label={ar ? "تصغير المساعد" : "Minimize assistant"}>×</button></header>
      <div className="assistant-project"><label htmlFor="assistant-project-select">{ar ? "المشروع" : "Project"}</label><select id="assistant-project-select" value={projectId} onChange={event => switchProject(event.target.value)}><option value="">{ar ? "اختر مشروعًا" : "Choose a project"}</option>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></div>
      <div className="assistant-thread" ref={threadRef} aria-live="polite">
        <div className="assistant-intro"><span className="assistant-intro-icon">✦</span><strong>{ar ? "كيف أقدر أساعدك اليوم؟" : "How can I help you today?"}</strong><p>{ar ? "اسألني عن الأصول، حالة التشغيل، الأهمية أو المواقع. لن أقدّم سعرًا غير مسجل على أنه حقيقة." : "Ask about assets, condition, criticality or location. I never invent a price."}</p></div>
        {!messages.length && <div className="assistant-suggestions">{(ar ? ["كم أصلًا حرجًا حالته ضعيفة؟", "ورّيني الأصول التي تحتاج مراجعة", "ما أولويات الأصول في هذا المشروع؟"] : ["How many critical assets are in poor condition?", "Show assets that need review", "Which assets need priority attention?"]).map(suggestion => <button type="button" key={suggestion} disabled={!projectId || busy} onClick={() => void send(undefined, suggestion)}>{suggestion}<span>↗</span></button>)}</div>}
        {messages.map((message, index) => <div className={`assistant-message ${message.role}`} key={index}><div className="assistant-message-title">{message.role === "user" ? (ar ? "أنت" : "You") : "AssetLens"}{message.mode && <small data-mode={message.mode}>{message.mode === "ai" ? (ar ? "تحليل AI" : "AI analysis") : message.mode === "calculation" ? (ar ? "حساب من بياناتك" : "Calculated from your inputs") : (ar ? "بحث في السجل · ليس AI" : "Register search · not AI")}</small>}</div><p>{message.text}</p>{message.limitation && <small className="assistant-caveat">{message.limitation}</small>}{message.matches && message.matches.length > 0 && <div className="assistant-matches">{message.matches.slice(0, 5).map(asset => <button key={asset.id} type="button" onClick={() => setComparisonAsset(asset)} title={ar ? "مقارنة الإصلاح والاستبدال لهذا الأصل" : "Compare repair and replacement for this asset"}><b>{asset.assetNo}</b><span>{asset.assetType}</span></button>)}</div>}</div>)}
        {comparisonAsset && <form className="assistant-compare" onSubmit={event => void compare(event)}><strong>{ar ? `قارن خيارات ${comparisonAsset.assetNo}` : `Compare options for ${comparisonAsset.assetNo}`}</strong><p>{ar ? "ما تكلفة الإصلاح؟ وأدخل تكلفة استبدال تقريبية إن كانت معروفة (عرض السعر اختياري). يجب أن يكون المبلغان بنفس العملة." : "What is the repair cost? Add an approximate replacement cost if known (a quotation is optional). Use the same currency for both amounts."}</p><div><label>{ar ? `تكلفة الإصلاح ${comparisonAsset.priceCurrency || "AED"}` : `Repair cost ${comparisonAsset.priceCurrency || "AED"}`}<input type="number" min="0" step="0.01" value={repairCost} onChange={event => setRepairCost(event.target.value)} required /></label><label>{ar ? `تكلفة الاستبدال ${comparisonAsset.priceCurrency || "AED"} · اختياري` : `Replacement ${comparisonAsset.priceCurrency || "AED"} · optional`}<input type="number" min="0.01" step="0.01" value={replacementCost} onChange={event => setReplacementCost(event.target.value)} placeholder={comparisonAsset.replacementCost ? String(comparisonAsset.replacementCost) : "—"} /></label></div><button disabled={busy || !repairCost.trim()}>{ar ? "احسب المقارنة" : "Compare costs"}</button><button type="button" className="assistant-cancel" onClick={() => setComparisonAsset(null)}>{ar ? "إلغاء" : "Cancel"}</button></form>}
        {busy && <div className="assistant-thinking" role="status"><i /><i /><i /><span>{ar ? "أراجع السجل…" : "Checking the register…"}</span></div>}
        {error && <p className="assistant-error" role="alert">{error}</p>}
      </div>
      <form className="assistant-compose" onSubmit={event => void send(event)}><textarea ref={inputRef} rows={2} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={projectId ? (ar ? "اسأل عن أي أصل أو تابع المحادثة…" : "Ask about an asset or continue the chat…") : (ar ? "اختر مشروعًا أولًا" : "Choose a project first")} disabled={!projectId || busy} aria-label={ar ? "اكتب سؤالك" : "Type your question"} maxLength={500} /><button type="submit" disabled={!projectId || busy || text.trim().length < 3} aria-label={ar ? "إرسال السؤال" : "Send question"}>➤</button></form>
      <footer>{ar ? "معلومات السجل فقط · تحقق هندسيًا قبل اتخاذ القرار" : "Register data only · verify before decisions"}</footer>
    </section>
    <button type="button" className="assistant-trigger" ref={toggleRef} onClick={() => { setOpen(value => !value); setShowWelcome(false); }} aria-controls="assetlens-assistant-panel" aria-expanded={open} aria-label={open ? (ar ? "تصغير مساعد AssetLens" : "Minimize assistant") : (ar ? "فتح مساعد AssetLens الذكي" : "Open AssetLens AI Assistant")}><span className="assistant-trigger-orbit" aria-hidden="true" /><span className="assistant-trigger-symbol" aria-hidden="true">{open ? "×" : "✦"}</span><span className="assistant-trigger-name">AssetLens</span></button>
  </aside>;
}
