// Aeropuertos reales del dataset — usados para mostrar el mapa antes de iniciar simulación
// Coordenadas, país y región extraídos del archivo aeropuertos.txt del backend
export const STATIC_AIRPORTS = [
  // América del Sur
  { code:"SKBO", name:"Bogotá",       country:"Colombia",     region:"América del Sur", lat:  4.70, lng: -74.15, capacity:430, current:0 },
  { code:"SEQM", name:"Quito",        country:"Ecuador",      region:"América del Sur", lat:  0.11, lng: -78.36, capacity:410, current:0 },
  { code:"SVMI", name:"Caracas",      country:"Venezuela",    region:"América del Sur", lat: 10.60, lng: -66.99, capacity:400, current:0 },
  { code:"SBBR", name:"Brasilia",     country:"Brasil",       region:"América del Sur", lat:-15.87, lng: -47.92, capacity:480, current:0 },
  { code:"SPIM", name:"Lima",         country:"Perú",         region:"América del Sur", lat:-12.02, lng: -77.11, capacity:440, current:0 },
  { code:"SLLP", name:"La Paz",       country:"Bolivia",      region:"América del Sur", lat:-16.51, lng: -68.19, capacity:420, current:0 },
  { code:"SCEL", name:"Santiago",     country:"Chile",        region:"América del Sur", lat:-33.40, lng: -70.79, capacity:460, current:0 },
  { code:"SABE", name:"Buenos Aires", country:"Argentina",    region:"América del Sur", lat:-34.56, lng: -58.42, capacity:460, current:0 },
  { code:"SGAS", name:"Asunción",     country:"Paraguay",     region:"América del Sur", lat:-25.24, lng: -57.52, capacity:400, current:0 },
  { code:"SUAA", name:"Montevideo",   country:"Uruguay",      region:"América del Sur", lat:-34.79, lng: -56.26, capacity:400, current:0 },
  // Europa
  { code:"LATI", name:"Tirana",       country:"Albania",      region:"Europa", lat: 41.41, lng:  19.72, capacity:410, current:0 },
  { code:"EDDI", name:"Berlín",       country:"Alemania",     region:"Europa", lat: 52.47, lng:  13.40, capacity:480, current:0 },
  { code:"LOWW", name:"Viena",        country:"Austria",      region:"Europa", lat: 48.11, lng:  16.57, capacity:430, current:0 },
  { code:"EBCI", name:"Bruselas",     country:"Bélgica",      region:"Europa", lat: 50.46, lng:   4.45, capacity:440, current:0 },
  { code:"UMMS", name:"Minsk",        country:"Bielorrusia",  region:"Europa", lat: 53.88, lng:  28.03, capacity:400, current:0 },
  { code:"LBSF", name:"Sofía",        country:"Bulgaria",     region:"Europa", lat: 42.69, lng:  23.40, capacity:400, current:0 },
  { code:"LKPR", name:"Praga",        country:"Chequia",      region:"Europa", lat: 50.10, lng:  14.27, capacity:400, current:0 },
  { code:"LDZA", name:"Zagreb",       country:"Croacia",      region:"Europa", lat: 45.74, lng:  16.07, capacity:420, current:0 },
  { code:"EKCH", name:"Copenhague",   country:"Dinamarca",    region:"Europa", lat: 55.62, lng:  12.66, capacity:480, current:0 },
  { code:"EHAM", name:"Ámsterdam",    country:"Holanda",      region:"Europa", lat: 52.30, lng:   4.77, capacity:480, current:0 },
  // Asia
  { code:"VIDP", name:"Delhi",        country:"India",            region:"Asia", lat: 28.57, lng:  77.10, capacity:480, current:0 },
  { code:"OSDI", name:"Damasco",      country:"Siria",            region:"Asia", lat: 33.41, lng:  36.52, capacity:400, current:0 },
  { code:"OERK", name:"Riad",         country:"Arabia Saudita",   region:"Asia", lat: 24.96, lng:  46.70, capacity:420, current:0 },
  { code:"OMDB", name:"Dubái",        country:"Emiratos Á. U.",   region:"Asia", lat: 25.25, lng:  55.36, capacity:420, current:0 },
  { code:"OAKB", name:"Kabul",        country:"Afganistán",       region:"Asia", lat: 34.57, lng:  69.21, capacity:480, current:0 },
  { code:"OOMS", name:"Mascate",      country:"Omán",             region:"Asia", lat: 23.59, lng:  58.28, capacity:460, current:0 },
  { code:"OYSN", name:"Saná",         country:"Yemen",            region:"Asia", lat: 15.48, lng:  44.22, capacity:420, current:0 },
  { code:"OPKC", name:"Karachi",      country:"Pakistán",         region:"Asia", lat: 24.90, lng:  67.15, capacity:410, current:0 },
  { code:"UBBB", name:"Bakú",         country:"Azerbaiyán",       region:"Asia", lat: 40.47, lng:  50.05, capacity:400, current:0 },
  { code:"OJAI", name:"Amán",         country:"Jordania",         region:"Asia", lat: 31.72, lng:  35.99, capacity:400, current:0 },
];

// Búsqueda de metadatos (país/región/nombre) por código de aeropuerto.
// Los aeropuertos en vivo que llegan del backend solo traen código + nombre,
// así que los enriquecemos por código con esta tabla del dataset fijo.
export const AIRPORT_META = Object.fromEntries(
  STATIC_AIRPORTS.map(a => [a.code, { name: a.name, country: a.country, region: a.region }])
);

/**
 * ¿Coincide el aeropuerto con el texto de búsqueda?
 * Busca en código, nombre, país y región (sin distinguir mayúsculas/acentos).
 */
export function airportMatches(airport, query) {
  const q = normalize(query);
  if (!q) return false;
  const meta = AIRPORT_META[airport.code] || {};
  // Incluir SIEMPRE el nombre de ciudad (meta.name): en datos en vivo
  // airport.name es el código, así que sin meta.name la búsqueda por ciudad
  // fallaría. Busca por código, ciudad, país y continente/región.
  const haystack = [
    airport.code,
    airport.name,
    meta.name,
    meta.country,
    meta.region,
  ].map(normalize).join(" ");
  return haystack.includes(q);
}

function normalize(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quitar acentos
}

/**
 * Nombre legible (ciudad) de un aeropuerto a partir de su código. Prioriza el
 * nombre que llega en vivo del backend; si no, usa la tabla del dataset; si no
 * existe, devuelve el propio código. Para mostrar ciudades/países en vez de
 * códigos en tarjetas y paneles durante la ejecución.
 *
 * @param {string} code  código del aeropuerto (p.ej. "SPIM")
 * @param {Array}  live  aeropuertos en vivo del backend (opcional)
 */
export function airportName(code, live = null) {
  if (!code) return "";
  if (live && live.length) {
    const hit = live.find(a => a.code === code);
    if (hit?.name) return hit.name;
  }
  return AIRPORT_META[code]?.name || code;
}

/** "Ciudad · País" si se conocen; si no, el nombre o el código. */
export function airportLabel(code, live = null) {
  const name = airportName(code, live);
  const country = AIRPORT_META[code]?.country;
  return country && name !== code ? `${name} · ${country}` : name;
}
