// Mock data and configuration
// (simulated GIS data, not real QGIS exports or research results)
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const PX_PER_KM = 60;
const RING_RADII_PX = [60, 120];
const DRAG_THRESHOLD_PX = 4;
const MIN_VIEW_WIDTH = 200;

// Grid of scored cells laid over the land
const GRID_LEFT = 80;
const GRID_TOP = 120;
const CELL_WIDTH = 64;
const CELL_HEIGHT = 55;
const GRID_COLUMNS = 10;
const GRID_ROWS = 8;

// Simulated origin used to turn map pixels into fake lat/lng
const ORIGIN_LATITUDE = 16.08;
const ORIGIN_LONGITUDE = 120.30;
const DEGREES_PER_PX = 0.00015;

// Values at which a criterion scores 0 (used for score calculation and legends)
const MAX_ELEVATION_M = 22;
const MAX_SLOPE_DEG = 8;
const MAX_DISTANCE_KM = 4;

const LAND_POINTS = '80,150 200,120 400,135 600,120 720,150 720,540 560,560 300,545 80,530';

const LAND_COVER_TYPES = [
  { name: 'Water body', score: 0.1 },
  { name: 'Built-up', score: 0.3 },
  { name: 'Open area', score: 0.7 },
  { name: 'Vegetation', score: 0.9 }
];

// Representative AHP weights (they add up to 1), for demonstration only
const criteria = [
  { key: 'landCover', name: 'Land Use / Land Cover', shortName: 'Land Cover', viewLabel: 'Land Cover', weight: 0.42,
    displayValue: cell => cell.landCover,
    description: 'Vegetation and open areas suit low-impact ecotourism. Built-up land and water score lowest.' },
  { key: 'elevation', name: 'Elevation', shortName: 'Elevation', viewLabel: 'Elevation', weight: 0.21,
    direction: 'up', max: MAX_ELEVATION_M, unit: ' m',
    displayValue: cell => cell.elevation.toFixed(1) + ' m',
    description: 'Higher ground is safer from flooding, so it scores higher.' },
  { key: 'slope', name: 'Slope', shortName: 'Slope', viewLabel: 'Slope', weight: 0.16,
    direction: 'down', max: MAX_SLOPE_DEG, unit: '°',
    displayValue: cell => cell.slope.toFixed(1) + '°',
    description: 'Flatter ground is easier for trails and small buildings, so it scores higher.' },
  { key: 'road', name: 'Proximity to Roads', shortName: 'Roads', viewLabel: 'Road Proximity', weight: 0.12,
    direction: 'down', max: MAX_DISTANCE_KM, unit: ' km',
    displayValue: cell => cell.roadKm.toFixed(1) + ' km',
    description: 'Straight-line distance to the nearest road (simulated). Closer scores higher.' },
  { key: 'attraction', name: 'Proximity to Existing Tourist Destinations', shortName: 'Tourist sites', viewLabel: 'Tourist Destination Proximity', weight: 0.09,
    direction: 'down', max: MAX_DISTANCE_KM, unit: ' km',
    displayValue: cell => cell.attractionKm.toFixed(1) + ' km',
    description: 'Straight-line distance to the nearest existing tourist destination (simulated). Closer scores higher.' }
];

const roads = [
  { type: 'Asphalt', points: [[100, 360], [340, 360], [560, 300], [710, 300]] },
  { type: 'Asphalt', points: [[110, 195], [400, 205], [690, 190]] },
  { type: 'Asphalt', points: [[560, 230], [560, 550]] },
  { type: 'Asphalt', points: [[120, 500], [400, 470], [700, 510]] },
  { type: 'Gravel', points: [[340, 130], [340, 540]] }
];

// Attractions have a `type`; potential sites (candidates) do not.
const attractions = [
  { type: 'Recreational', name: 'River cruise dock', brgy: 'Brgy. Riverside', x: 215, y: 300, text: 'A fake dock where boat cruises start.' },
  { type: 'Recreational', name: 'Beach park', brgy: 'Brgy. Sandbar', x: 630, y: 170, text: 'A fake beachfront park with picnic areas.' },
  { type: 'Natural', name: 'Mangrove boardwalk', brgy: 'Brgy. Estuary', x: 400, y: 190, text: 'A fake wooden walkway through mangroves.' },
  { type: 'Historical', name: 'Heritage church', brgy: 'Brgy. Poblacion', x: 350, y: 330, text: 'A fake landmark in the town center.' },
  { type: 'Historical', name: 'Old river bridge', brgy: 'Brgy. Riverside', x: 520, y: 335, text: 'A fake century-old bridge over the river.' },
  { type: 'Community-based', name: 'Fishpond tour', brgy: 'Brgy. Fishpond', x: 450, y: 440, text: 'A fake community-run tour of local fishponds.' },
  { type: 'Culinary', name: 'Seafood market', brgy: 'Brgy. Poblacion', x: 300, y: 400, text: 'A fake market with grilled fish stalls.' },
  { type: 'Cultural', name: 'Cultural hall', brgy: 'Brgy. Poblacion', x: 410, y: 300, text: 'A fake hall for local festivals and crafts.' }
];

// `checks` follows VALIDATION_CHECKS: 1 = done, 0 = not done
const candidates = [
  { name: 'Site A: coastal edge', brgy: 'Brgy. Northshore', x: 300, y: 240, checks: [1, 1, 1], text: 'Open land next to a mangrove patch, good for a low-impact trail.',
    field: [['Natural features', 'Mangrove edge with healthy cover'], ['Scenic and recreational value', 'Estuary views at sunset'], ['Road condition', 'Paved road about 600 m away'], ['Community involvement', 'Local fisherfolk group interested in guiding']] },
  { name: 'Site B: river bend', brgy: 'Brgy. Riverside', x: 560, y: 380, checks: [0, 0, 0], text: 'Land along a river bend, near two attractions.',
    field: [['Natural features', 'Riverbank with scattered trees'], ['Scenic and recreational value', 'Good spot for river viewing'], ['Road condition', 'Paved road nearby'], ['Community involvement', 'Not yet consulted']] },
  { name: 'Site C: southwest fields', brgy: 'Brgy. Fishpond', x: 150, y: 450, checks: [1, 1, 0], text: 'Open fields far from the town center, suited to community-based tourism.',
    field: [['Natural features', 'Open grassland with a few trees'], ['Scenic and recreational value', 'Wide open views, good for walking'], ['Road condition', 'Gravel road, passable in dry weather'], ['Community involvement', 'Barangay officials open to a pilot tour']] },
  { name: 'Site D: fishpond edge', brgy: 'Brgy. Fishpond', x: 470, y: 500, checks: [1, 1, 1], text: 'Fishpond edge with room for a small viewing deck.',
    field: [['Natural features', 'Fishponds with bird activity'], ['Scenic and recreational value', 'Calm water, good for photography'], ['Road condition', 'Paved road 900 m away'], ['Community involvement', 'Fishpond owners willing to host visitors']] }
];

const terminals = [{ name: 'Central terminal', x: 340, y: 360 }, { name: 'North terminal', x: 560, y: 230 }];
const facilities = [{ name: 'Town hall', x: 380, y: 290 }, { name: 'Health center', x: 250, y: 380 }, { name: 'Public market', x: 300, y: 410 }];

const VALIDATION_CHECKS = ['Field visit', 'GPS check', 'Stakeholder consultation'];

const typeColors = { 'Natural': '#4ec9b0', 'Cultural': '#c586c0', 'Historical': '#ce9178', 'Recreational': '#569cd6', 'Culinary': '#f48771', 'Community-based': '#dcdcaa' };
const classNames = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
const classColors = ['#efe3c6', '#d5d99a', '#97c179', '#4f9a62', '#1d6a4a'];
const EXCLUDED_CLASS = classNames.length;
const EXCLUDED_COLOR = '#5b6b68';

// Barangay regions on the simulated map (split at x=280, x=500 and y=300)
const BRGY_X_SPLITS = [280, 500];
const BRGY_Y_SPLIT = 300;
const BRGY_NAMES = [['Fishpond', 'Poblacion', 'Riverside'], ['Northshore', 'Estuary', 'Sandbar']];
