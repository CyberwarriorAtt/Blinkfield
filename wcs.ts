/**
 * SPHEREx cutout WCS: TAN + SIP, verified against Astropy on a DR1 cutout
 * (center round-trips to ~0.003 px). Wavelength uses the WCS-W -TAB lookup.
 */

export type Poly = number[][];

export type SpatialWcs = {
  crpix1: number;
  crpix2: number;
  crval1: number;
  crval2: number;
  cd11: number;
  cd12: number;
  cd21: number;
  cd22: number;
  a: Poly;
  b: Poly;
  ap: Poly;
  bp: Poly;
};

export type WaveTable = {
  crpix1: number;
  crpix2: number;
  crval1: number;
  crval2: number;
  cdelt1: number;
  cdelt2: number;
  pc11: number;
  pc12: number;
  pc21: number;
  pc22: number;
  xs: number[];
  ys: number[];
  /** wavelength[iy][ix] in microns */
  wave: number[][];
  band: number[][];
};

const RAD = Math.PI / 180;

export function poly(m: Poly, u: number, v: number): number {
  let s = 0;
  for (let i = 0; i < m.length; i++) {
    const row = m[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const c = row[j];
      if (!c) continue;
      s += c * u ** i * v ** j;
    }
  }
  return s;
}

export function pixelToSky(wcs: SpatialWcs, i: number, j: number): [number, number] {
  const u = i - (wcs.crpix1 - 1);
  const v = j - (wcs.crpix2 - 1);
  const uu = u + poly(wcs.a, u, v);
  const vv = v + poly(wcs.b, u, v);
  const xi = wcs.cd11 * uu + wcs.cd12 * vv;
  const eta = wcs.cd21 * uu + wcs.cd22 * vv;
  const x = xi * RAD;
  const y = eta * RAD;
  const dec0 = wcs.crval2 * RAD;
  const ra0 = wcs.crval1 * RAD;
  const ra = ra0 + Math.atan2(x, Math.cos(dec0) - y * Math.sin(dec0));
  const dec = Math.atan2(
    Math.sin(dec0) + y * Math.cos(dec0),
    Math.hypot(Math.cos(dec0) - y * Math.sin(dec0), x),
  );
  let raDeg = ra / RAD;
  raDeg = ((raDeg % 360) + 360) % 360;
  return [raDeg, dec / RAD];
}

export function skyToPixel(wcs: SpatialWcs, ra: number, dec: number): [number, number] {
  const ra0 = wcs.crval1 * RAD;
  const dec0 = wcs.crval2 * RAD;
  let dra = (ra - wcs.crval1) * RAD;
  if (dra > Math.PI) dra -= 2 * Math.PI;
  if (dra < -Math.PI) dra += 2 * Math.PI;
  const decR = dec * RAD;
  const cosc = Math.sin(dec0) * Math.sin(decR) + Math.cos(dec0) * Math.cos(decR) * Math.cos(dra);
  if (cosc <= 0.05) return [Number.NaN, Number.NaN];
  const xi = ((Math.cos(decR) * Math.sin(dra)) / cosc) / RAD;
  const eta =
    ((Math.cos(dec0) * Math.sin(decR) - Math.sin(dec0) * Math.cos(decR) * Math.cos(dra)) / cosc) /
    RAD;
  const det = wcs.cd11 * wcs.cd22 - wcs.cd12 * wcs.cd21;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) return [Number.NaN, Number.NaN];
  const up = (wcs.cd22 * xi - wcs.cd12 * eta) / det;
  const vp = (-wcs.cd21 * xi + wcs.cd11 * eta) / det;
  const hasInv = wcs.ap.length > 1 || wcs.ap.some((row) => row.some((c) => c !== 0));
  let u: number;
  let v: number;
  if (hasInv) {
    u = up + poly(wcs.ap, up, vp);
    v = vp + poly(wcs.bp, up, vp);
  } else {
    u = up;
    v = vp;
    for (let k = 0; k < 8; k++) {
      const u2 = up - poly(wcs.a, u, v);
      const v2 = vp - poly(wcs.b, u, v);
      if (Math.abs(u2 - u) < 1e-4 && Math.abs(v2 - v) < 1e-4) {
        u = u2;
        v = v2;
        break;
      }
      u = u2;
      v = v2;
    }
  }
  return [u + (wcs.crpix1 - 1), v + (wcs.crpix2 - 1)];
}

/** North-up, east-left TAN grid centered on the target. */
export function canvasToSky(
  x: number,
  y: number,
  ra0: number,
  dec0: number,
  sizeDeg: number,
  n: number,
): [number, number] {
  const scale = sizeDeg / n;
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;
  const xi = (cx - x) * scale;
  const eta = (cy - y) * scale;
  const xR = xi * RAD;
  const yR = eta * RAD;
  const d0 = dec0 * RAD;
  const a0 = ra0 * RAD;
  const ra = a0 + Math.atan2(xR, Math.cos(d0) - yR * Math.sin(d0));
  const dec = Math.atan2(
    Math.sin(d0) + yR * Math.cos(d0),
    Math.hypot(Math.cos(d0) - yR * Math.sin(d0), xR),
  );
  let raDeg = ra / RAD;
  raDeg = ((raDeg % 360) + 360) % 360;
  return [raDeg, dec / RAD];
}

export function skyToCanvas(
  ra: number,
  dec: number,
  ra0: number,
  dec0: number,
  sizeDeg: number,
  n: number,
): [number, number] {
  const scale = sizeDeg / n;
  const d0 = dec0 * RAD;
  const a0 = ra0 * RAD;
  let dra = (ra - ra0) * RAD;
  if (dra > Math.PI) dra -= 2 * Math.PI;
  if (dra < -Math.PI) dra += 2 * Math.PI;
  const decR = dec * RAD;
  const cosc = Math.sin(d0) * Math.sin(decR) + Math.cos(d0) * Math.cos(decR) * Math.cos(dra);
  if (cosc <= 0.05) return [Number.NaN, Number.NaN];
  const xi = ((Math.cos(decR) * Math.sin(dra)) / cosc) / RAD;
  const eta =
    ((Math.cos(d0) * Math.sin(decR) - Math.sin(d0) * Math.cos(decR) * Math.cos(dra)) / cosc) / RAD;
  const cx = (n - 1) / 2;
  const cy = (n - 1) / 2;
  return [cx - xi / scale, cy - eta / scale];
}

export function wavelengthAt(table: WaveTable, i: number, j: number): { wave: number; band: number } {
  const u = i + 1 - table.crpix1;
  const v = j + 1 - table.crpix2;
  const x = table.crval1 + table.cdelt1 * (table.pc11 * u + table.pc12 * v);
  const y = table.crval2 + table.cdelt2 * (table.pc21 * u + table.pc22 * v);
  const sample = (grid: number[][]) => bilinear(table.xs, table.ys, grid, x, y);
  return { wave: sample(table.wave), band: sample(table.band) };
}

function bilinear(xs: number[], ys: number[], grid: number[][], x: number, y: number): number {
  if (xs.length < 2 || ys.length < 2) return Number.NaN;
  const [ix, tx] = bracket(xs, x);
  const [iy, ty] = bracket(ys, y);
  const w00 = grid[iy]?.[ix];
  const w10 = grid[iy]?.[ix + 1];
  const w01 = grid[iy + 1]?.[ix];
  const w11 = grid[iy + 1]?.[ix + 1];
  if (![w00, w10, w01, w11].every((v) => typeof v === "number" && Number.isFinite(v))) {
    return Number.NaN;
  }
  return (w00 * (1 - tx) + w10 * tx) * (1 - ty) + (w01 * (1 - tx) + w11 * tx) * ty;
}

function bracket(axis: number[], v: number): [number, number] {
  if (v <= axis[0]) return [0, 0];
  const last = axis.length - 1;
  if (v >= axis[last]) return [last - 1, 1];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= v) lo = mid;
    else hi = mid;
  }
  const span = axis[lo + 1] - axis[lo];
  const t = span === 0 ? 0 : (v - axis[lo]) / span;
  return [lo, t];
}

export function gridSize(sizeDeg: number): number {
  const native = (sizeDeg * 3600) / 6.15;
  return Math.max(64, Math.min(160, Math.round(native)));
}
