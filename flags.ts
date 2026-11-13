export type FlagKind = "bad" | "artifact" | "source" | "info";

export const FLAG_BITS: { bit: number; name: string; kind: FlagKind }[] = [
  { bit: 1, name: "Transient", kind: "artifact" },
  { bit: 2, name: "Overflow", kind: "bad" },
  { bit: 4, name: "Onboard error", kind: "bad" },
  { bit: 64, name: "Nonfunctional", kind: "bad" },
  { bit: 128, name: "Dichroic", kind: "bad" },
  { bit: 512, name: "Missing data", kind: "bad" },
  { bit: 1024, name: "Hot pixel", kind: "bad" },
  { bit: 2048, name: "Cold pixel", kind: "bad" },
  { bit: 4096, name: "Full sample", kind: "info" },
  { bit: 16384, name: "Phantom miss", kind: "artifact" },
  { bit: 32768, name: "Nonlinear", kind: "bad" },
  { bit: 131072, name: "Persistence", kind: "artifact" },
  { bit: 524288, name: "Outlier", kind: "artifact" },
  { bit: 1048576, name: "Crosstalk", kind: "artifact" },
  { bit: 2097152, name: "Known source", kind: "source" },
  { bit: 4194304, name: "Ghost", kind: "artifact" },
  { bit: 8388608, name: "Ghost, other detector", kind: "artifact" },
  { bit: 16777216, name: "Ghost, outside field", kind: "artifact" },
  { bit: 33554432, name: "Streak", kind: "artifact" },
  { bit: 67108864, name: "Bloom", kind: "artifact" },
  { bit: 134217728, name: "Snowball", kind: "artifact" },
  { bit: 268435456, name: "Halo", kind: "artifact" },
];

const BAD = FLAG_BITS.filter((f) => f.kind === "bad").reduce((m, f) => m | f.bit, 0);
const ART = FLAG_BITS.filter((f) => f.kind === "artifact").reduce((m, f) => m | f.bit, 0);
const SRC = 2097152;

/** 0 clean, 1 known source, 2 artifact, 3 unusable. */
export function classifyFlag(flag: number): number {
  if (flag & BAD) return 3;
  if (flag & ART) return 2;
  if (flag & SRC) return 1;
  return 0;
}
