const FROM_POINT = "метро Купчино, Санкт-Петербург";

const rowsEl = document.getElementById("rows");
const searchEl = document.getElementById("search");
const metricsEl = document.getElementById("metrics");
const selectedEl = document.getElementById("selected");
const openYandexBtn = document.getElementById("openYandex");
const selectedCard = document.getElementById("selectedCard");

let allRows = [];
let selected = null;
let map;
const markers = new Map();
const pointsByN = new Map();
let pulseTimer = null;
let routeLine = null;

const KUPCHINO = {
  lat: 59.8298,
  lon: 30.3757,
  label: "м. Купчино"
};

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(";").map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const parts = line.split(";");
    const rec = {};
    header.forEach((h, i) => { rec[h] = (parts[i] || "").trim(); });
    rec.n = Number(rec["№ участка"]);
    rec.distance = rec["Удаленность от м. Купчино, км"] ? Number(rec["Удаленность от м. Купчино, км"]) : null;
    rec.address = rec["Адрес"] || "[нет адреса]";
    return rec;
  });
}

function renderMetrics(rows) {
  const total = rows.length;
  const withDistance = rows.filter((r) => Number.isFinite(r.distance));
  const avg = withDistance.length ? (withDistance.reduce((a, b) => a + b.distance, 0) / withDistance.length).toFixed(1) : "-";
  const min = withDistance.length ? Math.min(...withDistance.map((r) => r.distance)).toFixed(1) : "-";
  const max = withDistance.length ? Math.max(...withDistance.map((r) => r.distance)).toFixed(1) : "-";

  metricsEl.innerHTML = [
    `Участков: <b>${total}</b>`,
    `Средняя дальность: <b>${avg} км</b>`,
    `Ближайший: <b>${min} км</b>`,
    `Дальний: <b>${max} км</b>`
  ].map((t) => `<div class="metric">${t}</div>`).join("");
}

function yandexRouteUrl(toAddress) {
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(FROM_POINT)}~${encodeURIComponent(toAddress)}&rtt=auto`;
}

function markerStyle(isActive) {
  return {
    radius: isActive ? 10 : 6,
    color: isActive ? "#991b1b" : "#334155",
    weight: isActive ? 2 : 1,
    fillColor: isActive ? "#ef4444" : "#64748b",
    fillOpacity: 1
  };
}

function refreshMarkerStyles() {
  for (const [n, marker] of markers) marker.setStyle(markerStyle(selected && selected.n === n));
}

function pulseSelectedMarker() {
  if (!selected) return;
  const marker = markers.get(selected.n);
  if (!marker) return;
  if (pulseTimer) clearInterval(pulseTimer);

  let tick = 0;
  pulseTimer = setInterval(() => {
    tick += 1;
    const grow = tick % 2 === 1;
    marker.setStyle({
      ...markerStyle(true),
      radius: grow ? 13 : 10
    });
    if (tick >= 6) {
      clearInterval(pulseTimer);
      pulseTimer = null;
      marker.setStyle(markerStyle(true));
    }
  }, 180);
}

function updateSelection(row) {
  selected = row;
  selectedCard.style.borderColor = "#67e8f9";
  selectedCard.style.boxShadow = "0 0 0 3px rgba(103, 232, 249, 0.16)";

  const distanceLabel = Number.isFinite(row.distance) ? `${row.distance} км` : "без данных по км";
  selectedEl.textContent = `Участок №${row.n}: ${distanceLabel}. ${row.address}`;

  openYandexBtn.disabled = false;
  openYandexBtn.onclick = () => window.open(yandexRouteUrl(row.address), "_blank", "noopener");

  const p = pointsByN.get(row.n);
  if (p && map) {
    void drawRoadRouteTo(p);
    const mk = markers.get(row.n);
    if (mk) mk.openPopup();
  }
  refreshMarkerStyles();
  pulseSelectedMarker();
}

async function drawRoadRouteTo(point) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${KUPCHINO.lon},${KUPCHINO.lat};${point.lon},${point.lat}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route?.geometry?.coordinates) return;

    const latlngs = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(latlngs, {
      color: "#dc2626",
      weight: 4,
      opacity: 0.9
    }).addTo(map);
  } catch {
    // No-op: keep UX working even if routing service is unavailable.
  }
}

function renderTable(rows) {
  rowsEl.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (selected && selected.n === row.n) tr.classList.add("active");
    tr.innerHTML = `<td>${row.n}</td><td>${row.address}</td><td>${row.distance ?? ""}</td>`;
    tr.addEventListener("click", () => {
      updateSelection(row);
      renderTable(filterRows(searchEl.value));
    });
    rowsEl.appendChild(tr);
  }
}

function filterRows(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return allRows;
  return allRows.filter((r) => String(r.n).includes(q) || r.address.toLowerCase().includes(q));
}

function setupMap(points) {
  map = L.map("map", { zoomControl: true });
  map.attributionControl.setPrefix(false);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  const latlngs = points.map((p) => [p.lat, p.lon]);
  latlngs.push([KUPCHINO.lat, KUPCHINO.lon]);
  map.fitBounds(latlngs, { padding: [24, 24] });

  const kupchinoMarker = L.circleMarker([KUPCHINO.lat, KUPCHINO.lon], {
    radius: 7,
    color: "#1d4ed8",
    weight: 2,
    fillColor: "#3b82f6",
    fillOpacity: 0.95
  }).addTo(map);
  kupchinoMarker.bindPopup(`<b>${KUPCHINO.label}</b>`);

  for (const p of points) {
    pointsByN.set(Number(p.n), p);
    const marker = L.circleMarker([p.lat, p.lon], markerStyle(false)).addTo(map);
    marker.bindPopup(`<b>Участок №${p.n}</b><br>${p.addr}`);
    marker.on("click", () => {
      const row = allRows.find((r) => r.n === Number(p.n));
      if (!row) return;
      updateSelection(row);
      renderTable(filterRows(searchEl.value));
    });
    markers.set(Number(p.n), marker);
  }
}

function autoSelectByExactNumber() {
  const raw = searchEl.value.trim();
  if (!/^\d+$/.test(raw)) return;
  const n = Number(raw);
  const row = allRows.find((r) => r.n === n);
  if (!row) return;
  updateSelection(row);
}

async function init() {
  const [csvText, points] = await Promise.all([
    fetch("./data/spisok_1_87_kupchino.csv").then((r) => r.text()),
    fetch("./data/points_1_87.json").then((r) => r.json())
  ]);

  allRows = parseCsv(csvText);
  const pointsAddrByN = new Map(points.map((p) => [Number(p.n), p.addr]));
  allRows = allRows.map((row) => {
    if (row.address && row.address !== "[нет адреса]") return row;
    const fallbackAddr = pointsAddrByN.get(row.n);
    return fallbackAddr ? { ...row, address: fallbackAddr } : row;
  });
  renderMetrics(allRows);
  renderTable(allRows);
  setupMap(points);
  autoSelectByExactNumber();

  searchEl.addEventListener("input", () => {
    autoSelectByExactNumber();
    renderTable(filterRows(searchEl.value));
  });
}

init().catch((err) => {
  selectedEl.textContent = `Ошибка загрузки данных: ${err.message}`;
});
