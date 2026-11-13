# Blinkfield

Public web tool for the 2026 NASA Space Apps Challenge: show a patch of the SPHEREx sky as a short film so anyone can see what moved or changed brightness.

NASA does not endorse this project. SPHEREx data come from the NASA/IPAC Infrared Science Archive.

## Demo in three minutes

1. The app opens on **Barnard's Star**. Wait until a few plates appear, then press **Play**. Every frame has been rotated onto the same north-up grid.
2. Switch to **Difference** and step through. The star moves about 10 arcseconds a year, which is one or two SPHEREx pixels (6.2″). The readout under the plate gives the offset of the brightest residual.
3. Turn **Contamination flags** on. Ghosts, streaks and blooms are colored so they are not mistaken for a discovery. Ivory rings are Gaia DR3, shifted from 2016 to the plate date by proper motion. Ember squares are AllWISE (about 2010, not motion-corrected).
4. Open **WISE 0855** with detector **D6**. It is the coldest known brown dwarf: faint to Gaia, relatively brighter at 4–5 μm. Then press **Spectral scan** and compare D1 with D6.
5. Open **Epsilon Indi B** (16′ field). The T-dwarf pair sits about 7′ from the bright star. SPHEREx cannot split Ba from Bb.
6. Open **RW Aurigae** or **R Draconis** and run a spectral scan. These are variables: compare the two epoch lines on the chart more than the positions.
7. **Copy link**. The URL carries right ascension, declination, field of view and detector, so it can be embedded.

The observer log stays in the browser only.

## What the challenge asked for

| Ask | Where it lives |
| --- | --- |
| Coordinate in, images out, like a video | Plate, play, filmstrip |
| Barnard's Star, ε Indi B, WISE 0855, RW Aur, R Dra | Test fields |
| Easy to point at a new data release | `SPHEREX_COLLECTIONS` in `src/lib/spherex/spherex.server.ts` |
| Use the 102 bands / six detectors | Detector picker, per-pixel wavelength, spectral scan |
| Add or subtract epochs | Stack and Difference |
| Choose the field of view | 4–20 arcmin |
| Gaia and WISE overlay | Toggles on the plate |
| Coordinate in the URL | `?ra=&dec=&fov=&det=` |
| Contamination flags | Plate metadata and flag tint |
| Spectrum on the fly | Central aperture vs wavelength |

## How a plate is made

1. IRSA SIA2 (`spherex_dr1`, then `spherex_qr3` for anything the yearly release does not yet cover) returns every spectral image that contains the coordinate.
2. Visits are grouped into epochs (30-day gaps). The time reel keeps one frame per epoch, up to eight. The spectral scan keeps one frame per detector for the last two epochs.
3. A cutout URL is `access_url?center=ra,dec&size=degrees`. The file is a multi-extension FITS. Blinkfield reads IMAGE, FLAGS, ZODI and the small WCS-WAVE table, and skips the large PSF extension.
4. Sky position uses the TAN projection plus the SIP distortion polynomials. That match was checked against Astropy: round-trip error about 0.003 pixel, wavelength within 0.0001 μm.
5. Frames are painted onto one north-up, east-left grid. Zodiacal light (the ZODI extension) is subtracted so sources sit above a dark floor.
6. Wavelength at the coordinate is interpolated from the WCS-WAVE lookup, not from the detector's full bandpass.

## Honest limits

- This is not the official SPHEREx spectrophotometry tool. The chart is a small aperture on zodiacal-subtracted pixels.
- One year of motion is subtle at 6″ pixels. Difference images matter more than the blink.
- Edge-of-detector cutouts can be partly empty. Coverage is shown on the plate card.
- AllWISE positions are from about 2010. Fast movers will not sit on the square.
- Archives sometimes return 503. The message on screen says to retry.

## Layout for anyone reading the code

- `src/components/blinkfield/app.tsx` — the page
- `src/components/blinkfield/stage.tsx` — the plate
- `src/lib/spherex/spherex.server.ts` — IRSA search, FITS, reprojection, catalogs
- `src/lib/spherex/wcs.ts` — projection and wavelength
- `src/lib/spherex/api.ts` — the three server calls the page uses

## Run locally
```
npm install
NITRO_PRESET=node-server npx vite build
PORT=3456 HOST=127.0.0.1 node .output/server/index.mjs
```
Open http://127.0.0.1:3456. The app opens on Barnard's Star, and the address carries `ra`, `dec`, `fov` and `det`.

## Deploy on Vercel
Import this repository on vercel.com with the default settings. The build command is `npx vite build`; the Nitro preset defaults to `vercel`.

## Where the code is
`src/lib/spherex/` holds the data side (IRSA search, FITS cutouts, WCS, catalogues). `src/components/blinkfield/` holds the interface. The login, database and multiplayer files are template scaffolding and are not used by the tool.

## Credits and AI disclosure
SPHEREx data: NASA/IPAC Infrared Science Archive (IRSA). Gaia DR3 and AllWISE catalogues. NASA does not endorse this project.
Parts of this project were generated with Grok (xAI) and Claude (Anthropic), then reviewed, tested and integrated by the team.
