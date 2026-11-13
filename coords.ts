/** Sexagesimal and decimal coordinate parsing for the plate controls. */

export function parseRa(input: string): number | null {
  const s = input.trim().replace(/−/g, "-");
  if (!s) return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    return ((v % 360) + 360) % 360;
  }
  const parts = s
    .replace(/[hH]/g, " ")
    .replace(/[mM'′]/g, " ")
    .replace(/[sS"″]/g, " ")
    .replace(/[dD°]/g, " ")
    .trim()
    .split(/[:\s]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  const degreesExplicit = /[dD°]/.test(s);
  const mag = Math.abs(parts[0]) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  const deg = degreesExplicit ? mag : mag * 15;
  return ((deg % 360) + 360) % 360;
}

export function parseDec(input: string): number | null {
  const s = input.trim().replace(/−/g, "-");
  if (!s) return null;
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
    const v = Number(s);
    if (!Number.isFinite(v) || v < -90 || v > 90) return null;
    return v;
  }
  const sign = /^\s*-/.test(s) ? -1 : 1;
  const parts = s
    .replace(/[dD°]/g, " ")
    .replace(/[mM'′]/g, " ")
    .replace(/[sS"″]/g, " ")
    .trim()
    .split(/[:\s]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  const deg = Math.abs(parts[0]) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
  const v = sign * deg;
  if (v < -90 || v > 90) return null;
  return v;
}

export function formatRa(deg: number): string {
  const hours = (((deg % 360) + 360) % 360) / 15;
  const h = Math.floor(hours);
  const mFloat = (hours - h) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${s.toFixed(2)}s`;
}

export function formatDec(deg: number): string {
  const sign = deg < 0 ? "−" : "+";
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${sign}${d}° ${String(m).padStart(2, "0")}′ ${s.toFixed(1)}″`;
}

export function mjdToIso(mjd: number): string {
  return new Date((mjd - 40587) * 86400000).toISOString();
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  });
}
