// Helpers
const byId = id => document.getElementById(id);
const isCandidate = place => !place.type;
const allPlaces = () => attractions.concat(candidates);
const clamp01 = value => Math.max(0, Math.min(1, value));
const scoreToClass = score => Math.min(4, Math.floor(score * classNames.length));
const formatPercent = fraction => (fraction * 100).toFixed(1) + '%';
const distanceKm = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / PX_PER_KM;
const latitudeOf = point => (ORIGIN_LATITUDE - (point.y - GRID_TOP) * DEGREES_PER_PX).toFixed(4);
const longitudeOf = point => (ORIGIN_LONGITUDE + (point.x - GRID_LEFT) * DEGREES_PER_PX).toFixed(4);
const classColor = level => (level === EXCLUDED_CLASS ? EXCLUDED_COLOR : classColors[level]);
const swatch = color => `<span class="inline-block size-2.5 rounded-full border border-mist shrink-0" style="background:${color}"></span>`;

function createSvgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  for (const name in attributes) element.setAttribute(name, attributes[name]);
  return element;
}

function distanceToSegmentPx(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const position = clamp01(((point.x - start[0]) * dx + (point.y - start[1]) * dy) / (dx * dx + dy * dy));
  return Math.hypot(point.x - (start[0] + position * dx), point.y - (start[1] + position * dy));
}

function distanceToNearestRoadKm(point) {
  let shortest = Infinity;
  roads.forEach(road => {
    for (let i = 0; i < road.points.length - 1; i++) {
      shortest = Math.min(shortest, distanceToSegmentPx(point, road.points[i], road.points[i + 1]));
    }
  });
  return shortest / PX_PER_KM;
}

function findNearest(items, point) {
  let nearest = null;
  items.forEach(item => {
    const km = distanceKm(point, item);
    if (!nearest || km < nearest.km) nearest = { name: item.name, km: km };
  });
  return nearest;
}

// Barangay worked out from where the point was clicked (row 0 is the south half)
function barangayAt(point) {
  const row = point.y < BRGY_Y_SPLIT ? 1 : 0;
  const col = point.x < BRGY_X_SPLITS[0] ? 0 : point.x < BRGY_X_SPLITS[1] ? 1 : 2;
  return 'Brgy. ' + BRGY_NAMES[row][col];
}

// Legend text for one class of a criterion, e.g. "Within 1.6 km"
function classRangeLabel(criterion, classIndex) {
  const step = criterion.max / classNames.length;
  const round = value => +value.toFixed(1);
  const isLastClass = classIndex === classNames.length - 1;

  if (criterion.direction === 'up') {
    const low = classIndex * step;
    return (isLastClass ? 'Above ' + round(low) : round(low) + '–' + round(low + step)) + criterion.unit;
  }
  const high = criterion.max - classIndex * step;
  if (classIndex === 0) return 'Over ' + round(high - step) + criterion.unit;
  if (isLastClass) return 'Within ' + round(high) + criterion.unit;
  return round(high - step) + '–' + round(high) + criterion.unit;
}

// Suitability
byId('land').setAttribute('points', LAND_POINTS);
byId('landClipShape').setAttribute('points', LAND_POINTS);

function createCell(row, col) {
  const center = { x: GRID_LEFT + (col + 0.5) * CELL_WIDTH, y: GRID_TOP + (row + 0.5) * CELL_HEIGHT };
  const landCoverType = LAND_COVER_TYPES[Math.floor((1 + Math.sin(row * 1.3 + col * 0.9)) / 2 * 3.99)];

  const cell = {
    id: 'cell-' + String(row * GRID_COLUMNS + col + 1).padStart(3, '0'),
    row: row,
    col: col,
    landCover: landCoverType.name,
    elevation: 1 + row * 2.2 + 2.5 * (1 + Math.sin(col * 0.8 + row * 0.5)),
    slope: 0.5 + 3.5 * (1 + Math.sin(row * 0.9 + col * 0.4)),
    roadKm: distanceToNearestRoadKm(center),
    attractionKm: findNearest(attractions, center).km,
    terminalKm: findNearest(terminals, center).km,
    facilityKm: findNearest(facilities, center).km,
    sensitive: row <= 1 && [2, 3, 6, 7].includes(col)
  };
  cell.scores = {
    landCover: landCoverType.score,
    elevation: clamp01(cell.elevation / MAX_ELEVATION_M),
    slope: clamp01(1 - cell.slope / MAX_SLOPE_DEG),
    road: clamp01(1 - cell.roadKm / MAX_DISTANCE_KM),
    attraction: clamp01(1 - cell.attractionKm / MAX_DISTANCE_KM)
  };
  // Accessibility is shown on its own and is not part of the suitability total
  cell.scores.access = (cell.scores.road + clamp01(1 - cell.terminalKm / MAX_DISTANCE_KM) + clamp01(1 - cell.facilityKm / MAX_DISTANCE_KM)) / 3;
  cell.total = criteria.reduce((sum, criterion) => sum + cell.scores[criterion.key] * criterion.weight, 0);
  return cell;
}

function drawCell(cell) {
  const x = GRID_LEFT + cell.col * CELL_WIDTH;
  const y = GRID_TOP + cell.row * CELL_HEIGHT;

  cell.rect = createSvgElement('rect', { x: x, y: y, width: CELL_WIDTH, height: CELL_HEIGHT, stroke: '#1e1e1e', 'stroke-width': 1, 'fill-opacity': 0.75 });
  byId('layer-suitability').appendChild(cell.rect);

  if (cell.sensitive) {
    byId('layer-constraints').appendChild(createSvgElement('rect', {
      x: x + 3, y: y + 3, width: CELL_WIDTH - 6, height: CELL_HEIGHT - 6,
      fill: 'none', stroke: '#f14c4c', 'stroke-width': 2, 'stroke-dasharray': '4 3'
    }));
  }
}

const cells = [];
for (let row = 0; row < GRID_ROWS; row++) {
  for (let col = 0; col < GRID_COLUMNS; col++) {
    const cell = createCell(row, col);
    drawCell(cell);
    cells.push(cell);
  }
}

// Total scores are split into 5 equal classes between the lowest and highest non-sensitive cell
const usableTotals = cells.filter(cell => !cell.sensitive).map(cell => cell.total);
const minTotal = Math.min(...usableTotals);
const maxTotal = Math.max(...usableTotals);

function totalToClass(total) {
  const share = (total - minTotal) / (maxTotal - minTotal);
  return Math.min(4, Math.max(0, Math.floor(share * classNames.length)));
}

function totalRangeLabel(classIndex) {
  const toPercent = index => Math.round((minTotal + (maxTotal - minTotal) * index / classNames.length) * 100);
  return toPercent(classIndex) + '–' + toPercent(classIndex + 1) + '%';
}

function cellAt(point) {
  const col = Math.floor((point.x - GRID_LEFT) / CELL_WIDTH);
  const row = Math.floor((point.y - GRID_TOP) / CELL_HEIGHT);
  return cells.find(cell => cell.row === row && cell.col === col);
}

const suitabilityLevel = cell => (cell.sensitive ? EXCLUDED_CLASS : totalToClass(cell.total));

// `mode` is 'total' or a criterion key
function classForMode(cell, mode) {
  if (mode === 'total') return suitabilityLevel(cell);
  return scoreToClass(cell.scores[mode]);
}

function paintCells(mode) {
  cells.forEach(cell => cell.rect.setAttribute('fill', classColor(classForMode(cell, mode))));
}

// Map
let drag = null;      // set while the pointer is down on the map
let isAddingSpot = false;
let newSpotPoint = null;
let newSpotBrgy = null;

roads.forEach(road => {
  byId('layer-roads').appendChild(createSvgElement('polyline', {
    points: road.points.join(' '),
    'stroke-dasharray': road.type === 'Gravel' ? '8 5' : 'none'
  }));
});

function createMapLabel(text, y, fontSize) {
  const label = createSvgElement('text', {
    y: y, 'text-anchor': 'middle', 'font-size': fontSize, 'font-weight': '600',
    fill: '#d4d4d4', stroke: '#1e1e1e', 'stroke-width': 3, 'paint-order': 'stroke'
  });
  label.textContent = text;
  return label;
}

function createMarkerShape(place) {
  if (isCandidate(place)) {
    return createSvgElement('rect', { x: -8, y: -8, width: 16, height: 16, transform: 'rotate(45)', fill: '#d9a441', stroke: '#1e1e1e', 'stroke-width': 2 });
  }
  return createSvgElement('circle', { r: 8, fill: typeColors[place.type], stroke: '#1e1e1e', 'stroke-width': 2 });
}

const markers = [];
function addMarker(place) {
  const group = createSvgElement('g', {
    transform: `translate(${place.x} ${place.y})`, tabindex: 0, role: 'button', 'class': 'cursor-pointer focus:outline-none'
  });
  group.appendChild(createMarkerShape(place));
  group.appendChild(createMapLabel(place.name, 22, 12));

  group.addEventListener('click', () => {
    const wasDragged = drag && drag.moved;
    if (isAddingSpot || wasDragged) return;
    showPlace(place);
  });
  group.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    showPlace(place);
  });

  byId(isCandidate(place) ? 'layer-candidates' : 'layer-attractions').appendChild(group);
  markers.push({ place: place, group: group });
}
allPlaces().forEach(addMarker);

terminals.forEach(terminal => {
  const group = createSvgElement('g', { transform: `translate(${terminal.x} ${terminal.y})` });
  group.appendChild(createSvgElement('rect', { x: -6, y: -6, width: 12, height: 12, fill: '#d4d4d4', stroke: '#1e1e1e', 'stroke-width': 2 }));
  group.appendChild(createMapLabel(terminal.name, -12, 11));
  byId('layer-access').appendChild(group);
});

facilities.forEach(facility => {
  const group = createSvgElement('g', { transform: `translate(${facility.x} ${facility.y})` });
  group.appendChild(createSvgElement('polygon', { points: '0,-6 6,5 -6,5', fill: '#6a6a6a', stroke: '#1e1e1e', 'stroke-width': 1.5 }));
  group.appendChild(createMapLabel(facility.name, 18, 10));
  byId('layer-access').appendChild(group);
});

// Layers
// `mode`: what the grid shows ('total', a criterion key, or null for no grid)
// `lists`: which place lists appear in the right panel
// `layers`: which map layers are switched on
const criterionViewExtraLayers = { road: ['roads', 'access'], attraction: ['attractions'] };

const overviewViews = [
  { id: 'all', tab: 'all', label: 'All Layers', mode: 'total', lists: ['candidate', 'attraction'],
    layers: ['suitability', 'constraints', 'roads', 'attractions', 'candidates'],
    text: 'Integrated view: final suitability analysis, constraints, transportation infrastructure, attractions, and potential sites.' },
  { id: 'spots', tab: 'spots', label: 'Existing Tourism Spots', mode: null, lists: ['attraction'],
    layers: ['attractions', 'barangays'],
    text: 'Mapped attractions by type. Use Add spot to suggest a new one.' },
  { id: 'eco', tab: 'eco', label: 'Ecotourism Suitability', mode: 'total', lists: ['candidate'],
    layers: ['suitability', 'constraints', 'candidates'],
    text: 'Final suitability from weighted spatial criteria with sensitive environmental zones excluded.' },
  { id: 'access', tab: 'access', label: 'Accessibility', mode: 'access', lists: ['attraction'],
    layers: ['suitability', 'roads', 'access', 'attractions'],
    text: 'How accessible each area is, based on its distance to roads, transportation terminals, and public facilities. Select a place to see its nearest road, terminal, and facility.' },
  { id: 'sites', tab: 'sites', label: 'Potential Sites', mode: null, lists: ['candidate'],
    layers: ['candidates', 'barangays'],
    text: 'Potential ecotourism sites ranked by suitability. Select one to inspect validation status and accessibility.' }
];

const criterionViews = criteria.map(criterion => ({
  id: criterion.key,
  tab: 'eco',
  label: criterion.viewLabel,
  mode: criterion.key,
  lists: [],
  layers: ['suitability'].concat(criterionViewExtraLayers[criterion.key] || []),
  text: criterion.description + ' Colored grid values show score tiering.'
}));

const views = overviewViews.concat(criterionViews);
let currentView = views[0];

// [layer id, label, icon shown next to the checkbox]
const layerCheckboxes = [
  ['attractions', 'Tourism Spots', swatch(typeColors['Natural'])],
  ['candidates', 'Potential Sites', '<span class="inline-block size-2 bg-silt rotate-45"></span>'],
  ['suitability', 'Suitability Grid', '<span class="inline-block w-4 h-2.5 rounded-sm" style="background:linear-gradient(90deg,#efe3c6,#97c179,#1d6a4a)"></span>'],
  ['constraints', 'Sensitive Areas', '<span class="inline-block size-3 border-2 border-dashed border-danger"></span>'],
  ['roads', 'Road Network', '<span class="inline-block w-4 border-t-[3px] border-[#6a6a6a]"></span>'],
  ['access', 'Terminals & Facilities', '<span class="inline-block size-2.5 bg-ink"></span>'],
  ['barangays', 'Barangay Boundaries', '<span class="inline-block w-4 border-t-2 border-dashed border-ink/70"></span>']
];

layerCheckboxes.forEach(([layerName, label, icon]) => {
  byId('layerBoxes').insertAdjacentHTML('beforeend',
    '<label class="flex cursor-pointer select-none items-center gap-3 py-1.5 text-ink/80 hover:text-white">' +
      `<span class="flex w-5 shrink-0 justify-center">${icon}</span>` +
      `<span class="flex-1">${label}</span>` +
      `<input type="checkbox" data-layer="${layerName}" class="peer sr-only">` +
      '<span class="relative h-[18px] w-8 rounded-full bg-line transition-colors peer-checked:bg-mangrove peer-focus-visible:outline-2 peer-focus-visible:outline-accent-light after:absolute after:left-0.5 after:top-0.5 after:size-3.5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-3.5"></span>' +
    '</label>');
});

const layerCheckbox = layerName => document.querySelector(`[data-layer="${layerName}"]`);
const isLayerOn = layerName => layerCheckbox(layerName).checked;
const showLayer = (layerName, visible) => byId('layer-' + layerName).classList.toggle('hidden', !visible);

document.querySelectorAll('[data-layer]').forEach(checkbox => {
  checkbox.addEventListener('change', () => {
    showLayer(checkbox.dataset.layer, checkbox.checked);
    renderLegend();
    applyAttractionFilter();
  });
});

Object.keys(typeColors).forEach(type => {
  byId('typeBoxes').insertAdjacentHTML('beforeend',
    '<label class="cursor-pointer select-none">' +
      `<input type="checkbox" data-type="${type}" checked class="peer sr-only">` +
      `<span class="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-ink/40 transition-colors hover:text-white peer-checked:border-ink/30 peer-checked:bg-surface peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-accent-light">${swatch(typeColors[type])}${type}</span>` +
    '</label>');
  byId('spotType').insertAdjacentHTML('beforeend', `<option>${type}</option>`);
});

const typeCheckbox = type => document.querySelector(`[data-type="${type}"]`);
const checkedTypes = () => Array.from(document.querySelectorAll('[data-type]:checked')).map(box => box.dataset.type);

function applyAttractionFilter() {
  const visibleTypes = checkedTypes();
  byId('typeSection').classList.toggle('hidden', !isLayerOn('attractions'));
  markers.forEach(marker => {
    if (isCandidate(marker.place)) return;
    marker.group.classList.toggle('hidden', !visibleTypes.includes(marker.place.type));
  });
  renderPlaces();
}
document.querySelectorAll('[data-type]').forEach(checkbox => checkbox.addEventListener('change', applyAttractionFilter));

// Top menu: one tab per main view. The Suitability tab has a "Show by" dropdown for its factors.
const tabs = [
  { id: 'all', label: 'Overview' },
  { id: 'spots', label: 'Tourism Spots' },
  { id: 'eco', label: 'Suitability' },
  { id: 'access', label: 'Accessibility' },
  { id: 'sites', label: 'Potential Sites' }
];
byId('nav').innerHTML = tabs.map(tab => `<button data-tab="${tab.id}" class="cursor-pointer whitespace-nowrap border-b-2 border-transparent py-3 text-sm font-medium text-ink/60 transition-colors hover:text-white aria-[current=true]:border-mangrove aria-[current=true]:text-white">${tab.label}</button>`).join('');
document.querySelectorAll('#nav button').forEach(button => {
  button.addEventListener('click', () => openView(button.dataset.tab));
});

const factorViews = [{ id: 'eco', label: 'Overall suitability' }].concat(criterionViews);
byId('factorSelect').innerHTML = factorViews.map(view => `<option value="${view.id}">${view.label}</option>`).join('');
byId('factorSelect').addEventListener('change', () => openView(byId('factorSelect').value));

function openView(viewId) {
  currentView = views.find(view => view.id === viewId);

  document.querySelectorAll('#nav button').forEach(button => {
    button.setAttribute('aria-current', button.dataset.tab === currentView.tab);
  });
  byId('viewText').textContent = currentView.text;
  byId('factorBox').classList.toggle('hidden', currentView.tab !== 'eco');
  byId('factorSelect').value = currentView.id;

  document.querySelectorAll('[data-layer]').forEach(checkbox => {
    checkbox.checked = currentView.layers.includes(checkbox.dataset.layer);
    showLayer(checkbox.dataset.layer, checkbox.checked);
  });

  paintCells(currentView.mode || 'total');
  renderLegend();
  renderSummary();
  applyAttractionFilter();

  // Views without a place list only use the Details tab
  const hasLists = currentView.lists.length > 0;
  byId('panelTabPlaces').classList.toggle('hidden', !hasLists);
  showPanelTab(hasLists ? 'places' : 'detail');
}

// Legend, Summary and Places
const currentCriterion = () => criteria.find(criterion => criterion.key === currentView.mode);

function legendRow(icon, text) {
  return `<li class="flex items-center gap-2 py-0.5">${icon}<span class="text-xs text-ink/80">${text}</span></li>`;
}

function suitabilityLegendRows() {
  const criterion = currentCriterion();
  if (currentView.mode === 'access') {
    return classNames.map((name, i) => legendRow(swatch(classColors[i]), name + ' accessibility'));
  }
  if (currentView.mode === 'landCover') {
    return LAND_COVER_TYPES.map(type => legendRow(swatch(classColors[scoreToClass(type.score)]), type.name));
  }
  const rows = classNames.map((name, i) => {
    const range = criterion ? classRangeLabel(criterion, i) : totalRangeLabel(i);
    return legendRow(swatch(classColors[i]), name + ': ' + range);
  });
  if (!criterion) rows.push(legendRow(swatch(EXCLUDED_COLOR), 'Excluded sensitive area'));
  return rows;
}

function renderLegend() {
  const rows = [];
  if (isLayerOn('suitability')) rows.push(...suitabilityLegendRows());
  if (isLayerOn('constraints')) {
    rows.push(legendRow('<span class="inline-block size-3 border-2 border-dashed border-danger shrink-0"></span>', 'Sensitive area boundary'));
  }
  if (isLayerOn('roads')) {
    rows.push(legendRow('<span class="inline-block w-4 border-t-[3px] border-[#6a6a6a]"></span>', 'Asphalt road'));
    rows.push(legendRow('<span class="inline-block w-4 border-t-[3px] border-dashed border-[#6a6a6a]"></span>', 'Gravel road'));
  }
  if (isLayerOn('access')) {
    rows.push(legendRow('<span class="inline-block size-2.5 bg-ink border border-panel shrink-0"></span>', 'Terminal'));
    rows.push(legendRow('<span class="inline-block size-2.5 bg-[#6a6a6a] shrink-0" style="clip-path:polygon(50% 0,100% 100%,0 100%)"></span>', 'Public facility'));
  }
  if (isLayerOn('candidates')) {
    rows.push(legendRow('<span class="inline-block size-2 bg-silt rotate-45 shrink-0"></span>', 'Potential site'));
  }
  if (isLayerOn('attractions')) {
    Object.keys(typeColors).forEach(type => rows.push(legendRow(swatch(typeColors[type]), type)));
  }
  byId('legend').innerHTML = rows.join('') || '<li class="text-ink/60 italic text-xs">No active map layers.</li>';
}

// Rows are { color, name, value }

// Suitability Summary: number of grid cells in each suitability class, highest class first.
// In production these counts come from the suitability result exported from QGIS;
// the prototype counts them from the simulated grid.
function suitabilitySummaryRows() {
  const counts = new Array(classNames.length).fill(0);
  cells.forEach(cell => {
    const level = suitabilityLevel(cell);
    if (level < classNames.length) counts[level]++;   // sensitive (excluded) cells are not classed
  });
  return classNames
    .map((name, i) => ({ color: classColors[i], name: name, value: counts[i] }))
    .reverse();
}

function attractionSummaryRows() {
  return Object.keys(typeColors).map(type => ({
    color: typeColors[type],
    name: type,
    value: attractions.filter(attraction => attraction.type === type).length
  }));
}

function candidateSummaryRows() {
  const validated = candidates.filter(site => site.checks.indexOf(0) === -1).length;
  return [
    { color: '#97c179', name: 'Validated', value: validated },
    { color: '#d9a441', name: 'Pending', value: candidates.length - validated }
  ];
}

function renderSummary() {
  const showingSuitability = currentView.mode !== null;
  const candidateOnly = !showingSuitability && currentView.lists.length === 1 && currentView.lists[0] === 'candidate';
  byId('summaryTitle').textContent = showingSuitability ? 'Suitability Summary'
    : candidateOnly ? 'Potential sites by validation status' : 'Attractions distribution';

  const rows = showingSuitability ? suitabilitySummaryRows() : candidateOnly ? candidateSummaryRows() : attractionSummaryRows();
  byId('stats').innerHTML = rows.map(row =>
    `<tr><td class="py-2"><span class="flex items-center gap-2">${swatch(row.color)}<span class="font-medium">${row.name}</span></span></td>` +
    `<td class="text-right font-semibold text-white">${row.value}</td></tr>`
  ).join('');
}

function validationStatus(site) {
  const firstMissingCheck = site.checks.indexOf(0);
  if (firstMissingCheck === -1) return 'Validated';
  return 'Pending: ' + VALIDATION_CHECKS[firstMissingCheck].toLowerCase();
}

function candidateSubtitle(site) {
  const cell = cellAt(site);
  if (!cell) return validationStatus(site);
  const level = suitabilityLevel(cell);
  const levelName = level === EXCLUDED_CLASS ? 'Excluded' : classNames[level];
  return `<span class="inline-flex items-center gap-1.5">${swatch(classColor(level))}${levelName} · ${validationStatus(site)}</span>`;
}

function placeSubtitle(place) {
  if (isCandidate(place)) return candidateSubtitle(place);
  return place.type + (place.pending ? ' · Pending Review' : '');
}

// Used to rank candidate sites; sites outside the grid or in sensitive cells go last
function suitabilityTotalAt(place) {
  const cell = cellAt(place);
  return cell && !cell.sensitive ? cell.total : -1;
}

function placesForList(listKind, searchText, visibleTypes) {
  const places = allPlaces().filter(place =>
    (listKind === 'candidate') === isCandidate(place) &&
    place.name.toLowerCase().includes(searchText) &&
    (isCandidate(place) || visibleTypes.includes(place.type))
  );
  if (listKind === 'candidate') places.sort((a, b) => suitabilityTotalAt(b) - suitabilityTotalAt(a));
  return places;
}

function placeButtonHtml(place) {
  return `<li><button data-i="${allPlaces().indexOf(place)}" class="group w-full cursor-pointer rounded-xl bg-surface p-3 text-left ring-1 ring-line transition hover:bg-hover hover:ring-mangrove/60">` +
    `<span class="block font-semibold text-white text-xs group-hover:text-accent-light">${place.name}</span>` +
    `<span class="block text-[11px] text-ink/70 mt-0.5">${placeSubtitle(place)}</span></button></li>`;
}

function placeListHtml(listKind, searchText, visibleTypes) {
  const places = placesForList(listKind, searchText, visibleTypes);
  const title = listKind === 'candidate' ? 'Potential ecotourism sites' : 'Tourism attractions';
  return `<div><h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink/50">${title} (${places.length})</h3>` +
    `<ul class="space-y-1.5">${places.map(placeButtonHtml).join('')}</ul></div>`;
}

function renderPlaces() {
  const searchText = '';
  const visibleTypes = checkedTypes();
  byId('places').innerHTML = currentView.lists.map(listKind => placeListHtml(listKind, searchText, visibleTypes)).join('');

  document.querySelectorAll('#places [data-i]').forEach(button => {
    button.addEventListener('click', () => showPlace(allPlaces()[button.dataset.i]));
  });
}

// Search

// Search box in the header: type a name, barangay, or type, then pick a result
function renderSearchResults() {
  const text = byId('search').value.trim().toLowerCase();
  const box = byId('searchResults');
  const matches = text === '' ? [] : allPlaces().filter(place =>
    (place.name + ' ' + place.brgy + ' ' + (place.type || 'potential site')).toLowerCase().includes(text)).slice(0, 6);

  box.classList.toggle('hidden', text === '');
  box.innerHTML = matches.length
    ? matches.map(place => `<li><button data-i="${allPlaces().indexOf(place)}" class="w-full text-left px-3 py-2 hover:bg-hover cursor-pointer">` +
        `<span class="block font-semibold text-white text-xs">${place.name}</span>` +
        `<span class="block text-[11px] text-ink/70 mt-0.5">${isCandidate(place) ? 'Potential site' : place.type} · ${place.brgy}</span></button></li>`).join('')
    : '<li class="px-3 py-2 text-xs text-ink/60">No places found</li>';
  box.querySelectorAll('[data-i]').forEach(button => button.addEventListener('click', () => pickSearchResult(allPlaces()[button.dataset.i])));
}

// Make sure the chosen place is visible on the map, then show it
function pickSearchResult(place) {
  byId('search').value = '';
  byId('searchResults').classList.add('hidden');

  const layerName = isCandidate(place) ? 'candidates' : 'attractions';
  if (!isLayerOn(layerName)) {
    document.querySelector(`[data-layer="${layerName}"]`).checked = true;
    showLayer(layerName, true);
  }
  const typeBox = place.type && document.querySelector(`[data-type="${place.type}"]`);
  if (typeBox && !typeBox.checked) typeBox.checked = true;
  applyAttractionFilter();
  renderLegend();
  showPlace(place);
}

byId('search').addEventListener('input', renderSearchResults);
byId('search').addEventListener('keydown', event => {
  if (event.key === 'Enter') { const first = byId('searchResults').querySelector('[data-i]'); if (first) first.click(); }
  if (event.key === 'Escape') byId('searchResults').classList.add('hidden');
});
document.addEventListener('click', event => {
  if (!event.target.closest('#searchBox')) byId('searchResults').classList.add('hidden');
});

// Details Inspector and Accessibility
function placeBadgesHtml(place) {
  if (!isCandidate(place)) {
    const pendingBadge = place.pending
      ? ' <span class="inline-block rounded-full bg-silt/20 border border-silt/40 text-silt px-2 py-0.5 text-[10px] font-medium">Pending Review</span>'
      : '';
    return `<span class="inline-block rounded-full bg-surface border border-line/80 px-2.5 py-0.5 text-[11px] text-white font-medium">${place.type}</span>${pendingBadge}`;
  }
  const status = validationStatus(place);
  const colors = status === 'Validated' ? 'bg-mangrove/20 text-accent-light border border-mangrove/40' : 'bg-silt/20 text-silt border border-silt/40';
  return `<span class="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${colors}">${status}</span>`;
}

function validationChecklistHtml(place) {
  if (!isCandidate(place)) return '';
  const items = VALIDATION_CHECKS.map((name, i) => {
    const done = place.checks[i];
    return `<li class="flex items-center gap-1.5 text-ink/80"><span class="${done ? 'text-[#97c179] font-bold' : 'text-ink/40'}">${done ? '✓' : '○'}</span>${name}</li>`;
  }).join('');
  return `<div><p class="font-semibold text-white mb-1">Validation Checklist</p><ul class="space-y-0.5 text-[11px]">${items}</ul></div>`;
}

function criterionRowHtml(cell, criterion) {
  const score = cell.scores[criterion.key];
  return '<tr class="border-b border-line/30">' +
    `<td class="py-1 text-ink/80"><span class="flex items-center gap-1.5">${swatch(classColors[scoreToClass(score)])}${criterion.shortName}</span></td>` +
    `<td class="text-ink/60">${criterion.displayValue(cell)}</td>` +
    `<td class="text-right text-white font-mono">${score.toFixed(2)}</td>` +
    `<td class="text-right text-ink/60 font-mono">${Math.round(criterion.weight * 100)}%</td>` +
    `<td class="text-right text-accent-light font-mono font-medium">${(score * criterion.weight).toFixed(3)}</td></tr>`;
}

function suitabilityBlockHtml(cell) {
  if (!cell) return '<p class="text-ink/60 italic text-xs">Outside the study grid matrix; no suitability score.</p>';

  const level = suitabilityLevel(cell);
  const headline = cell.sensitive ? 'Excluded: Sensitive Zone' : `${classNames[level]} (${formatPercent(cell.total)})`;
  const sensitiveWarning = cell.sensitive
    ? '<p class="rounded-lg bg-danger/10 border border-danger/40 p-2 text-danger text-[11px]">Located in a sensitive environmental zone. Further planning assessment required.</p>'
    : '';
  const criterionRows = criteria.map(criterion => criterionRowHtml(cell, criterion)).join('');

  return '<div class="space-y-1.5">' +
    `<p class="flex items-center gap-2 text-xs">${swatch(classColor(level))}<span class="text-ink/70">Suitability Rank:</span> <span class="font-bold text-white">${headline}</span></p>` +
    sensitiveWarning +
    '<div class="overflow-x-auto"><table class="w-full text-[11px]">' +
      '<thead class="text-ink/50 text-left border-b border-line/80"><tr><th class="py-1 font-semibold">Criterion</th><th class="font-semibold">Value</th><th class="text-right font-semibold">Score</th><th class="text-right font-semibold">Weight</th><th class="text-right font-semibold">Result</th></tr></thead>' +
      `<tbody>${criterionRows}</tbody>` +
      `<tfoot><tr class="font-semibold text-white"><td colspan="4" class="pt-2">Total Index (${cell.id})</td><td class="text-right pt-2 font-mono text-accent-light">${cell.total.toFixed(3)}</td></tr></tfoot>` +
    '</table></div></div>';
}

function accessibilityBlockHtml(place) {
  const cell = cellAt(place);
  const areaAccessibility = cell ? classNames[scoreToClass(cell.scores.access)] : 'Outside the grid';
  const terminal = findNearest(terminals, place);
  const facility = findNearest(facilities, place);
  const nearbyAttractionCount = attractions.filter(attraction => attraction !== place && distanceKm(attraction, place) <= 2).length;
  const reachability = terminal.km < 1.5 ? 'Easy to reach' : terminal.km < 3 ? 'Moderate to reach' : 'Harder to reach';

  return `<p class="font-semibold text-white">Accessibility Profile: <span class="font-normal text-accent-light">${reachability}</span></p>` +
    '<ul class="space-y-0.5 text-ink/70 text-[11px]">' +
      `<li>Area Accessibility: ${areaAccessibility}</li>` +
      `<li>Nearest Road: ${distanceToNearestRoadKm(place).toFixed(1)} km</li>` +
      `<li>Nearest Transportation Terminal: ${terminal.name} (${terminal.km.toFixed(1)} km)</li>` +
      `<li>Nearest Public Facility: ${facility.name} (${facility.km.toFixed(1)} km)</li>` +
      `<li>Nearby Tourist Attractions (within 2 km): ${nearbyAttractionCount}</li>` +
      '<li class="text-ink/50">Straight-line distances from simulated data.</li></ul>';
}

function fieldNotesHtml(place) {
  if (!place.field) return '';
  const rows = place.field.map(([label, note]) => `<li><span class="text-ink/50">${label}:</span> ${note}</li>`).join('');
  return `<div><p class="font-semibold text-white mb-1">Field Assessment Notes</p><ul class="space-y-0.5 text-[11px] text-ink/80">${rows}</ul></div>`;
}

function drawDistanceRings(place) {
  byId('rings').innerHTML = '';
  RING_RADII_PX.forEach(radius => {
    byId('rings').appendChild(createSvgElement('circle', {
      cx: place.x, cy: place.y, r: radius, fill: 'none', stroke: '#3794ff', 'stroke-width': 1.5, 'stroke-dasharray': '4 4'
    }));
  });
}

function showPlace(place) {
  const coordinates = `${latitudeOf(place)}° N, ${longitudeOf(place)}° E`;

  byId('detail').innerHTML =
    '<div class="space-y-4">' +
      '<div class="grid h-24 place-items-center rounded-xl bg-surface text-xs font-medium text-ink/40">Site Preview Image</div>' +
      `<div><p class="font-display font-bold text-base leading-snug text-white">${place.name}</p><p class="text-[11px] text-ink/60">${place.brgy} · ${coordinates}</p></div>` +
      `<div>${placeBadgesHtml(place)}</div>` +
      `<p class="text-xs text-ink/80 leading-relaxed">${place.text}</p>` +
      validationChecklistHtml(place) +
      fieldNotesHtml(place) +
      `<div class="pt-2 border-t border-line/50 space-y-3">${suitabilityBlockHtml(cellAt(place))}</div>` +
      `<div class="pt-2 border-t border-line/50 space-y-1 text-xs">${accessibilityBlockHtml(place)}</div>` +
    '</div>';

  drawDistanceRings(place);
  setPanelOpen(true);
  showPanelTab('detail');
  centerMapOn(place);
  byId('coords').textContent = `${place.name}: ${coordinates}`;
  byId('panelScroll').scrollTo({ top: 0, behavior: 'smooth' });
}

// Map Zoom and Pan
const map = byId('map');
const viewBox = { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT };

function applyViewBox() {
  // Loose bounds: the map always drags, but only a little past the edges
  const marginX = viewBox.w * 0.15;
  const marginY = viewBox.h * 0.15;
  viewBox.x = Math.max(-marginX, Math.min(viewBox.x, MAP_WIDTH - viewBox.w + marginX));
  viewBox.y = Math.max(-marginY, Math.min(viewBox.y, MAP_HEIGHT - viewBox.h + marginY));
  map.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function zoom(factor) {
  const centerX = viewBox.x + viewBox.w / 2;
  const centerY = viewBox.y + viewBox.h / 2;
  viewBox.w = Math.min(MAP_WIDTH, Math.max(MIN_VIEW_WIDTH, viewBox.w / factor));
  viewBox.h = viewBox.w * (MAP_HEIGHT / MAP_WIDTH);
  viewBox.x = centerX - viewBox.w / 2;
  viewBox.y = centerY - viewBox.h / 2;
  applyViewBox();
}

function centerMapOn(point) {
  if (viewBox.w >= MAP_WIDTH) return;   // nothing to do when fully zoomed out
  viewBox.x = point.x - viewBox.w / 2;
  viewBox.y = point.y - viewBox.h / 2;
  applyViewBox();
}

function resetView() {
  Object.assign(viewBox, { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT });
  applyViewBox();
}

byId('zoomIn').addEventListener('click', () => zoom(1.5));
byId('zoomOut').addEventListener('click', () => zoom(1 / 1.5));
byId('zoomReset').addEventListener('click', resetView);

map.addEventListener('pointerdown', event => {
  drag = { x: event.clientX, y: event.clientY, moved: false };
});
window.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX) drag.moved = true;
  if (!drag.moved) return;

  const mapRect = map.getBoundingClientRect();
  const unitsPerPixel = Math.max(viewBox.w / mapRect.width, viewBox.h / mapRect.height);
  viewBox.x -= dx * unitsPerPixel;
  viewBox.y -= dy * unitsPerPixel;
  drag.x = event.clientX;
  drag.y = event.clientY;
  applyViewBox();
});
// Clear the drag after the click event fires, so a drag is not mistaken for a click
window.addEventListener('pointerup', () => setTimeout(() => { drag = null; }, 0));

// Add Spot

function setAddingSpot(on) {
  isAddingSpot = on;
  byId('addBanner').classList.toggle('hidden', !on);
  byId('addBanner').classList.toggle('flex', on);
  map.classList.toggle('cursor-crosshair', on);
  map.classList.toggle('cursor-grab', !on);
}
byId('addBtn').addEventListener('click', () => setAddingSpot(true));
byId('cancelAdd').addEventListener('click', () => setAddingSpot(false));
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isAddingSpot) setAddingSpot(false);
});

map.addEventListener('click', event => {
  const wasDragged = drag && drag.moved;
  if (!isAddingSpot || wasDragged) return;

  const screenPoint = map.createSVGPoint();
  screenPoint.x = event.clientX;
  screenPoint.y = event.clientY;
  newSpotPoint = screenPoint.matrixTransform(map.getScreenCTM().inverse());
  const cell = cellAt(newSpotPoint);
  newSpotBrgy = !cell ? 'Outside the study area' : cell.landCover === 'Water body' ? 'Open water' : barangayAt(newSpotPoint);

  byId('spotCoords').textContent = `Coordinates: ${latitudeOf(newSpotPoint)}° N, ${longitudeOf(newSpotPoint)}° E`;
  byId('spotBrgy').textContent = newSpotBrgy;
  setAddingSpot(false);
  byId('spotDialog').showModal();
});

let toastTimer = null;
function showToast(message) {
  byId('toast').textContent = message;
  byId('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => byId('toast').classList.add('hidden'), 3000);
}

const removeUnsafeCharacters = text => String(text).replace(/[<>&"]/g, '').trim();

byId('spotForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const spot = {
    type: form.get('type'),
    name: removeUnsafeCharacters(form.get('name')),
    brgy: newSpotBrgy,
    x: Math.round(newSpotPoint.x),
    y: Math.round(newSpotPoint.y),
    text: removeUnsafeCharacters(form.get('text')) || 'No description provided.',
    pending: true
  };
  attractions.push(spot);
  addMarker(spot);

  byId('spotDialog').close();
  event.target.reset();

  // Make sure the new spot is visible
  layerCheckbox('attractions').checked = true;
  showLayer('attractions', true);
  typeCheckbox(spot.type).checked = true;

  renderLegend();
  applyAttractionFilter();
  renderSummary();
  showPlace(spot);
  showToast('Spot added to the mock map as Pending Review.');
});

// Dialogs
byId('importBtn').addEventListener('click', () => {
  byId('importFile').value = '';
  byId('importStatus').classList.add('hidden');
  byId('importDialog').showModal();
});
byId('importFile').addEventListener('change', () => {
  const files = byId('importFile').files;
  if (!files.length) return;
  byId('importStatus').textContent = 'GIS data imported successfully (simulation): ' + files[0].name;
  byId('importStatus').classList.remove('hidden');
});
document.querySelectorAll('.close-dialog').forEach(button => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

byId('legendToggle').addEventListener('click', () => {
  const willOpen = byId('legendToggle').getAttribute('aria-expanded') !== 'true';
  byId('legendToggle').setAttribute('aria-expanded', willOpen);
  byId('legendBody').classList.toggle('hidden', !willOpen);
  byId('legendPanel').classList.toggle('w-56', willOpen);
  byId('legendChevron').classList.toggle('rotate-180', willOpen);
});

// Sidebar
function setPanelOpen(open) {
  byId('panelBody').classList.toggle('hidden', !open);
  byId('panelTabs').classList.toggle('hidden', !open);
  byId('rightPanel').classList.toggle('lg:w-96', open);
  byId('rightPanel').classList.toggle('lg:w-14', !open);
  byId('panelToggle').setAttribute('aria-expanded', open);
  byId('panelToggle').setAttribute('aria-label', open ? 'Collapse sidebar' : 'Expand sidebar');
  byId('panelToggle').textContent = open ? '»' : '«';
}

function showPanelTab(name) {
  ['places', 'detail'].forEach(tab => {
    byId('tab-' + tab).classList.toggle('hidden', tab !== name);
    document.querySelector(`[data-panel-tab="${tab}"]`).setAttribute('aria-selected', tab === name);
  });
}

byId('panelToggle').addEventListener('click', () => setPanelOpen(byId('panelToggle').getAttribute('aria-expanded') !== 'true'));
document.querySelectorAll('[data-panel-tab]').forEach(button => {
  button.addEventListener('click', () => showPanelTab(button.dataset.panelTab));
});

// Initialization

openView('all');
