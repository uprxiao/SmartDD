import { useMemo } from 'react';

// Synthetic prototype only: no file provider, network or application bridge.
// Production uses a separate native WebContentsView and explicit resource map.
export default function FileHtmlPreview({ text }) {
  const source = useMemo(() => '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; connect-src &#39;none&#39;; frame-src &#39;none&#39;; object-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' + text, [text]);
  return <iframe className="fw-html" title="HTML 文件文档预览（合成原型）" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={source} />;
}
