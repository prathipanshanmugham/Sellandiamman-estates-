import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { copyText } from "./api";

// Promise-based confirm / ask / notice dialogs, used instead of window.confirm / prompt / alert.
const Ctx = createContext(null);

export function DialogProvider({ children }) {
  const [d, setD] = useState(null);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const resolver = useRef(null);
  const open = useCallback((cfg) => new Promise((res) => {
    resolver.current = res;
    setVal(cfg.initial != null ? String(cfg.initial) : "");
    setErr("");
    setD(cfg);
  }), []);
  const done = (result) => { const r = resolver.current; resolver.current = null; setD(null); r && r(result); };
  const submit = (e) => {
    e.preventDefault();
    if (d.kind === "ask") {
      const v = val.trim();
      if (d.required !== false && !v) return setErr(`${d.label || "This field"} is required.`);
      if (d.type === "number" && v && Number.isNaN(Number(v))) return setErr("Enter a number.");
      return done(d.type === "number" ? (v === "" ? null : Number(v)) : v);
    }
    done(true);
  };
  const api = {
    confirm: (cfg) => open({ kind: "confirm", ...cfg }),
    ask: (cfg) => open({ kind: "ask", ...cfg }),
    notice: (cfg) => open({ kind: "notice", ...cfg }),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <Dialog open={!!d} onOpenChange={(o) => !o && done(d?.kind === "confirm" ? false : null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-md" data-testid="app-dialog">
          {d && <form onSubmit={submit} className="space-y-4">
            <DialogHeader><DialogTitle className="font-heading">{d.title}</DialogTitle>{d.body && <DialogDescription className="whitespace-pre-line text-sm text-slate-600">{d.body}</DialogDescription>}</DialogHeader>
            {d.kind === "ask" && <div>
              {d.label && <label className="lbl" htmlFor="app-dialog-input">{d.label}</label>}
              {d.type === "textarea"
                ? <textarea id="app-dialog-input" rows={3} className="inp" value={val} onChange={(e) => setVal(e.target.value)} autoFocus data-testid="app-dialog-input" />
                : <input id="app-dialog-input" className="inp" type={d.type || "text"} step={d.type === "number" ? "any" : undefined} inputMode={d.type === "number" ? "decimal" : undefined} value={val} onChange={(e) => setVal(e.target.value)} autoFocus placeholder={d.placeholder} data-testid="app-dialog-input" />}
              {d.hint && <p className="mt-1 text-xs text-slate-400">{d.hint}</p>}
              {err && <p className="mt-1 text-sm text-red-700" role="alert">{err}</p>}
            </div>}
            {d.copy && <div className="flex gap-2"><input readOnly className="inp font-mono text-xs" value={d.copy} onFocus={(e) => e.target.select()} data-testid="app-dialog-copy" /><button type="button" className="btn-line btn-sm" onClick={() => copyText(d.copy)}>Copy</button></div>}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              {d.kind !== "notice" && <button type="button" className="btn-line" onClick={() => done(d.kind === "confirm" ? false : null)} data-testid="app-dialog-cancel">Cancel</button>}
              <button className={d.tone === "danger" ? "btn-danger" : "btn-dark"} data-testid="app-dialog-ok">{d.okLabel || (d.kind === "notice" ? "Close" : d.kind === "confirm" ? "Confirm" : "Save")}</button>
            </div>
          </form>}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export const useDialog = () => useContext(Ctx);
