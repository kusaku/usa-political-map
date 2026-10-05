import * as maplibregl from "https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.mjs";
import { buffer as bufferGeometry } from "https://esm.sh/@turf/buffer@7.4.0";

const PARTY = {
  Democratic: { color: "#3688ff", nominee: "Kamala Harris" },
  Republican: { color: "#ff4f68", nominee: "Donald Trump" },
  Green: { color: "#36d979" },
  Libertarian: { color: "#f5c542" },
  Independent: { color: "#b58cff" },
  "Independent / minor party": { color: "#b58cff" },
  "Other candidates & write-ins": { color: "#9aabbf" },
  Other: { color: "#9aabbf" }
};
const DISPLAY_OFFSET = 125;
const INITIAL_VIEW = { center: [-96, 38], zoom: 3.6, pitch: 42, bearing: -5 };
const SOURCES = ["states", "state-caps"];

const state = { meta: [], metaById: new Map(), geometry: null, capGeometry: null, electionHistory: {}, polls: [], party: null, selectedId: null, year: "2024", map: null, bounds: null, hoveredId: null };
const dom = Object.fromEntries([
  "dataStatus", "nextElectionCountdown", "jurisdictionCount", "pollUpdateDate", "viewDescription", "mapLegend", "mapTooltip", "stateFlag", "stateFlagCode", "stateName", "stateCapital", "electionAlert", "electionDate", "electionResultLabel", "electoralVotes", "electionBars", "electionSource", "statesTable", "resultYearHeading", "partyTitle", "democraticCount", "republicanCount", "closestState", "partyTable", "pollMethod", "nationalPolls", "electionWatch", "resetMap"
].map((name) => [name, document.querySelector(`#${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)]));

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
};
const formatPercent = (value) => `${Number(value).toFixed(1)}%`;
const formatDate = (value) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
const party = (name) => PARTY[name] || PARTY.Other;
const flagIcon = (meta, className) => `<img class="${className}" src="assets/flags/${meta.flag}.svg" alt="" aria-hidden="true">`;
const currentElection = () => state.electionHistory[state.year];
const electionFor = (id) => currentElection().states[id];
const candidateTokens = (name) => String(name || "").toLowerCase().match(/[a-z]+/g) || [];

function normalizedParty(item) {
  if (!/independent/i.test(item.party)) return item.party;
  const candidate = candidateTokens(item.candidate);
  return Object.entries(currentElection().nominees).find(([, nominee]) => candidateTokens(nominee).at(-1) === candidate.at(-1))?.[0] || item.party;
}

function resultsFor(election) {
  const groups = new Map();
  for (const item of election?.results || []) {
    const party = normalizedParty(item), entry = groups.get(party) || { party, value: 0, votes: 0, candidate: currentElection().nominees[party] };
    entry.value += item.value;
    entry.votes += item.votes || 0;
    groups.set(party, entry);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

const partyResult = (election, name) => resultsFor(election).find((item) => item.party === name) || { party: name, value: 0 };
const mapParties = () => [...new Set(Object.values(currentElection().states).flatMap((election) => resultsFor(election).map((item) => item.party)))];

function nationalResult() {
  const totals = new Map();
  for (const regional of Object.values(currentElection().states)) for (const item of resultsFor(regional)) {
    if (!item.votes) continue;
    const entry = totals.get(item.party) || { party: item.party, votes: 0, candidates: new Map() };
    entry.votes += item.votes;
    if (item.candidate) entry.candidates.set(item.candidate, (entry.candidates.get(item.candidate) || 0) + item.votes);
    totals.set(item.party, entry);
  }
  const votes = [...totals.values()].reduce((sum, item) => sum + item.votes, 0);
  return [...totals.values()].map((item) => ({ party: item.party, candidate: ["Democratic", "Republican"].includes(item.party) ? [...item.candidates].sort((a, b) => b[1] - a[1])[0]?.[0] : null, value: item.votes / votes * 100 })).sort((a, b) => b.value - a.value);
}

function mixHex(hex, target = "#ffffff", amount = 0.25) {
  const from = hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
  const to = target.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function daysUntil(value) {
  const target = Date.parse(`${value}T12:00:00Z`);
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12);
  return Math.ceil((target - start) / 86_400_000);
}

function countdown(value) {
  const days = daysUntil(value);
  return days === 0 ? "Today" : days === 1 ? "1 day" : `${days.toLocaleString("en-GB")} days`;
}

async function loadData() {
  const [meta, geometry, electionPayload, pollPayload] = await Promise.all([
    fetchJson("data/states-meta.json"), fetchJson("data/states.geojson"), fetchJson("data/election-history.json"), fetchJson("data/national-polls.json")
  ]);
  state.meta = meta;
  state.metaById = new Map(meta.map((item) => [item.id, item]));
  state.geometry = geometry;
  state.electionHistory = electionPayload.elections;
  state.polls = pollPayload.polls;
  dom.dataStatus.textContent = `Local snapshot · ${formatDate(pollPayload.snapshotDate)}`;
  dom.nextElectionCountdown.textContent = countdown("2026-11-03");
  dom.jurisdictionCount.textContent = meta.length;
  dom.pollUpdateDate.textContent = formatDate(pollPayload.snapshotDate);
  dom.pollMethod.textContent = pollPayload.methodology;
}

function prepareGeometry() {
  const bounds = new maplibregl.LngLatBounds();
  const shift = (coordinates) => typeof coordinates[0] === "number" ? [coordinates[0] + DISPLAY_OFFSET, coordinates[1]] : coordinates.map(shift);
  const include = (coordinates) => typeof coordinates[0] === "number" ? bounds.extend(coordinates) : coordinates.forEach(include);
  state.geometry.features.forEach((feature) => {
    feature.properties.id = feature.id;
    feature.geometry = { ...feature.geometry, coordinates: shift(feature.geometry.coordinates) };
    include(feature.geometry.coordinates);
  });
  state.bounds = bounds;
  state.capGeometry = {
    ...state.geometry,
    features: state.geometry.features.map((feature) => {
      const inset = bufferGeometry(feature, -0.36, { units: "kilometers", steps: 2 });
      if (inset) inset.properties = feature.properties;
      return inset || feature;
    })
  };
}

function metric(meta) {
  const election = electionFor(meta.id), item = state.party ? partyResult(election, state.party) : resultsFor(election)[0];
  if (!item) return { color: PARTY.Other.color, height: 7000, label: "No data" };
  const color = state.party ? shade(party(item.party).color, item.value) : party(item.party).color;
  return { color, height: state.party ? 1600 + item.value * 760 : 7000 + item.value * 620, label: `${item.party} ${formatPercent(item.value)}` };
}

function shade(hex, value) {
  const source = hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16));
  const base = [9, 18, 30], amount = Math.min(1, 0.22 + value / 55 * 0.78);
  return `#${source.map((item, index) => Math.round(base[index] + (item - base[index]) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function applyMapMetrics() {
  state.geometry.features.forEach((feature) => {
    const current = metric(state.metaById.get(feature.id));
    Object.assign(feature.properties, current, { brightColor: mixHex(current.color) });
  });
  state.map?.getSource("states")?.setData(state.geometry);
  state.map?.getSource("state-caps")?.setData(state.capGeometry);
}

const byFeatureState = (selected, hovered, normal) => ["case", ["boolean", ["feature-state", "selected"], false], selected, ["boolean", ["feature-state", "hover"], false], hovered, normal];

function fitMap(duration = 0) {
  const compact = matchMedia("(max-width: 820px)").matches;
  state.map.fitBounds(state.bounds, {
    padding: compact ? { top: 20, right: 14, bottom: 102, left: 14 } : { top: 40, right: 40, bottom: 96, left: 40 },
    pitch: compact ? 34 : INITIAL_VIEW.pitch,
    bearing: compact ? -3 : INITIAL_VIEW.bearing,
    maxZoom: compact ? 4.65 : 4.85,
    duration
  });
}

function setFeatureState(id, value) {
  SOURCES.forEach((source) => state.map.setFeatureState({ source, id }, value));
}

function updateMapSelection(previous) {
  if (!state.map?.getSource("states")) return;
  if (previous) setFeatureState(previous, { selected: false });
  if (state.selectedId) setFeatureState(state.selectedId, { selected: true });
}

function initMap() {
  state.map = new maplibregl.Map({
    container: "map", center: INITIAL_VIEW.center, zoom: INITIAL_VIEW.zoom, minZoom: 2.6, maxZoom: 8, maxPitch: 75, pitch: INITIAL_VIEW.pitch, bearing: INITIAL_VIEW.bearing, renderWorldCopies: false, antialias: true, attributionControl: false,
    style: { version: 8, sources: {}, light: { anchor: "viewport", color: "#ffffff", intensity: 0.9, position: [1.45, 145, 42] }, layers: [{ id: "background", type: "background", paint: { "background-color": "rgba(3,5,8,0)" } }] }
  });
  state.map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  state.map.on("load", () => {
    state.map.setRenderWorldCopies(false);
    const add = (id, data) => state.map.addSource(id, { type: "geojson", data, promoteId: "id", maxzoom: 5, tolerance: 0, buffer: 256 });
    add("states", state.geometry); add("state-caps", state.capGeometry);
    const top = ["+", ["get", "height"], byFeatureState(4000, 1500, 0)];
    state.map.addLayer({ id: "state-extrusions", type: "fill-extrusion", source: "states", paint: { "fill-extrusion-color": byFeatureState("#e8ff5b", ["get", "brightColor"], ["get", "color"]), "fill-extrusion-height": top, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.98, "fill-extrusion-vertical-gradient": true } });
    state.map.addLayer({ id: "state-outline-caps", type: "fill-extrusion", source: "states", paint: { "fill-extrusion-color": "#080b11", "fill-extrusion-height": ["+", top, 220], "fill-extrusion-base": ["-", top, 260], "fill-extrusion-opacity": 1, "fill-extrusion-vertical-gradient": false } });
    state.map.addLayer({ id: "state-surface-caps", type: "fill-extrusion", source: "state-caps", paint: { "fill-extrusion-color": byFeatureState("#e8ff5b", ["get", "brightColor"], ["get", "color"]), "fill-extrusion-height": ["+", top, 360], "fill-extrusion-base": ["-", top, 80], "fill-extrusion-opacity": 0.98, "fill-extrusion-vertical-gradient": false } });
    state.map.addLayer({ id: "state-gloss-caps", type: "fill-extrusion", source: "state-caps", paint: { "fill-extrusion-color": byFeatureState("#ffffff", "#ffffff", ["get", "brightColor"]), "fill-extrusion-height": ["+", top, 440], "fill-extrusion-base": ["+", top, 300], "fill-extrusion-opacity": 0.12, "fill-extrusion-vertical-gradient": false } });
    applyMapMetrics(); updateMapSelection(); bindMapEvents(); fitMap();
  });
}

function bindMapEvents() {
  const layers = ["state-gloss-caps", "state-surface-caps", "state-outline-caps", "state-extrusions"];
  state.map.on("mousemove", layers, (event) => {
    const feature = event.features?.[0]; if (!feature) return;
    const id = feature.properties.id;
    state.map.getCanvas().style.cursor = "pointer";
    if (state.hoveredId !== id) { if (state.hoveredId) setFeatureState(state.hoveredId, { hover: false }); state.hoveredId = id; setFeatureState(id, { hover: true }); }
    const meta = state.metaById.get(id), bounds = document.querySelector(".map-panel").getBoundingClientRect();
    dom.mapTooltip.innerHTML = tooltip(meta);
    dom.mapTooltip.hidden = false;
    dom.mapTooltip.style.left = `${Math.min(event.point.x + 15, bounds.width - 280)}px`;
    dom.mapTooltip.style.top = `${Math.min(Math.max(12, event.point.y - 16), bounds.height - dom.mapTooltip.offsetHeight - 12)}px`;
  });
  state.map.on("mouseleave", layers, () => {
    state.map.getCanvas().style.cursor = ""; dom.mapTooltip.hidden = true;
    if (state.hoveredId) setFeatureState(state.hoveredId, { hover: false }); state.hoveredId = null;
  });
  state.map.on("click", layers, (event) => {
    const id = event.features?.[0]?.properties?.id; if (id) selectState(id);
  });
  state.map.on("click", (event) => { if (!state.map.queryRenderedFeatures(event.point, { layers }).length) clearSelection(); });
}

function tooltip(meta) {
  const election = electionFor(meta.id), items = state.party ? [partyResult(election, state.party)] : resultsFor(election);
  const rows = items.map((item) => { const info = party(item.party); return `<span style="--party-color:${info.color}"><i class="party-dot"></i>${item.party}<b>${formatPercent(item.value)}</b></span>`; }).join("");
  return `<span class="tooltip-title">${flagIcon(meta, "tooltip-flag")}<b>${meta.name}</b></span><div class="tooltip-results">${rows || "No statewide result"}</div>${state.party ? "" : "<small>Click anywhere in the state</small>"}`;
}

function miniBar(item) {
  const info = party(item.party);
  const label = item.candidate ? `${item.candidate} · ${item.party}` : item.party;
  return `<div class="mini-row" style="--party-color:${info.color}"><span class="party-name"><i class="party-dot"></i>${label}</span><div class="bar-track" aria-hidden="true"><div class="bar-fill" style="--value:${Math.min(100, item.value * 1.7)}%"></div></div><span class="mini-value">${formatPercent(item.value)}</span></div>`;
}

function renderDetails() {
  const history = currentElection();
  if (!state.selectedId) {
    const results = nationalResult();
    dom.stateName.textContent = "United States"; dom.stateCapital.textContent = "National popular vote · bundled statewide totals";
    dom.stateFlag.hidden = false; dom.stateFlag.src = "assets/flags/us.svg"; dom.stateFlag.alt = "United States flag"; dom.stateFlagCode.textContent = "US";
    dom.electionAlert.innerHTML = `<div class="alert-label">NEXT FEDERAL ELECTION</div><div class="alert-value"><strong>3 Nov 2026</strong><span>${countdown("2026-11-03")} to go · official date</span></div>`;
    dom.electionResultLabel.textContent = `${state.year} NATIONAL RESULT`;
    dom.electionDate.textContent = `${formatDate(history.date)} · popular vote`;
    dom.electoralVotes.textContent = "NATIONAL";
    dom.electionBars.innerHTML = results.slice(0, 8).map(miniBar).join("");
    dom.electionSource.href = "https://www.fec.gov/introduction-campaign-finance/election-results-and-voting/";
    return;
  }
  const meta = state.metaById.get(state.selectedId), election = electionFor(state.selectedId);
  dom.stateName.textContent = meta.name;
  dom.stateCapital.textContent = `Capital · ${meta.capital}`;
  dom.stateFlag.hidden = false;
  dom.stateFlag.src = `assets/flags/${meta.flag}.svg`; dom.stateFlag.alt = `${meta.name} flag`;
  dom.stateFlagCode.textContent = meta.iso;
  dom.electionAlert.innerHTML = `<div class="alert-label">NEXT FEDERAL ELECTION</div><div class="alert-value"><strong>${meta.nextElection.label}</strong><span>${countdown(meta.nextElection.date)} to go · official date</span></div>`;
  dom.electionResultLabel.textContent = `${state.year} PRESIDENTIAL RESULT`;
  dom.electionDate.textContent = `${formatDate(history.date)} · statewide popular vote`;
  dom.electoralVotes.textContent = "OFFICIAL";
  dom.electionBars.innerHTML = resultsFor(election).map(miniBar).join("");
  dom.electionSource.href = election.source;
}

function renderLegend() {
  const national = new Map(nationalResult().map(({ party, value }) => [party, value]));
  dom.mapLegend.innerHTML = mapParties().sort((a, b) => (national.get(b) || 0) - (national.get(a) || 0) || a.localeCompare(b)).map((name) => {
    const info = party(name);
    return `<button class="legend-item${name === state.party ? " is-active" : ""}" type="button" data-party="${name}" aria-pressed="${name === state.party}" style="--party-color:${info.color}" title="Show ${name} results"><i class="legend-swatch"></i>${name}</button>`;
  }).join("");
  dom.mapLegend.onclick = (event) => {
    const name = event.target.closest("[data-party]")?.dataset.party;
    if (!name) return;
    state.party = state.party === name ? null : name;
    applyMapMetrics(); render();
  };
}

function renderStatesTable() {
  dom.statesTable.innerHTML = [...state.meta].sort((a, b) => a.name.localeCompare(b.name)).map((meta) => {
    const winner = resultsFor(electionFor(meta.id))[0], info = party(winner.party);
    return `<tr class="${meta.id === state.selectedId ? "is-selected" : ""}"><td><button class="state-row-button" type="button" data-state-id="${meta.id}">${flagIcon(meta, "table-flag")}<span>${meta.name}</span></button></td><td><span class="table-party" style="--party-color:${info.color}"><i class="party-dot"></i>${winner.party}</span></td><td class="table-rating">${formatPercent(winner.value)}</td><td>${meta.nextElection.label}<span class="official-mark">OFFICIAL</span></td></tr>`;
  }).join("");
}

function renderElectionSummary() {
  const grouped = Object.fromEntries(["Democratic", "Republican"].map((name) => [name, { name, wins: [] }]));
  state.meta.forEach((meta) => {
    const result = resultsFor(electionFor(meta.id))[0], entry = grouped[result.party];
    if (entry) entry.wins.push({ meta, result });
  });
  const closest = state.meta.map((meta) => ({ meta, results: resultsFor(electionFor(meta.id)) })).sort((a, b) => (a.results[0].value - a.results[1].value) - (b.results[0].value - b.results[1].value))[0];
  dom.democraticCount.textContent = grouped.Democratic.wins.length;
  dom.republicanCount.textContent = grouped.Republican.wins.length;
  dom.closestState.textContent = closest.meta.id;
  dom.partyTable.innerHTML = [grouped.Democratic, grouped.Republican].map((entry) => {
    const strongest = [...entry.wins].sort((a, b) => b.result.value - a.result.value)[0];
    const info = party(entry.name), nominee = currentElection().nominees[entry.name];
    return `<tr><td><span class="table-party" style="--party-color:${info.color}"><i class="party-dot"></i>${entry.name}</span></td><td>${nominee}</td><td>${entry.wins.length}</td><td>${strongest.meta.name} · ${formatPercent(strongest.result.value)}</td></tr>`;
  }).join("");
}

function renderNationalPolls() {
  dom.nationalPolls.innerHTML = state.polls.map((poll) => `<div class="national-poll"><div><p class="section-label">${poll.pollster}</p><p class="section-note">${formatDate(poll.date)} · ${poll.population}</p></div><a class="source-link" href="${poll.source}" target="_blank" rel="noopener noreferrer">Source ↗</a><div class="poll-results">${poll.results.map((result) => `<span style="--party-color:${party(result.party).color}"><i class="party-dot"></i>${result.party} <b>${result.value}%</b></span>`).join("")}</div></div>`).join("");
  dom.electionWatch.innerHTML = `<div class="watch-item"><b>3 Nov 2026</b><span>U.S. House, U.S. Senate and state-level contests</span><small>${countdown("2026-11-03")} to go · official federal election date</small></div><div class="watch-item"><b>5 Nov 2024</b><span>Latest presidential general election</span><small>Results on the map are statewide popular-vote shares</small></div>`;
}

function render() {
  if (state.party && !mapParties().includes(state.party)) state.party = null;
  dom.resultYearHeading.textContent = `${state.year} winner`;
  dom.partyTitle.textContent = `${state.year} electoral map`;
  dom.viewDescription.textContent = state.party
    ? `Colour brightness and height show ${state.party}'s statewide vote share.`
    : `${state.year} · colour shows the statewide presidential winner; height shows vote share. Choose a party below to compare its result.`;
  renderDetails(); renderLegend(); renderStatesTable(); renderElectionSummary(); renderNationalPolls();
}

function selectState(id) {
  const previous = state.selectedId; state.selectedId = id;
  updateMapSelection(previous); render();
  if (matchMedia("(max-width: 820px)").matches) document.querySelector("#state-details").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearSelection() {
  if (!state.selectedId) return;
  const previous = state.selectedId; state.selectedId = null;
  updateMapSelection(previous); render();
}

function bindControls() {
  document.querySelectorAll(".view-button").forEach((button) => button.addEventListener("click", () => {
    state.year = button.dataset.year;
    document.querySelectorAll(".view-button").forEach((item) => { const active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", active); });
    if (state.party && !mapParties().includes(state.party)) state.party = null;
    applyMapMetrics(); render();
  }));
  document.addEventListener("click", (event) => { const button = event.target.closest("[data-state-id]"); if (button) selectState(button.dataset.stateId); });
  dom.resetMap.addEventListener("click", () => fitMap(500));
  addEventListener("resize", () => state.map?.resize());
}

async function start() {
  try { await loadData(); prepareGeometry(); initMap(); render(); bindControls(); }
  catch (error) { dom.dataStatus.textContent = "Local data could not be loaded"; console.error(error); }
}

start();
