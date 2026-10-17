import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { priceLabel } from "../../lib/api";

// Tiles default to OpenStreetMap. Set REACT_APP_MAP_TILES (and REACT_APP_MAP_ATTRIBUTION) to use a tile provider with a key.
const TILES = process.env.REACT_APP_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIB = process.env.REACT_APP_MAP_ATTRIBUTION || "&copy; OpenStreetMap contributors";
const TOWNS = [["Erode", 11.341, 77.7172], ["Perundurai", 11.2756, 77.5875], ["SIPCOT", 11.258, 77.556], ["Chithode", 11.393, 77.665], ["Bhavani", 11.4455, 77.6826]];

const short = (p) => priceLabel(p).replace(" on request", "").replace("/month", "/mo").replace("/night", "/nt");

export default function PropertyMap({ items, center, onSelect, selected, height = 520 }) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [tilesOk, setTilesOk] = useState(true);
  useEffect(() => {
    const m = L.map(box.current, { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
    const c = center || { lat: 11.31, lng: 77.65, zoom: 11 };
    m.setView([c.lat, c.lng], c.zoom || 11);
    let errors = 0;
    const t = L.tileLayer(TILES, { maxZoom: 18, attribution: ATTRIB });
    t.on("tileerror", () => { errors += 1; if (errors > 3) setTilesOk(false); });
    t.on("tileload", () => setTilesOk(true));
    t.addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current.clearLayers();
    const pts = items.filter((p) => p.public_lat && p.public_lng);
    if (!tilesOk) TOWNS.forEach(([n, la, ln]) => L.marker([la, ln], { interactive: false, icon: L.divIcon({ className: "", html: `<span style="font:600 11px/1 'Plus Jakarta Sans',sans-serif;color:#64748b;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;transform:translate(-50%,-50%);display:inline-block">${n}</span>` }) }).addTo(layer.current));
    pts.forEach((p) => {
      const on = p.listing_id === selected;
      const icon = L.divIcon({ className: "", html: `<div class="map-pin${on ? " on" : ""}" data-testid="map-pin-${p.listing_id}">${short(p)}</div>`, iconSize: null });
      L.marker([p.public_lat, p.public_lng], { icon, zIndexOffset: on ? 1000 : 0, keyboard: true, title: p.title }).on("click", () => onSelect && onSelect(p)).addTo(layer.current);
    });
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((p) => [p.public_lat, p.public_lng])).pad(0.2), { maxZoom: 14 });
    else if (pts.length === 1) m.setView([pts[0].public_lat, pts[0].public_lng], 13);
  }, [items, selected, tilesOk]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative">
      <div ref={box} style={{ height }} className="w-full border border-slate-200" data-testid="property-map" role="region" aria-label="Map of listings" />
      {!tilesOk && <p className="pointer-events-none absolute bottom-2 left-2 bg-white/90 px-2 py-1 text-[11px] text-slate-500">Map background unavailable here. Pins show approximate locations.</p>}
    </div>
  );
}
