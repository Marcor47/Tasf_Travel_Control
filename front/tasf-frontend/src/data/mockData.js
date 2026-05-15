export const airports = [
  { code:"JFK", name:"New York (JFK)",   lat: 40.6, lng: -73.8, capacity:350, current:325 },
  { code:"LIM", name:"Lima (LIM)",        lat:-12.0, lng: -77.1, capacity:400, current:104 },
  { code:"MAD", name:"Madrid (MAD)",      lat: 40.5, lng:  -3.6, capacity:300, current: 60 },
  { code:"LHR", name:"Londres (LHR)",     lat: 51.5, lng:  -0.5, capacity:400, current:392 },
  { code:"CDG", name:"París (CDG)",       lat: 49.0, lng:   2.5, capacity:380, current:304 },
  { code:"GRU", name:"São Paulo (GRU)",   lat:-23.4, lng: -46.5, capacity:320, current:205 },
  { code:"PEK", name:"Beijing (PEK)",     lat: 40.1, lng: 116.6, capacity:360, current:288 },
  { code:"NRT", name:"Tokio (NRT)",       lat: 35.7, lng: 140.4, capacity:300, current:174 },
  { code:"HKG", name:"Hong Kong (HKG)",   lat: 22.3, lng: 113.9, capacity:340, current:306 },
  { code:"SIN", name:"Singapur (SIN)",    lat:  1.4, lng: 103.9, capacity:310, current:282 },
];

export const packages = [
  { id:"PKG-001", origin:"LIM", destination:"MAD", status:"alert",    hoursLeft:36 },
  { id:"PKG-002", origin:"JFK", destination:"GRU", status:"alert",    hoursLeft:36 },
  { id:"PKG-003", origin:"LHR", destination:"PEK", status:"critical", hoursLeft:44 },
  { id:"PKG-005", origin:"HKG", destination:"NRT", status:"critical", hoursLeft:44 },
];

export const baggage = [
  { id:"ML-001", lot:"LT-001", client:"LATAM", status:"alert",    hoursLeft:36 },
  { id:"ML-002", lot:"LT-002", client:"LATAM", status:"critical", hoursLeft:44 },
  { id:"ML-003", lot:"LT-003", client:"LATAM", status:"alert",    hoursLeft:36 },
  { id:"ML-004", lot:"LT-004", client:"LATAM", status:"ok",       hoursLeft:12 },
  { id:"ML-005", lot:"LT-005", client:"LATAM", status:"critical", hoursLeft:44 },
];

export const routes = [
  { from:"LIM", to:"MAD" },
  { from:"JFK", to:"GRU" },
  { from:"LHR", to:"PEK" },
  { from:"LHR", to:"CDG" },
  { from:"HKG", to:"NRT" },
  { from:"CDG", to:"NRT" },
];

export const kpis = {
  activeFlights:       450,
  saturationPercent:    34,
  occupancyPercent:     70,
  avgDeliveryDays:     1.3,
  replanifications:     34,
  deliveredOnTime:    1234,
  atRisk:              450,
  outOfDeadline:         0,
};

export const fleetStatus = [
  { id:"TO-4029", route:"JFK → FRA", freq:"Daily",   capacity:350, used:240, pct:68 },
  { id:"TO-7711", route:"SIN → LHR", freq:"2x/Day",  capacity:400, used:382, pct:95 },
  { id:"TO-1205", route:"ORD → TYO", freq:"Weekly",  capacity:150, used: 45, pct:30 },
  { id:"TO-8890", route:"DXB → SYD", freq:"Daily",   capacity:300, used:210, pct:70 },
  { id:"TO-3321", route:"CDG → HKG", freq:"3x/Week", capacity:350, used:165, pct:47 },
  { id:"TO-5044", route:"LAX → NRT", freq:"Daily",   capacity:300, used:290, pct:96 },
];

export const historyPackages = [
  { id:"#B-880293", route:"LAX → FRA", client:"Lufthansa LH453",  status:"transit" },
  { id:"#B-881024", route:"HKG → CDG", client:"Air France AF185", status:"risk"    },
  { id:"#B-882190", route:"DFW → LHR", client:"Amer. Cargo AA50", status:"ok"      },
  { id:"#B-883552", route:"SFO → NRT", client:"JAL JL001",        status:"transit" },
];

export const reportData = {
  totalBaggage:      128402,
  avgDeliveryMin:    42.8,
  replanifications:  12,
  fleetUsagePct:     88.2,
  inventoryFlow: [
    { time:"00:00", delivered:20, inTransit:45, warehouse:30 },
    { time:"06:00", delivered:40, inTransit:70, warehouse:55 },
    { time:"12:00", delivered:65, inTransit:90, warehouse:80 },
    { time:"18:00", delivered:85, inTransit:75, warehouse:95 },
    { time:"23:59", delivered:95, inTransit:50, warehouse:70 },
  ],
  compliance: [
    { hub:"CDG Terminal 2",    pct:92, status:"ok"   },
    { hub:"LHR Logistics Hub", pct:78, status:"ok"   },
    { hub:"JFK Transit Zone",  pct:64, status:"risk" },
    { hub:"FRA Sorting Unit",  pct:89, status:"ok"   },
  ],
};