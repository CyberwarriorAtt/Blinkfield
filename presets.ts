export type Preset = {
  id: string;
  name: string;
  ra: number;
  dec: number;
  fov: number;
  detector: number;
  note: string;
};

/** Challenge test fields. Coordinates are ICRS degrees. */
export const PRESETS: Preset[] = [
  {
    id: "barnard",
    name: "Barnard's Star",
    ra: 269.452075,
    dec: 4.693391,
    fov: 6,
    detector: 2,
    note: "The classic high-proper-motion star, about 10″ per year. Bright in every SPHEREx detector. Difference the first and last epoch.",
  },
  {
    id: "epsindi",
    name: "Epsilon Indi B",
    ra: 330.840223,
    dec: -56.785978,
    fov: 16,
    detector: 4,
    note: "A T-dwarf pair about 7′ from the bright star ε Indi. SPHEREx cannot split Ba from Bb (under 1″ apart). Widen the field so both the star and the companion fit.",
  },
  {
    id: "wise0855",
    name: "WISE 0855",
    ra: 133.795129,
    dec: -7.245147,
    fov: 8,
    detector: 6,
    note: "Coldest known brown dwarf. Faint to Gaia, relatively brighter in the longest-wavelength detectors (D5–D6), and a fast mover.",
  },
  {
    id: "rwaur",
    name: "RW Aurigae",
    ra: 76.956535,
    dec: 30.401363,
    fov: 6,
    detector: 3,
    note: "A young variable star. Watch the spectrum change between survey passes more than the position.",
  },
  {
    id: "rdra",
    name: "R Draconis",
    ra: 248.167525,
    dec: 66.754975,
    fov: 6,
    detector: 3,
    note: "A Mira variable with a huge brightness swing. Compare epoch spectra rather than hunting for motion.",
  },
];

export const DETECTORS: { id: number; label: string; range: string }[] = [
  { id: 1, label: "D1", range: "0.75–1.11 μm" },
  { id: 2, label: "D2", range: "1.11–1.64 μm" },
  { id: 3, label: "D3", range: "1.64–2.42 μm" },
  { id: 4, label: "D4", range: "2.42–3.86 μm" },
  { id: 5, label: "D5", range: "3.82–4.43 μm" },
  { id: 6, label: "D6", range: "4.42–5.01 μm" },
];
