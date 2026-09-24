import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const dataPath = (name) => new URL(`data/${name}`, ROOT);
const geometryOnly = process.argv.includes("--geometry");
const GEOMETRY_URL = "https://raw.githubusercontent.com/EricDalnas/leaflet.us-states/main/src/us-states.geojson";
const RESULTS_URL = "https://raw.githubusercontent.com/fivethirtyeight/election-results/master/election_results_presidential.csv";
const HISTORICAL_RESULTS_URL = "https://raw.githubusercontent.com/plotly/Figure-Friday/main/2024/week-33/1976-2020-president.csv";

const states = {
  AL: ["Alabama", "Montgomery"], AK: ["Alaska", "Juneau"], AZ: ["Arizona", "Phoenix"], AR: ["Arkansas", "Little Rock"], CA: ["California", "Sacramento"], CO: ["Colorado", "Denver"], CT: ["Connecticut", "Hartford"], DE: ["Delaware", "Dover"], FL: ["Florida", "Tallahassee"], GA: ["Georgia", "Atlanta"], HI: ["Hawaii", "Honolulu"], ID: ["Idaho", "Boise"], IL: ["Illinois", "Springfield"], IN: ["Indiana", "Indianapolis"], IA: ["Iowa", "Des Moines"], KS: ["Kansas", "Topeka"], KY: ["Kentucky", "Frankfort"], LA: ["Louisiana", "Baton Rouge"], ME: ["Maine", "Augusta"], MD: ["Maryland", "Annapolis"], MA: ["Massachusetts", "Boston"], MI: ["Michigan", "Lansing"], MN: ["Minnesota", "Saint Paul"], MS: ["Mississippi", "Jackson"], MO: ["Missouri", "Jefferson City"], MT: ["Montana", "Helena"], NE: ["Nebraska", "Lincoln"], NV: ["Nevada", "Carson City"], NH: ["New Hampshire", "Concord"], NJ: ["New Jersey", "Trenton"], NM: ["New Mexico", "Santa Fe"], NY: ["New York", "Albany"], NC: ["North Carolina", "Raleigh"], ND: ["North Dakota", "Bismarck"], OH: ["Ohio", "Columbus"], OK: ["Oklahoma", "Oklahoma City"], OR: ["Oregon", "Salem"], PA: ["Pennsylvania", "Harrisburg"], RI: ["Rhode Island", "Providence"], SC: ["South Carolina", "Columbia"], SD: ["South Dakota", "Pierre"], TN: ["Tennessee", "Nashville"], TX: ["Texas", "Austin"], UT: ["Utah", "Salt Lake City"], VT: ["Vermont", "Montpelier"], VA: ["Virginia", "Richmond"], WA: ["Washington", "Olympia"], WV: ["West Virginia", "Charleston"], WI: ["Wisconsin", "Madison"], WY: ["Wyoming", "Cheyenne"], DC: ["District of Columbia", "Washington, D.C."]
};

const electoralVotes = { AL: 9, AK: 3, AZ: 11, AR: 6, CA: 54, CO: 10, CT: 7, DE: 3, FL: 30, GA: 16, HI: 4, ID: 4, IL: 19, IN: 11, IA: 6, KS: 6, KY: 8, LA: 8, ME: 4, MD: 10, MA: 11, MI: 15, MN: 10, MS: 6, MO: 10, MT: 4, NE: 5, NV: 6, NH: 4, NJ: 14, NM: 5, NY: 28, NC: 16, ND: 3, OH: 17, OK: 7, OR: 8, PA: 19, RI: 4, SC: 9, SD: 3, TN: 11, TX: 40, UT: 6, VT: 3, VA: 13, WA: 12, WV: 4, WI: 10, WY: 3, DC: 3 };
const elections = {
  "1980": { date: "1980-11-04", nominees: { Democratic: "Jimmy Carter", Republican: "Ronald Reagan" } },
  "1984": { date: "1984-11-06", nominees: { Democratic: "Walter Mondale", Republican: "Ronald Reagan" } },
  "1988": { date: "1988-11-08", nominees: { Democratic: "Michael Dukakis", Republican: "George H. W. Bush" } },
  "1992": { date: "1992-11-03", nominees: { Democratic: "Bill Clinton", Republican: "George H. W. Bush" } },
  "1996": { date: "1996-11-05", nominees: { Democratic: "Bill Clinton", Republican: "Bob Dole" } },
  "2000": { date: "2000-11-07", nominees: { Democratic: "Al Gore", Republican: "George W. Bush" } },
  "2004": { date: "2004-11-02", nominees: { Democratic: "John Kerry", Republican: "George W. Bush" } },
  "2008": { date: "2008-11-04", nominees: { Democratic: "Barack Obama", Republican: "John McCain" } },
  "2012": { date: "2012-11-06", nominees: { Democratic: "Barack Obama", Republican: "Mitt Romney" } },
  "2016": { date: "2016-11-08", nominees: { Democratic: "Hillary Clinton", Republican: "Donald Trump" } },
  "2020": { date: "2020-11-03", nominees: { Democratic: "Joe Biden", Republican: "Donald Trump" } },
  "2024": { date: "2024-11-05", nominees: { Democratic: "Kamala Harris", Republican: "Donald Trump" } }
};

const csv = (text) => {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += char; i += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) rows.push([...row, field]);
  const [headers, ...body] = rows;
  return body.filter((values) => values.length === headers.length).map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index]])));
};

const mapCoordinates = (coordinates, transform) => Array.isArray(coordinates[0])
  ? coordinates.map((item) => mapCoordinates(item, transform))
  : transform(coordinates);

const displayCoordinate = (id, [longitude, latitude]) => {
  // Keep Alaska near the north-west mainland, compact enough for a national map.
  if (id === "AK") return [-144.4456 + (longitude + 159.4456) * 0.55, 58.4822 + (latitude - 61.4822) * 0.55];
  // Hawaii is the sole display inset, below Alaska and west of the mainland.
  if (id === "HI") return [longitude + 18, latitude + 20];
  return [longitude, latitude];
};

const allCoordinates = (coordinates, output = []) => {
  if (Array.isArray(coordinates[0])) coordinates.forEach((item) => allCoordinates(item, output));
  else output.push(coordinates);
  return output;
};

const center = (geometry) => {
  const points = allCoordinates(geometry.coordinates);
  const [west, south, east, north] = points.reduce(([w, s, e, n], [x, y]) => [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)], [Infinity, Infinity, -Infinity, -Infinity]);
  return [Number(((west + east) / 2).toFixed(4)), Number(((south + north) / 2).toFixed(4))];
};

const stable = (value) => JSON.stringify(value, null, 2) + "\n";
const writeIfChanged = async (name, value) => {
  const target = dataPath(name), next = stable(value);
  let previous = "";
  try { previous = await readFile(target, "utf8"); } catch { /* first build */ }
  if (previous === next) return false;
  await writeFile(target, next);
  return true;
};

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
};
const fetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
};

await mkdir(dataPath("."), { recursive: true });
const [sourceGeometry, resultsCsv, historicalResultsCsv] = await Promise.all([
  fetchJson(GEOMETRY_URL),
  ...(geometryOnly ? [null, null] : [fetchText(RESULTS_URL), fetchText(HISTORICAL_RESULTS_URL)])
]);
const features = sourceGeometry.features
  .filter((feature) => states[feature.properties.STUSPS])
  .map((feature) => {
    const id = feature.properties.STUSPS;
    const geometry = { ...feature.geometry, coordinates: mapCoordinates(feature.geometry.coordinates, (coordinate) => displayCoordinate(id, coordinate)) };
    return { type: "Feature", id, properties: { id, name: states[id][0] }, geometry };
  })
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name));

const stateMeta = features.map((feature) => {
  const id = feature.id;
  return { id, iso: `US-${id}`, name: states[id][0], capital: states[id][1], center: center(feature.geometry), flag: id.toLowerCase(), electoralVotes: electoralVotes[id], nextElection: { date: "2026-11-03", label: "3 Nov 2026", official: true } };
});

const partyName = (ballotParty) => ({ DEM: "Democratic", REP: "Republican", GRE: "Green", LIB: "Libertarian", IND: "Independent" }[ballotParty] || "Independent / minor party");
const titleName = (name) => name.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\bH\. W\./g, "H. W.").replace(/""/g, '"');
const nameCase = (name) => (name.includes(",") ? name.split(",").reverse().map((part) => titleName(part.trim())).join(" ") : titleName(name));
const historicalParty = (party) => ({ DEMOCRAT: "DEM", REPUBLICAN: "REP", LIBERTARIAN: "LIB", GREEN: "GRE", INDEPENDENT: "IND" }[party] || "OTHER");
const surname = (name = "") => name.toLowerCase().match(/[a-z]+/g)?.at(-1);
const resultParty = (row, major) => {
  if (["DEM", "REP"].includes(row.ballot_party)) return partyName(row.ballot_party);
  return partyName(major.find((item) => surname(item.candidate_name) === surname(row.candidate_name))?.ballot_party || row.ballot_party);
};
const combineResults = (rows, election, major) => {
  const groups = new Map();
  for (const row of rows) {
    const party = resultParty(row, major), candidate = election.nominees[party] || row.candidate_name;
    const entry = groups.get(party) || { party, candidate, value: 0, votes: 0 };
    entry.value += Number(row.percent);
    entry.votes += Number(row.votes);
    if (entry.candidate !== candidate) entry.candidate = null;
    groups.set(party, entry);
  }
  return [...groups.values()].map((item) => ({ ...item, value: Number(item.value.toFixed(1)) }));
};
let electionHistory;
if (!geometryOnly) {
  const allElectionRows = [
    ...csv(resultsCsv).filter((row) => Number(row.cycle) >= 2008 && elections[row.cycle] && row.stage === "general" && states[row.state_abbrev] && Number(row.votes)),
    ...csv(historicalResultsCsv)
      .filter((row) => elections[row.year] && Number(row.year) < 2008 && states[row.state_po] && row.writein !== "TRUE" && Number(row.candidatevotes))
      .map((row) => ({ cycle: row.year, state_abbrev: row.state_po, ballot_party: historicalParty(row.party_simplified), candidate_name: nameCase(row.candidate), votes: Number(row.candidatevotes), percent: Number(row.candidatevotes) / Number(row.totalvotes) * 100, source: "https://doi.org/10.7910/DVN/42MVDX" }))
  ];
  electionHistory = Object.fromEntries(Object.entries(elections).map(([year, election]) => [year, {
    ...election,
    states: Object.fromEntries(Object.keys(states).sort().map((id) => {
      const rows = allElectionRows.filter((row) => row.cycle === year && row.state_abbrev === id);
      const major = rows.filter((row) => ["DEM", "REP"].includes(row.ballot_party));
      if (major.length !== 2) throw new Error(`Missing major-party result for ${id} in ${year}`);
      const namedMinor = rows.filter((row) => !["DEM", "REP"].includes(row.ballot_party) && row.candidate_name && Number(row.percent) >= 0.35);
      const shown = combineResults([...major, ...namedMinor], election, major);
      const remainder = Number((100 - shown.reduce((sum, row) => sum + row.value, 0)).toFixed(1));
      const source = rows.find((row) => row.source)?.source || "https://www.fec.gov/resources/cms-content/documents/2024presgeresults.pdf";
      return [id, { source, results: [...shown, ...(remainder >= 0.1 ? [{ party: "Other candidates & write-ins", value: remainder }] : [])].sort((a, b) => b.value - a.value) }];
    }))
  }]));
}

const nationalPolls = {
  snapshotDate: "2026-09-14",
  methodology: "National generic-ballot polling is shown separately and is never assigned to individual states.",
  polls: [{ pollster: "The Economist / YouGov", date: "2026-09-14", population: "Likely voters", question: "2026 generic congressional ballot", source: "https://yougov.com/en-us/content/the-economist", results: [{ party: "Democratic", value: 51 }, { party: "Republican", value: 39 }, { party: "Other / undecided", value: 10 }] }]
};

const changed = await Promise.all([
  writeIfChanged("states.geojson", { type: "FeatureCollection", features }),
  writeIfChanged("states-meta.json", stateMeta),
  ...(geometryOnly ? [] : [
    writeIfChanged("election-history.json", { methodology: "Statewide popular-vote shares. Maine and Nebraska district allocations are not used for state colouring. Each state has one result per party: cross-endorsed Democratic and Republican ballot lines are merged with their nominee; other minor and independent lines are grouped when the source does not identify a party.", elections: electionHistory }),
    writeIfChanged("national-polls.json", nationalPolls)
  ])
]);
console.log(changed.some(Boolean) ? "Updated local data files." : "Local data already current.");
