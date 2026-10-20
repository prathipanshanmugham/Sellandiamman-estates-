import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Crosshair, MapPin, X } from "lucide-react";

const TILES = process.env.REACT_APP_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIB = process.env.REACT_APP_MAP_ATTRIBUTION || "&copy; OpenStreetMap contributors";
const DEFAULT = { lat: 11.36, lng: 77.68, zoom: 9 };
const pinIcon = L.divIcon({ className: "", html: '<div class="geo-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 22] });

// Town + locality + map pin for a property. The pin comes from the phone's GPS ("Use my location") or from tapping
// the map; it can be dragged to the exact spot. value: { city, locality, pincode, lat, lng, accuracy_m, source }.
export default function LocationPicker({ value, onChange, towns = [], allowNewTown = true, testid = "location-picker", note }) {
  const v = value || {};
  const known = towns.find((t) => t.name.toLowerCase() === (v.city || "").toLowerCase());
  const [otherTown, setOtherTown] = useState(!!v.city && !known && towns.length > 0);
  const [gps, setGps] = useState({ busy: false, msg: "" });
  const box = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const circle = useRef(null);
  const set = (patch) => onChange({ ...v, ...patch });
  // the map's own click / drag handlers always use the latest value
  const onChangeRef = useRef();
  onChangeRef.current = set;
  const localities = useMemo(() => (known?.localities || []).map((l) => l.name), [known]);

  useEffect(() => {
    const m = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
    const c = known?.lat ? { lat: known.lat, lng: known.lng, zoom: 13 } : DEFAULT;
    m.setView(v.lat ? [v.lat, v.lng] : [c.lat, c.lng], v.lat ? 15 : c.zoom);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIB }).addTo(m);
    m.on("click", (e) => onChangeRef.current({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6), accuracy_m: null, source: "map_pin" }));
    map.current = m;
    return () => { m.remove(); map.current = null; marker.current = null; circle.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (v.lat && v.lng) {
      const ll = [v.lat, v.lng];
      if (!marker.current) {
        marker.current = L.marker(ll, { draggable: true, icon: pinIcon, keyboard: true, title: "Property location" }).addTo(m);
        marker.current.on("dragend", () => { const p = marker.current.getLatLng(); onChangeRef.current({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), accuracy_m: null, source: "map_pin" }); });
      } else marker.current.setLatLng(ll);
      if (circle.current) { circle.current.remove(); circle.current = null; }
      if (v.accuracy_m) circle.current = L.circle(ll, { radius: v.accuracy_m, color: "#0f172a", weight: 1, fillOpacity: 0.08 }).addTo(m);
      if (!m.getBounds().contains(ll)) m.setView(ll, Math.max(m.getZoom(), 15));
    } else {
      if (marker.current) { marker.current.remove(); marker.current = null; }
      if (circle.current) { circle.current.remove(); circle.current = null; }
    }
  }, [v.lat, v.lng, v.accuracy_m]);

  // centre on the town when one is picked and there is no pin yet
  useEffect(() => { if (map.current && known?.lat && !v.lat) map.current.setView([known.lat, known.lng], 13); }, [known?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const locate = () => {
    if (!navigator.geolocation) return setGps({ busy: false, msg: "This browser cannot share its location. Tap the map instead." });
    setGps({ busy: true, msg: "Finding you… stand near the property and allow location access." });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        set({ lat: +latitude.toFixed(6), lng: +longitude.toFixed(6), accuracy_m: Math.round(accuracy), source: "gps" });
        if (map.current) map.current.setView([latitude, longitude], 17);
        setGps({ busy: false, msg: accuracy > 100 ? `Accurate to about ${Math.round(accuracy)} m. Drag the pin onto the property if needed.` : "Location captured. Drag the pin if it is not exactly on the property." });
      },
      (err) => setGps({ busy: false, msg: err.code === 1 ? "Location access was not allowed. Allow it in the browser settings, or tap the map to place the pin." : "Could not get a location fix. Tap the map to place the pin." }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  return (
    <div className="space-y-3" data-testid={testid}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="lbl" htmlFor={`${testid}-town`}>Town / city *</label>
          {towns.length > 0 && !otherTown
            ? <select id={`${testid}-town`} className="inp" value={known?.name || ""} onChange={(e) => { if (e.target.value === "__other") { setOtherTown(true); set({ city: "", locality: "" }); } else set({ city: e.target.value, locality: "" }); }} data-testid={`${testid}-town`}>
                <option value="">Choose…</option>{towns.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}{allowNewTown && <option value="__other">Another town…</option>}
              </select>
            : <div className="flex gap-1"><input id={`${testid}-town`} className="inp" value={v.city || ""} onChange={(e) => set({ city: e.target.value })} placeholder="Town name" data-testid={`${testid}-town-text`} />{towns.length > 0 && <button type="button" className="btn-line btn-sm" onClick={() => { setOtherTown(false); set({ city: "" }); }} aria-label="Choose from the list"><X size={14} /></button>}</div>}
        </div>
        <div>
          <label className="lbl" htmlFor={`${testid}-loc`}>Locality / area *</label>
          <input id={`${testid}-loc`} className="inp" list={`${testid}-locs`} value={v.locality || ""} onChange={(e) => set({ locality: e.target.value })} placeholder={localities[0] ? `e.g. ${localities[0]}` : "Area, street or village"} data-testid={`${testid}-locality`} />
          <datalist id={`${testid}-locs`}>{localities.map((l) => <option key={l} value={l} />)}</datalist>
        </div>
        <div><label className="lbl" htmlFor={`${testid}-pin`}>PIN code</label><input id={`${testid}-pin`} className="inp" maxLength={6} inputMode="numeric" value={v.pincode || ""} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, "") })} data-testid={`${testid}-pincode`} /></div>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="lbl !mb-0 flex items-center gap-1"><MapPin size={12} />Pin on the map</p>
          <div className="flex gap-2">
            <button type="button" className="btn-dark btn-sm" onClick={locate} disabled={gps.busy} data-testid={`${testid}-gps`}><Crosshair size={13} />{gps.busy ? "Locating…" : "Use my current location"}</button>
            {v.lat && <button type="button" className="btn-line btn-sm" onClick={() => set({ lat: null, lng: null, accuracy_m: null, source: null })} data-testid={`${testid}-clear`}>Remove pin</button>}
          </div>
        </div>
        <div ref={box} className="h-64 w-full border border-slate-200 sm:h-72" role="application" aria-label="Map: tap to place the property's pin" />
        <p className="mt-1 text-xs text-slate-500" aria-live="polite" data-testid={`${testid}-status`}>
          {gps.msg || (v.lat ? `Pin at ${Number(v.lat).toFixed(5)}, ${Number(v.lng).toFixed(5)}${v.accuracy_m ? ` (±${v.accuracy_m} m)` : ""} · ${v.source === "gps" ? "from GPS" : "placed on the map"}` : "Tap the map where the property is, or use your phone's location while you are at the property.")}
        </p>
        {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
      </div>
    </div>
  );
}
