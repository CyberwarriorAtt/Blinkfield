export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function b64ToF32(b64: string): Float32Array {
  const bytes = b64ToBytes(b64);
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Float32Array(copy);
}

export function percentiles(data: Float32Array, lo: number, hi: number): { lo: number; hi: number } {
  const vals: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (Number.isFinite(data[i])) vals.push(data[i]);
  }
  if (vals.length < 8) return { lo: 0, hi: 1 };
  vals.sort((a, b) => a - b);
  const at = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  return { lo: at(lo), hi: Math.max(at(hi), at(lo) + 1e-4) };
}

export function subtract(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = Number.isFinite(a[i]) && Number.isFinite(b[i]) ? a[i] - b[i] : Number.NaN;
  }
  return out;
}

export function meanStack(frames: Float32Array[]): Float32Array {
  const n = frames[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (const frame of frames) {
      const v = frame[i];
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    out[i] = count ? sum / count : Number.NaN;
  }
  return out;
}

export function peakResidual(diff: Float32Array, n: number, scaleArcsec: number) {
  let best = 0;
  let at = -1;
  const margin = Math.round(n * 0.08);
  for (let y = margin; y < n - margin; y++) {
    for (let x = margin; x < n - margin; x++) {
      const v = Math.abs(diff[y * n + x]);
      if (v > best) {
        best = v;
        at = y * n + x;
      }
    }
  }
  if (at < 0 || best === 0) return null;
  const x = at % n;
  const y = Math.floor(at / n);
  const mid = (n - 1) / 2;
  return {
    eastArcsec: -(x - mid) * scaleArcsec,
    northArcsec: (mid - y) * scaleArcsec,
    value: diff[at],
  };
}
