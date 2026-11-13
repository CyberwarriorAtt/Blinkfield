import { classifyFlag, FLAG_BITS } from "@/lib/spherex/flags";
import { mjdToIso } from "@/lib/spherex/coords";
import type { CatalogSource, Exposure, FramePayload, OverlayPayload, SearchPlan } from "@/lib/spherex/types";
import {
  canvasToSky,
  gridSize,
  skyToPixel,
  wavelengthAt,
  type Poly,
  type SpatialWcs,
  type WaveTable,
} from "@/lib/spherex/wcs";

/**
 * Add a new IRSA collection name here when NASA publishes one.
 * Searched in order; later collections fill gaps the earlier ones do not cover.
 */
export const SPHEREX_COLLECTIONS = ["spherex_dr1", "spherex_qr3"] as const;

const UA = "Blinkfield/1.0 (NASA Space Apps educational; +https://www.spaceappschallenge.org)";

type Hdr = Record<string, string>;

class BytePump {
  private chunks: Uint8Array[] = [];
  private off = 0;
  private buffered = 0;
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async pull(n: number): Promise<Uint8Array> {
    while (this.buffered < n) {
      const { done, value } = await this.reader.read();
      if (done || !value) throw new Error("The cutout ended before the image was complete.");
      this.chunks.push(value);
      this.buffered += value.length;
    }
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const chunk = this.chunks[0];
      const avail = chunk.length - this.off;
      const take = Math.min(avail, n - filled);
      out.set(chunk.subarray(this.off, this.off + take), filled);
      filled += take;
      this.off += take;
      this.buffered -= take;
      if (this.off >= chunk.length) {
        this.chunks.shift();
        this.off = 0;
      }
    }
    return out;
  }

  async skip(n: number) {
    let left = n;
    while (left > 0) {
      const take = Math.min(left, 1 << 20);
      await this.pull(take);
      left -= take;
    }
  }

  cancel() {
    void this.reader.cancel().catch(() => undefined);
  }
}

function parseCards(block: Uint8Array): { hdr: Hdr; ended: boolean } {
  const hdr: Hdr = {};
  let ended = false;
  for (let i = 0; i < 2880; i += 80) {
    const card = new TextDecoder("latin1").decode(block.subarray(i, i + 80));
    if (card.startsWith("END")) {
      ended = true;
      break;
    }
    const key = card.slice(0, 8).trim();
    if (!key || key === "COMMENT" || key === "HISTORY" || key === "CONTINUE") continue;
    if (card[8] !== "=") continue;
    let rest = card.slice(10).trim();
    if (rest.startsWith("'")) {
      let end = 1;
      while (end < rest.length) {
        if (rest[end] === "'" && rest[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (rest[end] === "'") break;
        end++;
      }
      hdr[key] = rest.slice(1, end).replace(/''/g, "'").trim();
    } else {
      const slash = rest.indexOf("/");
      if (slash >= 0) rest = rest.slice(0, slash);
      hdr[key] = rest.trim();
    }
  }
  return { hdr, ended };
}

async function readHeader(pump: BytePump): Promise<Hdr> {
  const hdr: Hdr = {};
  for (let b = 0; b < 40; b++) {
    const block = await pump.pull(2880);
    const parsed = parseCards(block);
    Object.assign(hdr, parsed.hdr);
    if (parsed.ended) return hdr;
  }
  throw new Error("FITS header never ended.");
}

function num(hdr: Hdr, key: string, fallback = Number.NaN): number {
  const v = hdr[key];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function dataBytes(hdr: Hdr): number {
  const naxis = num(hdr, "NAXIS", 0);
  if (!naxis) return 0;
  const bitpix = num(hdr, "BITPIX", 0);
  let bytes = Math.abs(bitpix) / 8;
  for (let i = 1; i <= naxis; i++) bytes *= num(hdr, `NAXIS${i}`, 0);
  const pcount = num(hdr, "PCOUNT", 0);
  const gcount = num(hdr, "GCOUNT", 1);
  bytes = (bytes + (Number.isFinite(pcount) ? pcount : 0)) * (gcount || 1);
  return bytes;
}

function pad2880(n: number): number {
  if (!n) return 0;
  return (2880 - (n % 2880)) % 2880;
}

function readPoly(hdr: Hdr, prefix: string): Poly {
  const order = Math.max(0, Math.round(num(hdr, `${prefix}_ORDER`, 0)));
  const m: Poly = Array.from({ length: order + 1 }, () => Array(order + 1).fill(0));
  for (let i = 0; i <= order; i++) {
    for (let j = 0; j <= order - i; j++) {
      m[i][j] = num(hdr, `${prefix}_${i}_${j}`, 0);
    }
  }
  return m;
}

function readSpatial(hdr: Hdr): SpatialWcs {
  const cdelt1 = num(hdr, "CDELT1", 1);
  const cdelt2 = num(hdr, "CDELT2", 1);
  const hasCd = hdr.CD1_1 != null;
  const cd11 = hasCd ? num(hdr, "CD1_1") : num(hdr, "PC1_1", 1) * cdelt1;
  const cd12 = hasCd ? num(hdr, "CD1_2", 0) : num(hdr, "PC1_2", 0) * cdelt1;
  const cd21 = hasCd ? num(hdr, "CD2_1", 0) : num(hdr, "PC2_1", 0) * cdelt2;
  const cd22 = hasCd ? num(hdr, "CD2_2", 1) : num(hdr, "PC2_2", 1) * cdelt2;
  return {
    crpix1: num(hdr, "CRPIX1"),
    crpix2: num(hdr, "CRPIX2"),
    crval1: num(hdr, "CRVAL1"),
    crval2: num(hdr, "CRVAL2"),
    cd11,
    cd12,
    cd21,
    cd22,
    a: readPoly(hdr, "A"),
    b: readPoly(hdr, "B"),
    ap: readPoly(hdr, "AP"),
    bp: readPoly(hdr, "BP"),
  };
}

function decodeImage(buf: Uint8Array, bitpix: number, n: number): Float32Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Float32Array(n);
  if (bitpix === -32) {
    for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, false);
  } else if (bitpix === -64) {
    for (let i = 0; i < n; i++) out[i] = view.getFloat64(i * 8, false);
  } else if (bitpix === 16) {
    for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, false);
  } else if (bitpix === 32) {
    for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4, false);
  } else {
    throw new Error(`Unsupported image BITPIX ${bitpix}`);
  }
  return out;
}

function decodeFlags(buf: Uint8Array, n: number): Int32Array {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4, false);
  return out;
}

type Cutout = {
  w: number;
  h: number;
  image: Float32Array;
  zodi: Float32Array | null;
  flags: Int32Array | null;
  spatial: SpatialWcs;
  wave: WaveTable | null;
  hdr: Hdr;
  pipeline: string;
};

function parseTform(form: string): { count: number; kind: string } {
  const m = /^(\d*)([A-Z])/.exec(form.trim());
  if (!m) return { count: 0, kind: "?" };
  return { count: m[1] ? Number(m[1]) : 1, kind: m[2] };
}

function readWaveTable(hdrImage: Hdr, waveHdr: Hdr, raw: Uint8Array): WaveTable | null {
  const nfields = Math.round(num(waveHdr, "TFIELDS", 0));
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let off = 0;
  const cols: { kind: string; count: number; values: number[] }[] = [];
  for (let c = 1; c <= nfields; c++) {
    const form = parseTform(waveHdr[`TFORM${c}`] ?? "");
    const values: number[] = [];
    for (let i = 0; i < form.count; i++) {
      if (off + 4 > raw.length) break;
      if (form.kind === "J") values.push(view.getInt32(off, false));
      else if (form.kind === "E") values.push(view.getFloat32(off, false));
      else if (form.kind === "D") values.push(view.getFloat64(off, false));
      else if (form.kind === "I") values.push(view.getInt16(off, false));
      const width = form.kind === "D" ? 8 : form.kind === "I" ? 2 : 4;
      off += width;
    }
    cols.push({ ...form, values });
  }
  if (cols.length < 3) return null;
  const xs = cols[0].values.map(Number);
  const ys = cols[1].values.map(Number);
  const vals = cols[2].values;
  const nx = xs.length;
  const ny = ys.length;
  const wave: number[][] = [];
  const band: number[][] = [];
  for (let iy = 0; iy < ny; iy++) {
    const wr: number[] = [];
    const br: number[] = [];
    for (let ix = 0; ix < nx; ix++) {
      const base = (iy * nx + ix) * 2;
      wr.push(vals[base] ?? Number.NaN);
      br.push(vals[base + 1] ?? Number.NaN);
    }
    wave.push(wr);
    band.push(br);
  }
  return {
    crpix1: num(hdrImage, "CRPIX1W", 0),
    crpix2: num(hdrImage, "CRPIX2W", 0),
    crval1: num(hdrImage, "CRVAL1W", 1),
    crval2: num(hdrImage, "CRVAL2W", 1),
    cdelt1: num(hdrImage, "CDELT1W", 1),
    cdelt2: num(hdrImage, "CDELT2W", 1),
    pc11: num(hdrImage, "PC1_1W", 1),
    pc12: num(hdrImage, "PC1_2W", 0),
    pc21: num(hdrImage, "PC2_1W", 0),
    pc22: num(hdrImage, "PC2_2W", 1),
    xs,
    ys,
    wave,
    band,
  };
}

async function openCutout(url: string): Promise<Cutout> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/fits,*/*" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok || !res.body) {
    throw new Error(
      res.status === 503
        ? "The SPHEREx archive is busy. Wait a few seconds and open the field again."
        : `Cutout request failed (${res.status}).`,
    );
  }
  const pump = new BytePump(res.body.getReader());
  try {
    const primary = await readHeader(pump);
    await pump.skip(dataBytes(primary) + pad2880(dataBytes(primary)));
    let image: Float32Array | null = null;
    let zodi: Float32Array | null = null;
    let flags: Int32Array | null = null;
    let spatial: SpatialWcs | null = null;
    let imageHdr: Hdr | null = null;
    let w = 0;
    let h = 0;
    let wave: WaveTable | null = null;
    for (let hdu = 0; hdu < 10; hdu++) {
      const hdr = await readHeader(pump);
      const bytes = dataBytes(hdr);
      const pad = pad2880(bytes);
      const name = (hdr.EXTNAME ?? "").toUpperCase();
      const bitpix = num(hdr, "BITPIX", 0);
      if (name === "IMAGE" && image == null) {
        const raw = await pump.pull(bytes);
        await pump.skip(pad);
        w = Math.round(num(hdr, "NAXIS1"));
        h = Math.round(num(hdr, "NAXIS2"));
        image = decodeImage(raw, bitpix, w * h);
        const bzero = num(hdr, "BZERO", 0);
        const bscale = num(hdr, "BSCALE", 1);
        if (bscale !== 1 || bzero !== 0) {
          for (let i = 0; i < image.length; i++) image[i] = image[i] * bscale + bzero;
        }
        spatial = readSpatial(hdr);
        imageHdr = hdr;
      } else if (name === "ZODI") {
        const raw = await pump.pull(bytes);
        await pump.skip(pad);
        zodi = decodeImage(raw, bitpix, Math.round(num(hdr, "NAXIS1")) * Math.round(num(hdr, "NAXIS2")));
      } else if (name === "FLAGS") {
        const raw = await pump.pull(bytes);
        await pump.skip(pad);
        const fw = Math.round(num(hdr, "NAXIS1"));
        const fh = Math.round(num(hdr, "NAXIS2"));
        flags = bitpix === 32 ? decodeFlags(raw, fw * fh) : null;
      } else if (name === "WCS-WAVE" || name.includes("WAVE")) {
        const raw = await pump.pull(bytes);
        await pump.skip(pad);
        if (imageHdr) wave = readWaveTable(imageHdr, hdr, raw);
        break;
      } else {
        await pump.skip(bytes + pad);
      }
    }
    if (!image || !spatial || !imageHdr) throw new Error("This cutout has no science image.");
    return {
      w,
      h,
      image,
      zodi,
      flags,
      spatial,
      wave,
      hdr: imageHdr,
      pipeline: primary.VERSION ?? "",
    };
  } finally {
    pump.cancel();
  }
}

function sampleBilinear(img: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return Number.NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = img[y0 * w + x0];
  const b = img[y0 * w + x1];
  const c = img[y1 * w + x0];
  const d = img[y1 * w + x1];
  if (![a, b, c, d].every(Number.isFinite)) return Number.NaN;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function f32ToB64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  return bytesToB64(bytes);
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + step));
    s += String.fromCharCode(...slice);
  }
  return btoa(s);
}

const frameCache = new Map<string, FramePayload>();

export async function buildFrame(input: {
  url: string;
  ra: number;
  dec: number;
  sizeDeg: number;
}): Promise<FramePayload> {
  if (!input.url.startsWith("https://irsa.ipac.caltech.edu/ibe/data/spherex/")) {
    throw new Error("Refusing a cutout that is not a SPHEREx IRSA file.");
  }
  const sizeDeg = Math.min(0.35, Math.max(0.04, input.sizeDeg));
  const n = gridSize(sizeDeg);
  const cutUrl = `${input.url}${input.url.includes("?") ? "&" : "?"}center=${input.ra},${input.dec}&size=${sizeDeg}&gzip=false`;
  const key = `${cutUrl}|${n}`;
  const hit = frameCache.get(key);
  if (hit) return hit;

  const cut = await openCutout(cutUrl);
  const flux = new Float32Array(n * n);
  const mask = new Uint8Array(n * n);
  const cx = (cut.w - 1) / 2;
  const cy = (cut.h - 1) / 2;
  let waveUm = Number.NaN;
  let bandUm = Number.NaN;
  if (cut.wave) {
    const wl = wavelengthAt(cut.wave, cx, cy);
    waveUm = wl.wave;
    bandUm = wl.band;
  }
  if (!Number.isFinite(waveUm)) {
    const emMin = num(cut.hdr, "WAVEMIN", Number.NaN);
    waveUm = emMin;
  }

  let finite = 0;
  const flagCounts = new Map<number, number>();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [ra, dec] = canvasToSky(x, y, input.ra, input.dec, sizeDeg, n);
      const [ix, iy] = skyToPixel(cut.spatial, ra, dec);
      const idx = y * n + x;
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) {
        flux[idx] = Number.NaN;
        continue;
      }
      const sci = sampleBilinear(cut.image, cut.w, cut.h, ix, iy);
      const z = cut.zodi ? sampleBilinear(cut.zodi, cut.w, cut.h, ix, iy) : 0;
      const value = Number.isFinite(sci) ? sci - (Number.isFinite(z) ? z : 0) : Number.NaN;
      flux[idx] = value;
      if (Number.isFinite(value)) finite++;
      if (cut.flags) {
        const fx = Math.round(ix);
        const fy = Math.round(iy);
        if (fx >= 0 && fy >= 0 && fx < cut.w && fy < cut.h) {
          const flag = cut.flags[fy * cut.w + fx];
          mask[idx] = classifyFlag(flag);
          for (const def of FLAG_BITS) {
            if (flag & def.bit) flagCounts.set(def.bit, (flagCounts.get(def.bit) ?? 0) + 1);
          }
        }
      }
    }
  }

  const centerVals: number[] = [];
  const r = 2;
  const mid = (n - 1) / 2;
  for (let y = Math.max(0, Math.floor(mid - r)); y <= Math.min(n - 1, Math.ceil(mid + r)); y++) {
    for (let x = Math.max(0, Math.floor(mid - r)); x <= Math.min(n - 1, Math.ceil(mid + r)); x++) {
      if ((x - mid) ** 2 + (y - mid) ** 2 > r * r) continue;
      const v = flux[y * n + x];
      if (Number.isFinite(v)) centerVals.push(v);
    }
  }

  const payload: FramePayload = {
    width: n,
    height: n,
    fluxB64: f32ToB64(flux),
    maskB64: bytesToB64(mask),
    waveUm,
    bandUm,
    centerFlux: median(centerVals),
    coverage: finite / (n * n),
    dateObs: cut.hdr["DATE-OBS"] ?? "",
    mjd: num(cut.hdr, "MJD-OBS", Number.NaN),
    detector: Math.round(num(cut.hdr, "DETECTOR", 0)),
    obsid: cut.hdr.OBSID ?? "",
    exposureSec: num(cut.hdr, "XPOSURE", Number.NaN),
    bunit: cut.hdr.BUNIT || "MJy",
    pipeline: cut.pipeline,
    dq: cut.hdr.L2DQAFLG ?? "",
    zodiRemoved: Boolean(cut.zodi),
    flags: FLAG_BITS.filter((d) => (flagCounts.get(d.bit) ?? 0) > 0)
      .map((d) => ({ name: d.name, count: flagCounts.get(d.bit) ?? 0, kind: d.kind }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    pixelScaleArcsec: (sizeDeg / n) * 3600,
  };
  if (frameCache.size > 24) {
    const oldest = frameCache.keys().next().value;
    if (oldest) frameCache.delete(oldest);
  }
  frameCache.set(key, payload);
  return payload;
}

function detectorOf(band: string): number {
  const m = /D(\d)/.exec(band);
  return m ? Number(m[1]) : 0;
}

function cluster(list: Exposure[], gapDays: number): Exposure[][] {
  if (!list.length) return [];
  const sorted = [...list].sort((a, b) => a.mjd - b.mjd);
  const groups: Exposure[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.mjd - prev.mjd > gapDays) groups.push([cur]);
    else groups[groups.length - 1].push(cur);
  }
  return groups;
}

function sampleEven<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (items.length - 1)) / (max - 1));
    out.push(items[idx]);
  }
  return out;
}

function parseVotable(xml: string): Record<string, string>[] {
  if (/QUERY_STATUS[^>]*value="ERROR"/.test(xml)) {
    const msg = /<INFO[^>]*QUERY_STATUS[^>]*>([\s\S]*?)<\/INFO>/.exec(xml);
    throw new Error(msg?.[1]?.trim() || "IRSA rejected the image search.");
  }
  const tables = [...xml.matchAll(/<TABLE\b[\s\S]*?<\/TABLE>/g)];
  if (!tables.length) return [];
  const table = tables[tables.length - 1][0];
  const fields = [...table.matchAll(/<FIELD\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  const rows: Record<string, string>[] = [];
  for (const tr of table.matchAll(/<TR>([\s\S]*?)<\/TR>/g)) {
    const cells: string[] = [];
    for (const td of tr[1].matchAll(/<TD\b([^>]*)\/>|<TD\b[^>]*>([\s\S]*?)<\/TD>/g)) {
      cells.push((td[2] ?? "").trim());
    }
    if (!cells.length) continue;
    const row: Record<string, string> = {};
    fields.forEach((name, i) => {
      row[name] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

async function queryCollection(collection: string, ra: number, dec: number): Promise<Exposure[]> {
  const params = new URLSearchParams({
    COLLECTION: collection,
    POS: `circle ${ra} ${dec} 0.02`,
    RESPONSEFORMAT: "votable",
    MAXREC: "400",
  });
  const res = await fetch(`https://irsa.ipac.caltech.edu/SIA?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) throw new Error(`IRSA search failed (${res.status}).`);
  const xml = await res.text();
  const rows = parseVotable(xml);
  const out: Exposure[] = [];
  for (const row of rows) {
    const band = row.energy_bandpassname ?? "";
    const detector = detectorOf(band);
    const url = row.access_url ?? "";
    const mjd = Number(row.t_min);
    if (!detector || !url.startsWith("https://") || !Number.isFinite(mjd)) continue;
    if ((row.dataproduct_subtype ?? "science") !== "science") continue;
    out.push({
      url: url.split("?")[0],
      band,
      detector,
      mjd,
      iso: mjdToIso(mjd),
      obsId: row.obs_id ?? "",
      collection: row.obs_collection || collection,
      emMinUm: Number(row.em_min) * 1e6,
      emMaxUm: Number(row.em_max) * 1e6,
    });
  }
  return out;
}

export async function searchSpherex(ra: number, dec: number, detector: number): Promise<SearchPlan> {
  const settled = await Promise.allSettled(
    SPHEREX_COLLECTIONS.map((c) => queryCollection(c, ra, dec)),
  );
  const merged = new Map<string, Exposure>();
  const collections: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status !== "fulfilled") continue;
    if (!result.value.length) continue;
    collections.push(SPHEREX_COLLECTIONS[i]);
    for (const exp of result.value) {
      const key = `${exp.obsId}|${exp.band}|${exp.mjd.toFixed(4)}`;
      if (!merged.has(key)) merged.set(key, exp);
    }
  }
  if (!merged.size) {
    const reason = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(
      reason?.reason instanceof Error
        ? reason.reason.message
        : "No SPHEREx images cover that coordinate yet. Try one of the demo stars.",
    );
  }
  const all = [...merged.values()];
  const byDetector: Record<string, number> = {};
  for (const exp of all) {
    const k = String(exp.detector);
    byDetector[k] = (byDetector[k] ?? 0) + 1;
  }
  let detectorUsed = detector;
  if (!byDetector[String(detector)]) {
    detectorUsed = Number(
      Object.entries(byDetector).sort((a, b) => b[1] - a[1])[0]?.[0] ?? detector,
    );
  }
  const forDet = all.filter((e) => e.detector === detectorUsed);
  const epochs = cluster(forDet, 30);
  let blink: Exposure[];
  if (epochs.length >= 2) {
    blink = sampleEven(epochs, 8).map((ep) => ep[Math.floor(ep.length / 2)]);
  } else {
    blink = sampleEven(forDet, 8);
  }
  const specEpochs = cluster(all, 30).slice(-2);
  const spectral: Exposure[] = [];
  for (const ep of specEpochs) {
    for (const d of [1, 2, 3, 4, 5, 6]) {
      const subset = ep.filter((e) => e.detector === d);
      if (subset.length) spectral.push(subset[Math.floor(subset.length / 2)]);
    }
  }
  const mjds = all.map((e) => e.mjd);
  return {
    total: all.length,
    byDetector,
    collections,
    detectorUsed,
    blink,
    spectral,
    mjdMin: mjds.length ? Math.min(...mjds) : null,
    mjdMax: mjds.length ? Math.max(...mjds) : null,
  };
}

function parseVizier(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/);
  let header: string[] | null = null;
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (!header) {
      header = cols.map((c) => c.trim());
      continue;
    }
    const unitish = cols.every((c) => {
      const t = c.trim();
      return !t || /^-+$/.test(t) || /^[a-zA-Z/μ]+$/.test(t);
    });
    if (unitish) continue;
    rows.push(cols.map((c) => c.trim()));
  }
  return { header: header ?? [], rows };
}

function col(header: string[], row: string[], names: string[]): number | null {
  for (const name of names) {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i < 0) continue;
    const n = Number(row[i]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function loadOverlays(ra: number, dec: number, radiusDeg: number): Promise<OverlayPayload> {
  const radius = Math.min(0.25, Math.max(0.02, radiusDeg));
  const gaiaQuery = `SELECT TOP 50 ra, dec, phot_g_mean_mag, parallax, pmra, pmdec FROM gaiadr3.gaia_source WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${radius}))=1 AND phot_g_mean_mag < 18.5 ORDER BY phot_g_mean_mag`;
  const gaiaUrl =
    "https://gea.esac.esa.int/tap-server/tap/sync?" +
    new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "json", QUERY: gaiaQuery });
  const wiseUrl =
    "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?" +
    new URLSearchParams({
      "-source": "II/328/allwise",
      "-c": `${ra} ${dec}`,
      "-c.rs": String(Math.round(radius * 3600)),
      "-out.max": "40",
      "-out": "RAJ2000,DEJ2000,W1mag,W2mag,W3mag,W4mag",
    });

  const [gaiaRes, wiseRes] = await Promise.allSettled([
    fetch(gaiaUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as { data?: unknown[][] };
    }),
    fetch(wiseUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) }).then(async (r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.text();
    }),
  ]);

  const gaia: CatalogSource[] = [];
  let gaiaNote = "Gaia DR3";
  if (gaiaRes.status === "fulfilled") {
    for (const row of gaiaRes.value.data ?? []) {
      const gra = Number(row[1]);
      const gdec = Number(row[2]);
      if (!Number.isFinite(gra) || !Number.isFinite(gdec)) continue;
      gaia.push({
        ra: gra,
        dec: gdec,
        mag: Number.isFinite(Number(row[3])) ? Number(row[3]) : null,
        label: `G ${Number(row[3]).toFixed(1)}`,
        kind: "gaia",
        pmra: Number.isFinite(Number(row[5])) ? Number(row[5]) : null,
        pmdec: Number.isFinite(Number(row[6])) ? Number(row[6]) : null,
      });
    }
    gaiaNote = "Gaia DR3, positions shifted to each SPHEREx date by proper motion.";
  } else {
    gaiaNote = "Gaia is not responding right now.";
  }

  const wise: CatalogSource[] = [];
  let wiseNote = "AllWISE";
  if (wiseRes.status === "fulfilled") {
    const parsed = parseVizier(wiseRes.value);
    for (const row of parsed.rows) {
      const wra = col(parsed.header, row, ["RAJ2000", "_RAJ2000"]);
      const wdec = col(parsed.header, row, ["DEJ2000", "_DEJ2000"]);
      if (wra == null || wdec == null) continue;
      const w1 = col(parsed.header, row, ["W1mag"]);
      const w2 = col(parsed.header, row, ["W2mag"]);
      const color = w1 != null && w2 != null ? w1 - w2 : null;
      wise.push({
        ra: wra,
        dec: wdec,
        mag: w1,
        label: color != null ? `W1−W2 ${color.toFixed(2)}` : "WISE",
        kind: "wise",
        pmra: null,
        pmdec: null,
      });
    }
    wiseNote = "AllWISE (about 2010). Positions are not proper-motion corrected — fast movers will have drifted.";
  } else {
    wiseNote = "AllWISE is not responding right now.";
  }

  return { gaia, wise, gaiaNote, wiseNote };
}
