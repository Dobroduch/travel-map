// Continent membership (by the ISO3 ids used in countries.geojson) and the
// lon/lat window each continent's heatmap is framed to. Transcontinental
// countries are filed where most people would expect them on a map of that
// continent (Russia and Turkey with Europe, the Caucasus with Asia).

const MEMBERS = {
  europe:
    "ALA ALB AND AUT BEL BGR BIH BLR CHE CYN CYP CZE DEU DNK ESP EST FIN FRA FRO GBR GGY GRC HRV HUN IMN IRL ISL ITA JEY LIE LTU LUX LVA MCO MDA MKD MLT MNE NLD NOR POL PRT ROU RUS SJM SMR SRB SVK SVN SWE TUR UKR VAT XKX",
  asia: "AFG ARE ARM AZE BGD BHR BRN BTN CCK CHN CXR GEO HKG IDN IND IOT IRN IRQ ISR JOR JPN KAS KAZ KGZ KHM KOR KWT LAO LBN LKA MAC MDV MMR MNG MYS NPL OMN PAK PHL PRK PSE QAT SAU SGP SYR THA TJK TKM TLS TWN UZB VNM YEM",
  africa:
    "AGO BDI BEN BFA BWA CAF CIV CMR COD COG COM CPV DJI DZA EGY ERI ESH ETH GAB GHA GIN GMB GNB GNQ KEN LBR LBY LSO MAR MDG MLI MOZ MRT MUS MWI MYT NAM NER NGA REU RWA SDN SEN SHN SLE SOL SOM SSD STP SWZ SYC TCD TGO TUN TZA UGA ZAF ZMB ZWE",
  northAmerica:
    "ABW AIA ATG BES BHS BLM BLZ BMU BRB CAN CRI CUB CUW CYM DMA DOM GLP GRD GRL GTM HND HTI JAM KNA LCA MAF MEX MSR MTQ NIC PAN PRI SLV SPM SXM TCA TTO USA VCT VGB VIR",
  southAmerica: "ARG BOL BRA CHL COL ECU FLK GUF GUY PER PRY SGS SUR URY VEN",
  oceania:
    "ASM ATC AUS COK FJI FSM GUM KIR MHL MNP NCL NFK NIU NRU NZL PCN PLW PNG PYF SLB TKL TON TUV VUT WLF WSM",
};

// bounds: [west, south, east, north] in degrees.
export const CONTINENTS = [
  { key: "europe", name: "Europe", bounds: [-25, 32, 45, 72] },
  { key: "asia", name: "Asia", bounds: [25, -11, 146, 56] },
  { key: "africa", name: "Africa", bounds: [-26, -36, 60, 38] },
  { key: "northAmerica", name: "North America", bounds: [-170, 6, -10, 84] },
  { key: "southAmerica", name: "South America", bounds: [-82, -56, -33, 13] },
  { key: "oceania", name: "Oceania", bounds: [110, -48, 180, 12] },
];

const CONTINENT_BY_CODE = new Map();
for (const [key, codes] of Object.entries(MEMBERS)) {
  for (const code of codes.split(" ")) CONTINENT_BY_CODE.set(code, key);
}

export function continentOf(code) {
  return CONTINENT_BY_CODE.get(code) || null;
}
