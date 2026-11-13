import { createServerFn } from "@tanstack/react-start";
import type { FramePayload, OverlayPayload, SearchPlan } from "@/lib/spherex/types";

export const searchField = createServerFn({ method: "POST" })
  .validator((input: { ra: number; dec: number; detector: number }) => {
    const ra = Number(input?.ra);
    const dec = Number(input?.dec);
    const detector = Math.round(Number(input?.detector));
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) {
      throw new Error("Enter a real right ascension and declination.");
    }
    if (detector < 1 || detector > 6) throw new Error("Pick a detector from D1 to D6.");
    return { ra: ((ra % 360) + 360) % 360, dec, detector };
  })
  .handler(async ({ data }): Promise<SearchPlan> => {
    const { searchSpherex } = await import("@/lib/spherex/spherex.server");
    return searchSpherex(data.ra, data.dec, data.detector);
  });

export const fetchFrame = createServerFn({ method: "POST" })
  .validator((input: { url: string; ra: number; dec: number; sizeDeg: number }) => {
    const ra = Number(input?.ra);
    const dec = Number(input?.dec);
    const sizeDeg = Number(input?.sizeDeg);
    const url = String(input?.url ?? "");
    if (!url.startsWith("https://irsa.ipac.caltech.edu/ibe/data/spherex/")) {
      throw new Error("That image is not a SPHEREx file.");
    }
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(sizeDeg)) {
      throw new Error("The cutout request was incomplete.");
    }
    return { url, ra, dec, sizeDeg };
  })
  .handler(async ({ data }): Promise<FramePayload> => {
    const { buildFrame } = await import("@/lib/spherex/spherex.server");
    return buildFrame(data);
  });

export const fetchOverlays = createServerFn({ method: "POST" })
  .validator((input: { ra: number; dec: number; radiusDeg: number }) => {
    const ra = Number(input?.ra);
    const dec = Number(input?.dec);
    const radiusDeg = Number(input?.radiusDeg);
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(radiusDeg)) {
      throw new Error("Overlay search needs a coordinate.");
    }
    return { ra, dec, radiusDeg };
  })
  .handler(async ({ data }): Promise<OverlayPayload> => {
    const { loadOverlays } = await import("@/lib/spherex/spherex.server");
    return loadOverlays(data.ra, data.dec, data.radiusDeg);
  });
