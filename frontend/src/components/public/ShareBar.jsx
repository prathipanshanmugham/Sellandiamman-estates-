import { useState } from "react";
import { Link2, MessageCircle, Share2, FileDown, Check } from "lucide-react";
import { copyText, waShare, openFile } from "../../lib/api";

// Share a listing or article: WhatsApp, copy link, the phone's share sheet (when available) and an optional brochure.
export default function ShareBar({ url, text, brochurePath, brochureName, testid = "share" }) {
  const [copied, setCopied] = useState(false);
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const native = async () => { try { await navigator.share({ title: text, text, url }); } catch { /* cancelled or refused */ } };
  const copy = async () => { if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } };
  return (
    <div className="flex flex-wrap gap-2" data-testid={`${testid}-bar`}>
      <a href={waShare(`${text}\n${url}`)} target="_blank" rel="noopener noreferrer" className="btn-line btn-sm" data-testid={`${testid}-whatsapp`}><MessageCircle size={14} />WhatsApp</a>
      <button type="button" className="btn-line btn-sm" onClick={copy} data-testid={`${testid}-copy`}>{copied ? <Check size={14} /> : <Link2 size={14} />}{copied ? "Link copied" : "Copy link"}</button>
      {canNative && <button type="button" className="btn-line btn-sm" onClick={native}><Share2 size={14} />Share</button>}
      {brochurePath && <button type="button" className="btn-line btn-sm" onClick={() => openFile(brochurePath, { name: brochureName || "Brochure" })} data-testid={`${testid}-brochure`}><FileDown size={14} />Brochure (PDF)</button>}
    </div>
  );
}
