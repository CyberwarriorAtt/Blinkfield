import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Copy, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { fetchFrame, fetchOverlays, searchField } from "@/lib/spherex/api";
import { formatDec, formatRa, formatWhen, parseDec, parseRa } from "@/lib/spherex/coords";
import { meanStack, peakResidual, percentiles, subtract, b64ToBytes, b64ToF32 } from "@/lib/spherex/pixels";
import { DETECTORS, PRESETS } from "@/lib/spherex/presets";
import type { Exposure, FlagCount, OverlayPayload, SearchPlan } from "@/lib/spherex/types";
import { SpectrumChart, type SpectrumPoint } from "@/components/blinkfield/spectrum";
import { Stage } from "@/components/blinkfield/stage";

export type SkySearch = { ra: number; dec: number; fov: number; det: number };

type Plate = {
  key: string;
  flux: Float32Array;
  mask: Uint8Array;
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
  width: number;
  iso: string;
};

type Props = {
  search: SkySearch;
  onSearch: (next: SkySearch) => void;
};

async function mapPool<T>(items: T[], limit: number, job: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await job(item);
    }
  });
  await Promise.all(workers);
}

function epochName(mjd: number): string {
  const iso = new Date((mjd - 40587) * 86400000).toISOString();
  return iso.slice(0, 7);
}

export function Blinkfield({ search, onSearch }: Props) {
  const [raText, setRaText] = useState(search.ra.toFixed(6));
  const [decText, setDecText] = useState(search.dec.toFixed(6));
  const [fov, setFov] = useState(search.fov);
  const [det, setDet] = useState(search.det);
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [frames, setFrames] = useState<Plate[]>([]);
  const [spectral, setSpectral] = useState<Plate[]>([]);
  const [reel, setReel] = useState<"time" | "spectrum">("time");
  const [view, setView] = useState<"frame" | "difference" | "stack">("frame");
  const [index, setIndex] = useState(0);
  const [refIndex, setRefIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);
  const [contrast, setContrast] = useState(1);
  const [showGaia, setShowGaia] = useState(true);
  const [showWise, setShowWise] = useState(true);
  const [showFlags, setShowFlags] = useState(false);
  const [overlays, setOverlays] = useState<OverlayPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [specBusy, setSpecBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [log, setLog] = useState("");
  const gen = useRef(0);
  const cache = useRef(new Map<string, Plate>());
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const list = reel === "spectrum" && spectral.length ? spectral : frames;
  const ordered = useMemo(() => {
    if (reel === "spectrum") return [...list].sort((a, b) => a.waveUm - b.waveUm);
    return list;
  }, [list, reel]);
  const current = ordered[Math.min(index, Math.max(0, ordered.length - 1))] ?? null;
  const reference = ordered[Math.min(refIndex, Math.max(0, ordered.length - 1))] ?? null;

  const shown = useMemo(() => {
    if (!current) return null;
    if (view === "stack" && ordered.length > 1) return meanStack(ordered.map((f) => f.flux));
    if (view === "difference" && reference && reference.key !== current.key) {
      return subtract(current.flux, reference.flux);
    }
    return current.flux;
  }, [current, reference, ordered, view]);

  const stretch = useMemo(() => {
    if (!shown) return { lo: 0, hi: 1 };
    if (view === "difference") {
      const p = percentiles(shown, 0.02, 0.98);
      const lim = Math.max(Math.abs(p.lo), Math.abs(p.hi), 1e-4);
      return { lo: -lim, hi: lim };
    }
    return percentiles(shown, 0.1, 0.995);
  }, [shown, view]);

  const residual =
    view === "difference" && shown && current
      ? peakResidual(shown, current.width, current.pixelScaleArcsec)
      : null;

  useEffect(() => {
    const key = `blinkfield-log:${search.ra.toFixed(3)}:${search.dec.toFixed(3)}`;
    setLog(localStorage.getItem(key) ?? "");
  }, [search.ra, search.dec]);

  useEffect(() => {
    const key = `blinkfield-log:${search.ra.toFixed(3)}:${search.dec.toFixed(3)}`;
    localStorage.setItem(key, log);
  }, [log, search.ra, search.dec]);

  useEffect(() => {
    setRaText(search.ra.toFixed(6));
    setDecText(search.dec.toFixed(6));
    setFov(search.fov);
    setDet(search.det);
    void run(search);
    // run is intentionally tied to the URL, not its identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.ra, search.dec, search.fov, search.det]);

  useEffect(() => {
    if (!playing || ordered.length < 2) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % ordered.length);
    }, speed);
    return () => window.clearInterval(id);
  }, [playing, ordered.length, speed]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "ArrowRight") setIndex((i) => Math.min(ordered.length - 1, i + 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered.length]);

  async function pull(exp: Exposure, sky: SkySearch): Promise<Plate> {
    const sizeDeg = sky.fov / 60;
    const key = `${exp.url}|${sky.ra.toFixed(5)}|${sky.dec.toFixed(5)}|${sizeDeg.toFixed(4)}`;
    const cached = cache.current.get(key);
    if (cached) return cached;
    const payload = await fetchFrame({
      data: { url: exp.url, ra: sky.ra, dec: sky.dec, sizeDeg },
    });
    const plate: Plate = {
      key,
      flux: b64ToF32(payload.fluxB64),
      mask: b64ToBytes(payload.maskB64),
      waveUm: payload.waveUm,
      bandUm: payload.bandUm,
      centerFlux: payload.centerFlux,
      coverage: payload.coverage,
      dateObs: payload.dateObs,
      mjd: Number.isFinite(payload.mjd) ? payload.mjd : exp.mjd,
      detector: payload.detector || exp.detector,
      obsid: payload.obsid || exp.obsId,
      exposureSec: payload.exposureSec,
      bunit: payload.bunit,
      pipeline: payload.pipeline,
      dq: payload.dq,
      zodiRemoved: payload.zodiRemoved,
      flags: payload.flags,
      pixelScaleArcsec: payload.pixelScaleArcsec,
      width: payload.width,
      iso: exp.iso,
    };
    cache.current.set(key, plate);
    return plate;
  }

  async function run(sky: SkySearch) {
    const id = ++gen.current;
    setError("");
    setBusy(true);
    setPlaying(false);
    setReel("time");
    setView("frame");
    setFrames([]);
    setSpectral([]);
    setIndex(0);
    setRefIndex(0);
    setPlan(null);
    setOverlays(null);
    setProgress({ done: 0, total: 0, label: "Asking IRSA which exposures cover this coordinate" });
    try {
      const found = await searchField({ data: { ra: sky.ra, dec: sky.dec, detector: sky.det } });
      if (gen.current !== id) return;
      setPlan(found);
      if (!found.blink.length) throw new Error("The archive has exposures, but none could be queued.");
      const got: Plate[] = [];
      let failed = 0;
      await mapPool(found.blink, 3, async (exp) => {
        try {
          const plate = await pull(exp, sky);
          if (gen.current !== id) return;
          got.push(plate);
          setFrames([...got].sort((a, b) => a.mjd - b.mjd));
          setProgress({
            done: got.length,
            total: found.blink.length,
            label: formatWhen(plate.dateObs || plate.iso),
          });
        } catch (err) {
          failed += 1;
          if (gen.current === id && failed === found.blink.length && got.length === 0) {
            throw err;
          }
        }
      });
      if (gen.current !== id) return;
      if (!got.length) throw new Error("Every cutout failed. The archive may be busy — try again.");
      setBusy(false);
      void loadCatalog(sky, id);
    } catch (err) {
      if (gen.current !== id) return;
      setBusy(false);
      setError(err instanceof Error ? err.message : "The archive did not answer.");
    }
  }

  async function loadCatalog(sky: SkySearch, id: number) {
    try {
      const overlay = await fetchOverlays({
        data: { ra: sky.ra, dec: sky.dec, radiusDeg: sky.fov / 60 / 2 },
      });
      if (gen.current === id) setOverlays(overlay);
    } catch {
      if (gen.current === id) {
        setOverlays({
          gaia: [],
          wise: [],
          gaiaNote: "Catalog overlay failed.",
          wiseNote: "",
        });
      }
    }
  }

  async function loadSpectral() {
    if (!plan?.spectral.length) return;
    const id = gen.current;
    const sky = search;
    setSpecBusy(true);
    setError("");
    const got: Plate[] = [];
    try {
      await mapPool(plan.spectral, 3, async (exp) => {
        const plate = await pull(exp, sky);
        if (gen.current !== id) return;
        got.push(plate);
        setSpectral([...got]);
        setProgress({ done: got.length, total: plan.spectral.length, label: `D${plate.detector}` });
      });
      if (gen.current !== id) return;
      setReel("spectrum");
      setView("frame");
      setIndex(0);
      setSpecBusy(false);
    } catch (err) {
      if (gen.current !== id) return;
      setSpecBusy(false);
      setError(err instanceof Error ? err.message : "Spectral scan failed.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const ra = parseRa(raText);
    const dec = parseDec(decText);
    if (ra == null || dec == null) {
      setError("Could not read that coordinate. Use decimal degrees or 17h 57m 48s / +04° 41′ 36″.");
      return;
    }
    const next = { ra, dec, fov, det };
    const same =
      Math.abs(next.ra - search.ra) < 1e-8 &&
      Math.abs(next.dec - search.dec) < 1e-8 &&
      next.fov === search.fov &&
      next.det === search.det;
    onSearch(next);
    if (same) void run(next);
  }

  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `blinkfield-${search.ra.toFixed(3)}-${search.dec.toFixed(3)}.png`;
    a.click();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const points: SpectrumPoint[] = spectral
    .filter((p) => Number.isFinite(p.waveUm) && Number.isFinite(p.centerFlux))
    .map((p) => ({
      wave: p.waveUm,
      flux: p.centerFlux,
      epoch: epochName(p.mjd),
      detector: `D${p.detector}`,
      when: p.dateObs || p.iso,
    }));

  const detInfo = DETECTORS.find((d) => d.id === (plan?.detectorUsed ?? det));
  const ratio = progress.total ? progress.done / progress.total : busy ? 0.08 : 0;
  const preset = PRESETS.find(
    (p) => Math.abs(p.ra - search.ra) < 0.02 && Math.abs(p.dec - search.dec) < 0.02,
  );

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-5">
          <div>
            <p className="text-xs tracking-widest text-ember uppercase">NASA Space Apps 2026</p>
            <h1 className="font-display text-4xl leading-none text-fg sm:text-5xl">Blinkfield</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              SPHEREx photographs the whole sky every six months in 102 infrared colors. Blinkfield lines those
              visits up, north-up, so a shift or a flicker is obvious.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex min-h-11 items-center gap-2 border border-line bg-surface px-4 text-sm text-fg"
          >
            <Copy className="size-4" aria-hidden />
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-12">
        <form onSubmit={submit} className="flex flex-col gap-4 lg:col-span-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs tracking-widest text-muted uppercase">Test fields</p>
            <div className="flex flex-col gap-2">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    onSearch({ ra: item.ra, dec: item.dec, fov: item.fov, det: item.detector })
                  }
                  className={`min-h-11 border px-3 py-2 text-left text-sm ${
                    preset?.id === item.id
                      ? "border-ember bg-ember-ink text-fg"
                      : "border-line bg-surface text-fg"
                  }`}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Right ascension</span>
            <input
              value={raText}
              onChange={(e) => setRaText(e.target.value)}
              className="min-h-11 border border-line bg-bg px-3 text-fg"
              inputMode="decimal"
              aria-label="Right ascension"
            />
            <span className="text-xs text-muted">{formatRa(search.ra)}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Declination</span>
            <input
              value={decText}
              onChange={(e) => setDecText(e.target.value)}
              className="min-h-11 border border-line bg-bg px-3 text-fg"
              inputMode="decimal"
              aria-label="Declination"
            />
            <span className="text-xs text-muted">{formatDec(search.dec)}</span>
          </label>

          <label className="flex flex-col gap-2 text-sm">
            <span className="flex justify-between text-muted">
              Field of view <span className="text-fg">{fov}′</span>
            </span>
            <input
              type="range"
              min={4}
              max={20}
              step={1}
              value={fov}
              onChange={(e) => setFov(Number(e.target.value))}
              aria-label="Field of view in arcminutes"
            />
          </label>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">Detector</p>
            <div className="grid grid-cols-6 gap-1">
              {DETECTORS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDet(d.id)}
                  className={`min-h-11 text-sm ${det === d.id ? "bg-ember text-bg" : "bg-surface text-fg"}`}
                  title={d.range}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{detInfo?.range}. Wider fields catch faster movers and take longer.</p>
          </div>

          <button type="submit" className="min-h-11 bg-ember px-4 text-sm font-medium text-bg" disabled={busy}>
            {busy ? "Opening the field…" : "Open field"}
          </button>
          {error ? <p className="text-sm text-ember">{error}</p> : null}
          {preset ? <p className="text-sm leading-relaxed text-muted">{preset.note}</p> : null}
        </form>

        <section className="min-w-0 lg:col-span-6">
          <div className="border border-line bg-surface p-2">
            <Stage
              canvasRef={canvasRef}
              flux={shown}
              mask={current?.mask ?? null}
              size={current?.width ?? 96}
              lo={stretch.lo}
              hi={stretch.hi}
              contrast={contrast}
              diverging={view === "difference"}
              showFlags={showFlags}
              showGaia={showGaia}
              showWise={showWise}
              gaia={overlays?.gaia ?? []}
              wise={overlays?.wise ?? []}
              ra={search.ra}
              dec={search.dec}
              sizeDeg={search.fov / 60}
              mjd={current?.mjd ?? null}
              pixelScale={current?.pixelScaleArcsec ?? (search.fov * 60) / 96}
            />
            {(busy || specBusy) && (
              <div className="mt-2 h-1 bg-bg">
                <div className="h-full origin-left bg-ember" style={{ transform: `scaleX(${ratio})` }} />
              </div>
            )}
            <p className="mt-2 px-1 text-xs text-muted">
              {busy || specBusy
                ? progress.label || "Working"
                : current
                  ? `${formatWhen(current.dateObs || current.iso)} UTC · D${current.detector} · ${
                      Number.isFinite(current.waveUm) ? `${current.waveUm.toFixed(3)} μm` : "wavelength n/a"
                    }`
                  : "Pick a field. Plates are registered north-up before they are blinked."}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center border border-line bg-surface"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              aria-label="Previous frame"
            >
              <SkipBack className="size-4" />
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 bg-ember px-4 text-sm text-bg"
              onClick={() => setPlaying((p) => !p)}
              disabled={ordered.length < 2}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 min-w-11 items-center justify-center border border-line bg-surface"
              onClick={() => setIndex((i) => Math.min(ordered.length - 1, i + 1))}
              aria-label="Next frame"
            >
              <SkipForward className="size-4" />
            </button>
            <label className="flex items-center gap-2 text-xs text-muted">
              Pace
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="min-h-11 border border-line bg-bg px-2 text-fg"
              >
                <option value={1400}>Slow</option>
                <option value={800}>Steady</option>
                <option value={350}>Fast</option>
              </select>
            </label>
            <span className="text-sm text-muted">
              {ordered.length ? `${Math.min(index, ordered.length - 1) + 1} / ${ordered.length}` : "—"}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["frame", "Single"],
                ["difference", "Difference"],
                ["stack", "Stack"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`min-h-11 px-3 text-sm ${view === id ? "bg-fg text-bg" : "border border-line bg-surface text-fg"}`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void loadSpectral()}
              disabled={!plan || specBusy}
              className={`min-h-11 px-3 text-sm ${
                reel === "spectrum" ? "bg-ember text-bg" : "border border-line bg-surface text-fg"
              }`}
            >
              {specBusy ? "Scanning…" : "Spectral scan"}
            </button>
            {reel === "spectrum" ? (
              <button
                type="button"
                onClick={() => {
                  setReel("time");
                  setIndex(0);
                }}
                className="min-h-11 border border-line px-3 text-sm"
              >
                Back to time
              </button>
            ) : null}
          </div>

          {view === "difference" && ordered.length > 1 ? (
            <label className="mt-3 flex flex-col gap-1 text-sm text-muted">
              Subtract this reference
              <select
                value={refIndex}
                onChange={(e) => setRefIndex(Number(e.target.value))}
                className="min-h-11 border border-line bg-bg px-2 text-fg"
              >
                {ordered.map((frame, i) => (
                  <option key={frame.key} value={i}>
                    {formatWhen(frame.dateObs || frame.iso)} · D{frame.detector}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {residual ? (
            <p className="mt-3 text-sm text-muted">
              Brightest residual is {Math.abs(residual.eastArcsec).toFixed(0)}″{" "}
              {residual.eastArcsec >= 0 ? "east" : "west"} and {Math.abs(residual.northArcsec).toFixed(0)}″{" "}
              {residual.northArcsec >= 0 ? "north" : "south"} of the coordinate (
              {residual.value > 0 ? "excess" : "deficit"}). A true mover should sit off-center and not be a flagged
              ghost.
            </p>
          ) : null}

          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {ordered.map((frame, i) => (
              <button
                key={frame.key}
                type="button"
                onClick={() => {
                  setIndex(i);
                  setPlaying(false);
                }}
                className={`min-w-28 shrink-0 border px-2 py-2 text-left text-xs ${
                  i === index ? "border-ember text-fg" : "border-line text-muted"
                }`}
              >
                <span className="block text-sm text-fg">
                  {reel === "spectrum" && Number.isFinite(frame.waveUm)
                    ? `${frame.waveUm.toFixed(2)} μm`
                    : formatWhen(frame.dateObs || frame.iso).slice(0, 11)}
                </span>
                D{frame.detector}
                {Number.isFinite(frame.waveUm) ? ` · ${frame.waveUm.toFixed(2)} μm` : ""}
              </button>
            ))}
          </div>
        </section>

        <aside className="flex flex-col gap-4 lg:col-span-3">
          <div className="border border-line bg-surface p-4">
            <p className="text-xs tracking-widest text-muted uppercase">This plate</p>
            {current ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted">When</dt>
                <dd>{formatWhen(current.dateObs || current.iso)}</dd>
                <dt className="text-muted">Detector</dt>
                <dd>
                  D{current.detector}
                  {Number.isFinite(current.waveUm) ? ` · ${current.waveUm.toFixed(3)} μm` : ""}
                </dd>
                <dt className="text-muted">Aperture</dt>
                <dd>
                  {Number.isFinite(current.centerFlux) ? current.centerFlux.toFixed(3) : "—"} {current.bunit}
                </dd>
                <dt className="text-muted">Bandwidth</dt>
                <dd>{Number.isFinite(current.bandUm) ? `${current.bandUm.toFixed(3)} μm` : "—"}</dd>
                <dt className="text-muted">Exposure</dt>
                <dd>{Number.isFinite(current.exposureSec) ? `${current.exposureSec.toFixed(0)} s` : "—"}</dd>
                <dt className="text-muted">Coverage</dt>
                <dd>{Math.round(current.coverage * 100)}%</dd>
                <dt className="text-muted">Pipeline</dt>
                <dd>{current.pipeline || "—"}</dd>
                <dt className="text-muted">Quality</dt>
                <dd>{current.dq || "—"}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted">Metadata appears with the first plate.</p>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {current?.zodiRemoved
                ? "Zodiacal light from the pipeline ZODI extension has been removed, so stars and dwarfs sit above a darker floor."
                : "No zodiacal model was attached to this cutout."}
              {current && current.coverage < 0.6
                ? " Part of the field is empty because the target sits near the edge of the detector."
                : ""}
            </p>
            {current?.flags.length ? (
              <ul className="mt-3 flex flex-col gap-1 text-xs text-muted">
                {current.flags.map((flag) => (
                  <li key={flag.name}>
                    {flag.name}: {flag.count} px
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs text-muted">ObsID {current?.obsid || "—"}</p>
          </div>

          <div className="border border-line bg-surface p-4">
            <p className="text-xs tracking-widest text-muted uppercase">Display</p>
            <label className="mt-3 flex flex-col gap-2 text-sm text-muted">
              Contrast
              <input
                type="range"
                min={0.4}
                max={2.4}
                step={0.1}
                value={contrast}
                onChange={(e) => setContrast(Number(e.target.value))}
              />
            </label>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <Toggle on={showFlags} set={setShowFlags} label="Contamination flags" />
              <Toggle on={showGaia} set={setShowGaia} label="Gaia DR3" />
              <Toggle on={showWise} set={setShowWise} label="AllWISE" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Ivory rings are Gaia, shifted from 2016 to the plate date by proper motion. Ember squares are AllWISE
              and stay at their 2010 positions. {overlays?.gaiaNote} {overlays?.wiseNote}
            </p>
            <button type="button" onClick={savePng} className="mt-3 min-h-11 border border-line px-3 text-sm">
              Save plate PNG
            </button>
          </div>

          <div className="border border-line bg-surface p-4">
            <p className="text-xs tracking-widest text-muted uppercase">Spectrum at the coordinate</p>
            <div className="mt-3">
              <SpectrumChart points={points} />
            </div>
            <p className="mt-2 text-xs text-muted">
              Median of the central few pixels after zodiacal subtraction, one exposure per detector. Not a
              PSF-weighted pipeline spectrum — a fast look for cold, red, or variable targets.
            </p>
          </div>
        </aside>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-12">
        {plan ? (
          <p className="text-sm text-muted">
            {plan.total} SPHEREx exposures from {plan.collections.join(" + ") || "IRSA"} between the first and latest
            release in the search. Time reel uses D{plan.detectorUsed}
            {plan.byDetector[String(plan.detectorUsed)]
              ? ` (${plan.byDetector[String(plan.detectorUsed)]} frames in the archive, ${frames.length} developed)`
              : ""}
            .
          </p>
        ) : null}

        <section className="border border-line bg-surface p-4">
          <h2 className="font-display text-2xl">Field guide</h2>
          <div className="mt-3 grid gap-4 text-sm leading-relaxed text-muted md:grid-cols-2">
            <p>
              Enter a coordinate, or open one of the five challenge fields. Blinkfield asks IRSA for every SPHEREx
              spectral image that covers the point, then downloads a small cutout of each chosen visit. Each raw frame
              is rotated differently. They are reprojected onto one north-up grid before you ever see them, which is
              the only way a blink means motion and not spacecraft roll.
            </p>
            <p>
              SPHEREx pixels are 6.2″ across. Barnard's Star moves about 10″ a year, so the shift is one or two pixels
              between survey passes. Use Difference, not just Play. Variable stars such as RW Aurigae and R Draconis
              mostly change brightness: open Spectral scan and compare the two epoch lines.
            </p>
            <p>
              The six detectors are not six pictures of the same color. Each is a linear variable filter, so the
              wavelength printed on a plate is the color at this coordinate, read from the WCS-WAVE table. Stacking a
              detector improves the signal. Subtracting two epochs hunts movers. Flags mark ghosts, streaks, blooms
              and known sources — check them before calling a residual a discovery.
            </p>
            <p>
              The URL keeps the coordinate, field of view and detector, so a link can be embedded elsewhere. New IRSA
              collections are a one-line list in the data module, which is how the tool stays current as Quick
              Releases and the yearly reprocessing arrive. Coordinates can be decimal degrees or sexagesimal.
            </p>
          </div>
        </section>

        <label className="flex flex-col gap-2 text-sm">
          <span className="text-muted">Observer log, kept in this browser</span>
          <textarea
            value={log}
            onChange={(e) => setLog(e.target.value)}
            rows={3}
            className="border border-line bg-surface px-3 py-2 text-fg"
            placeholder="What moved, what flickered, what was just a ghost."
          />
        </label>

        <footer className="text-xs leading-relaxed text-muted">
          NASA does not endorse this project and is not responsible for it. Images are public SPHEREx products from
          the NASA/IPAC Infrared Science Archive. Gaia DR3 is from ESA. AllWISE is served by VizieR at the
          Harvard–Smithsonian Center for Astrophysics. This is a looking tool, not a substitute for the SPHEREx
          pipeline spectrum.
        </footer>
      </div>
    </main>
  );
}

function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => set(!on)}
      className="flex min-h-11 items-center justify-between gap-3 border border-line px-3 text-left"
    >
      <span>{label}</span>
      <span className={`text-xs tracking-widest uppercase ${on ? "text-ember" : "text-muted"}`}>
        {on ? "On" : "Off"}
      </span>
    </button>
  );
}
