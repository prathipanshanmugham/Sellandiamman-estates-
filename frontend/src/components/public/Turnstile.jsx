import { useEffect, useRef } from "react";

// Cloudflare Turnstile ("I am human" check). Renders only when the server has a site key configured;
// otherwise forms rely on the honeypot field and rate limits.
let loading = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return loading;
}

export default function Turnstile({ siteKey, onToken }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!siteKey) return undefined;
    let id = null;
    let gone = false;
    loadScript().then(() => {
      if (gone || !ref.current) return;
      id = window.turnstile.render(ref.current, { sitekey: siteKey, callback: onToken, "expired-callback": () => onToken(""), "error-callback": () => onToken("") });
    }).catch(() => onToken(""));
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!siteKey) return null;
  return <div ref={ref} className="min-h-[65px]" data-testid="turnstile" />;
}
