export type Exposure = {
  url: string;
  band: string;
  detector: number;
  mjd: number;
  iso: string;
  obsId: string;
  collection: string;
  emMinUm: number;
  emMaxUm: number;
};

export type SearchPlan = {
  total: number;
  byDetector: Record<string, number>;
  collections: string[];
  detectorUsed: number;
  blink: Exposure[];
  spectral: Exposure[];
  mjdMin: number | null;
  mjdMax: number | null;
};

export type FlagCount = { name: string; count: number; kind: string };

export type FramePayload = {
  width: number;
  height: number;
  fluxB64: string;
  maskB64: string;
  waveUm: number;
  bandUm: number;
  centerFlux: number;
  coverage: number;
  dateObs: string;
  mjd: number;
  detector: number;
  obsid: string;
  exposureSec: number;
  bunit: string;
  pipeline: string;
  dq: string;
  zodiRemoved: boolean;
  flags: FlagCount[];
  pixelScaleArcsec: number;
};

export type CatalogSource = {
  ra: number;
  dec: number;
  mag: number | null;
  label: string;
  kind: "gaia" | "wise";
  pmra: number | null;
  pmdec: number | null;
};

export type OverlayPayload = {
  gaia: CatalogSource[];
  wise: CatalogSource[];
  gaiaNote: string;
  wiseNote: string;
};
