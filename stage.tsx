import { useEffect, type RefObject } from "react";
import { skyToCanvas } from "@/lib/spherex/wcs";
import type { CatalogSource } from "@/lib/spherex/types";

type Props = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  flux: Float32Array | null;
  mask: Uint8Array | null;
  size: number;
  lo: number;
  hi: number;
  contrast: number;
  diverging: boolean;
  showFlags: boolean;
  showGaia: boolean;
  showWise: boolean;
  gaia: CatalogSource[];
  wise: CatalogSource[];
  ra: number;
  dec: number;
  sizeDeg: number;
  mjd: number | null;
  pixelScale: number;
};

const GAIA_EPOCH = 57388.5;

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function plateColor(t: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 16, 14, 12],
    [0.42, 96, 38, 18],
    [0.75, 224, 112, 58],
    [1, 244, 239, 228],
  ];
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const u = (x - a[0]) / (b[0] - a[0] || 1);
  return [mix(a[1], b[1], u), mix(a[2], b[2], u), mix(a[3], b[3], u)];
}

function shade(v: number, lo: number, hi: number, contrast: number) {
  if (!Number.isFinite(v)) return 0;
  const span = Math.max(1e-6, hi - lo);
  const beta = span / (3.2 * Math.max(0.35, contrast));
  const x = Math.max(0, v - lo);
  return Math.asinh(x / beta) / Math.asinh(span / beta);
}

function paint(canvas: HTMLCanvasElement, props: Props) {
  const n = props.size || 64;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const css = canvas.clientWidth || 640;
  canvas.width = Math.round(css * dpr);
  canvas.height = Math.round(css * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = css / n;
  const img = ctx.createImageData(n, n);
  const flux = props.flux;
  const limit = Math.max(Math.abs(props.lo), Math.abs(props.hi), 1e-4);
  for (let i = 0; i < n * n; i++) {
    const v = flux ? flux[i] : Number.NaN;
    let rgb: [number, number, number];
    if (!flux || !Number.isFinite(v)) {
      rgb = [14, 13, 11];
    } else if (props.diverging) {
      const t = Math.max(-1, Math.min(1, v / limit));
      rgb =
        t >= 0
          ? plateColor(t)
          : [mix(16, 244, Math.abs(t)), mix(14, 239, Math.abs(t)), mix(12, 228, Math.abs(t))];
    } else {
      rgb = plateColor(shade(v, props.lo, props.hi, props.contrast));
    }
    if (props.showFlags && props.mask) {
      const m = props.mask[i];
      if (m === 3) rgb = [rgb[0] * 0.45, rgb[1] * 0.45, rgb[2] * 0.45];
      else if (m === 2) rgb = [Math.min(255, rgb[0] * 0.65 + 90), rgb[1] * 0.55, rgb[2] * 0.45];
    }
    const o = i * 4;
    img.data[o] = rgb[0];
    img.data[o + 1] = rgb[1];
    img.data[o + 2] = rgb[2];
    img.data[o + 3] = 255;
  }
  const off = document.createElement("canvas");
  off.width = n;
  off.height = n;
  off.getContext("2d")?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#12110e";
  ctx.fillRect(0, 0, css, css);
  ctx.drawImage(off, 0, 0, css, css);

  ctx.strokeStyle = "rgba(244,239,228,0.45)";
  ctx.lineWidth = 1;
  const tick = 14;
  const inset = 10;
  const corners = [
    [inset, inset, 1, 1],
    [css - inset, inset, -1, 1],
    [inset, css - inset, 1, -1],
    [css - inset, css - inset, -1, -1],
  ] as const;
  ctx.beginPath();
  for (const [x, y, sx, sy] of corners) {
    ctx.moveTo(x, y + sy * tick);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * tick, y);
  }
  ctx.stroke();

  const mid = css / 2;
  ctx.strokeStyle = "rgba(244,239,228,0.35)";
  ctx.beginPath();
  ctx.moveTo(mid - 8, mid);
  ctx.lineTo(mid + 8, mid);
  ctx.moveTo(mid, mid - 8);
  ctx.lineTo(mid, mid + 8);
  ctx.stroke();

  ctx.fillStyle = "rgba(244,239,228,0.85)";
  ctx.font = "600 12px Figtree, sans-serif";
  ctx.fillText("N", css - 28, 28);
  ctx.beginPath();
  ctx.moveTo(css - 22, 34);
  ctx.lineTo(css - 22, 58);
  ctx.moveTo(css - 22, 34);
  ctx.lineTo(css - 27, 42);
  ctx.moveTo(css - 22, 34);
  ctx.lineTo(css - 17, 42);
  ctx.stroke();

  const arcsec = props.pixelScale || 6;
  let barArc = 30;
  if (barArc / arcsec < 24) barArc = 60;
  if (barArc / arcsec > css * 0.4) barArc = 15;
  const barPx = barArc / arcsec;
  ctx.strokeStyle = "rgba(244,239,228,0.8)";
  ctx.beginPath();
  ctx.moveTo(18, css - 22);
  ctx.lineTo(18 + barPx, css - 22);
  ctx.stroke();
  ctx.fillText(`${barArc}″`, 18, css - 30);

  const drawMarker = (source: CatalogSource, gaia: boolean) => {
    let ra = source.ra;
    let dec = source.dec;
    if (gaia && props.mjd && source.pmra != null && source.pmdec != null) {
      const dt = (props.mjd - GAIA_EPOCH) / 365.25;
      const cos = Math.cos((dec * Math.PI) / 180);
      ra += (source.pmra * dt) / 3_600_000 / (cos || 1);
      dec += (source.pmdec * dt) / 3_600_000;
    }
    const [x, y] = skyToCanvas(ra, dec, props.ra, props.dec, props.sizeDeg, n);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const px = (x + 0.5) * scale;
    const py = (y + 0.5) * scale;
    if (px < 0 || py < 0 || px > css || py > css) return;
    ctx.beginPath();
    if (gaia) {
      ctx.strokeStyle = "rgba(244,239,228,0.9)";
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(224,112,58,0.95)";
      ctx.strokeRect(px - 6, py - 6, 12, 12);
    }
  };
  if (props.showGaia) props.gaia.forEach((source) => drawMarker(source, true));
  if (props.showWise) props.wise.forEach((source) => drawMarker(source, false));
}

export function Stage(props: Props) {
  useEffect(() => {
    const canvas = props.canvasRef.current;
    if (!canvas) return;
    const draw = () => paint(canvas, props);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [props]);

  return (
    <canvas ref={props.canvasRef} className="aspect-square h-auto w-full" aria-label="SPHEREx sky plate" />
  );
}
