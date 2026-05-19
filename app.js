const FROM_POINT = "метро Купчино, Санкт-Петербург";
const MAX_STOPS = 5;

const rowsEl = document.getElementById("rows");
const searchEl = document.getElementById("search");
const metricsEl = document.getElementById("metrics");
const selectedEl = document.getElementById("selected");
const openYandexBtn = document.getElementById("openYandex");
const selectedCard = document.getElementById("selectedCard");

const routeCountEl = document.getElementById("routeCount");
const routeListEl = document.getElementById("routeList");
const routeSummaryEl = document.getElementById("routeSummary");
const buildRouteBtn = document.getElementById("buildRoute");
const clearRouteBtn = document.getElementById("clearRoute");
const openMultiYandexBtn = document.getElementById("openMultiYandex");

let allRows = [];
let selected = null;
let map;
const markers = new Map();
const pointsByN = new Map();
let pulseTimer = null;
let routeLine = null;
let selectedStops = [];
let lastOptimizedRows = [];

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
  const withDistance = rows.filter((r) => Number.isFinite(r.distance));
  const avg = withDistance.length ? (withDistance.reduce((a, b) => a + b.distance, 0) / withDistance.length).toFixed(1) : "-";
  const min = withDistance.length ? Math.min(...withDistance.map((r) => r.distance)).toFixed(1) : "-";
  const max = withDistance.length ? Math.max(...withDistance.map((r) => r.distance)).toFixed(1) : "-";

  metricsEl.innerHTML = [
    `Участков: <b>${rows.length}</b>`,
    `Средняя дальность: <b>${avg} км</b>`,
    `Ближайший: <b>${min} км</b>`,
    `Дальний: <b>${max} км</b>`
  ].map((t) => `<div class="metric">${t}</div>`).join("");
}

function yandexRouteUrlByRows(rows) {
  const fromCoord = `${KUPCHINO.lat},${KUPCHINO.lon}`;
  const toParts = rows.map((r) => {
    const p = pointsByN.get(r.n);
    return p ? `${p.lat},${p.lon}` : r.address;
  });
  const routeChain = [fromCoord, ...toParts].join("~");
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(routeChain)}&rtt=auto`;
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
    marker.setStyle({ ...markerStyle(true), radius: grow ? 13 : 10 });
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
  openYandexBtn.onclick = () => window.open(yandexRouteUrlByRows([row]), "_blank", "noopener");

  const p = pointsByN.get(row.n);
  if (p && map) {
    void drawRoadRouteTo([p]);
    const mk = markers.get(row.n);
    if (mk) mk.openPopup();
  }
  refreshMarkerStyles();
  pulseSelectedMarker();
}

async function fetchRoadRouteCoords(pointsSeq) {
  if (!pointsSeq.length) return { latlngs: [], km: 0 };
  const via = [[KUPCHINO.lat, KUPCHINO.lon], ...pointsSeq.map((p) => [p.lat, p.lon])];
  const coords = via.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("routing failed");
  const data = await resp.json();
  const route = data?.routes?.[0];
  if (!route?.geometry?.coordinates) throw new Error("route empty");
  return {
    latlngs: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    km: (route.distance || 0) / 1000
  };
}

async function drawRoadRouteTo(pointsSeq) {
  try {
    const { latlngs } = await fetchRoadRouteCoords(pointsSeq);
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(latlngs, { color: "#dc2626", weight: 4, opacity: 0.9 }).addTo(map);
  } catch {
    // No-op.
  }
}

function addStop(row) {
  if (selectedStops.find((r) => r.n === row.n)) return;
  if (selectedStops.length >= MAX_STOPS) return;
  selectedStops.push(row);
  renderRoutePlanner();
  renderTable(filterRows(searchEl.value));
}

function removeStop(n) {
  selectedStops = selectedStops.filter((r) => r.n !== n);
  lastOptimizedRows = [];
  renderRoutePlanner();
  renderTable(filterRows(searchEl.value));
}

function renderTable(rows) {
  rowsEl.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (selected && selected.n === row.n) tr.classList.add("active");
    const inRoute = selectedStops.some((r) => r.n === row.n);
    tr.innerHTML = `
      <td>${row.n}</td>
      <td>${row.address}</td>
      <td>${row.distance ?? ""}</td>
      <td><button class="add-btn" data-add="${row.n}" ${inRoute || selectedStops.length >= MAX_STOPS ? "disabled" : ""}>${inRoute ? "Добавлен" : "+ В маршрут"}</button></td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target?.matches("button[data-add]")) return;
      updateSelection(row);
      renderTable(filterRows(searchEl.value));
    });
    tr.querySelector("button[data-add]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      addStop(row);
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

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i += 1) {
    const head = arr[i];
    const tail = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(tail)) out.push([head, ...p]);
  }
  return out;
}

async function distanceKmForOrder(orderRows) {
  const pts = orderRows.map((r) => pointsByN.get(r.n)).filter(Boolean);
  if (!pts.length) return Infinity;
  try {
    const { km } = await fetchRoadRouteCoords(pts);
    return km;
  } catch {
    return Infinity;
  }
}

async function buildOptimalRoute() {
  if (!selectedStops.length) return;
  buildRouteBtn.disabled = true;
  routeSummaryEl.textContent = "Итого: считаем оптимальный маршрут...";

  const perms = permutations(selectedStops);
  let bestOrder = null;
  let bestKm = Infinity;

  for (const order of perms) {
    // eslint-disable-next-line no-await-in-loop
    const km = await distanceKmForOrder(order);
    if (km < bestKm) {
      bestKm = km;
      bestOrder = order;
    }
  }

  if (!bestOrder || !Number.isFinite(bestKm)) {
    routeSummaryEl.textContent = "Итого: не удалось построить маршрут";
    buildRouteBtn.disabled = false;
    return;
  }

  lastOptimizedRows = bestOrder;
  const pts = bestOrder.map((r) => pointsByN.get(r.n)).filter(Boolean);
  await drawRoadRouteTo(pts);
  routeSummaryEl.textContent = `Итого: ${bestKm.toFixed(1)} км | Порядок: ${bestOrder.map((r) => `№${r.n}`).join(" -> ")}`;
  openMultiYandexBtn.disabled = false;
  openMultiYandexBtn.onclick = () => window.open(yandexRouteUrlByRows(bestOrder), "_blank", "noopener");
  buildRouteBtn.disabled = false;
}

function renderRoutePlanner() {
  routeCountEl.textContent = `Выбрано: ${selectedStops.length}/${MAX_STOPS}`;
  if (!selectedStops.length) {
    routeListEl.textContent = "Пока ничего не добавлено";
    routeSummaryEl.textContent = "Итого: -";
    buildRouteBtn.disabled = true;
    clearRouteBtn.disabled = true;
    openMultiYandexBtn.disabled = true;
    lastOptimizedRows = [];
    return;
  }

  routeListEl.innerHTML = selectedStops
    .map((r) => `<div>№${r.n} (${Number.isFinite(r.distance) ? `${r.distance} км` : "-"}) <button class="add-btn btn-light" data-remove="${r.n}">Убрать</button></div>`)
    .join("");

  for (const btn of routeListEl.querySelectorAll("button[data-remove]")) {
    btn.addEventListener("click", () => removeStop(Number(btn.dataset.remove)));
  }

  buildRouteBtn.disabled = false;
  clearRouteBtn.disabled = false;
  openMultiYandexBtn.disabled = !lastOptimizedRows.length;
}

function clearRoutePlan() {
  selectedStops = [];
  lastOptimizedRows = [];
  if (routeLine) {
    map.removeLayer(routeLine);
    routeLine = null;
  }
  renderRoutePlanner();
  renderTable(filterRows(searchEl.value));
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
  renderRoutePlanner();
  setupMap(points);

  searchEl.addEventListener("input", () => {
    autoSelectByExactNumber();
    renderTable(filterRows(searchEl.value));
  });

  buildRouteBtn.addEventListener("click", () => {
    void buildOptimalRoute();
  });
  clearRouteBtn.addEventListener("click", clearRoutePlan);
}

init().catch((err) => {
  selectedEl.textContent = `Ошибка загрузки данных: ${err.message}`;
});
