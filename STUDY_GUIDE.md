# Study guide

## 1. The idea
SPHEREx photographs the whole sky every six months. In photos of one patch taken at different times, anything that moved (comet, asteroid, nearby brown dwarf) shifts while distant stars stay put. Pluto was found this way. The tool lines the photos up and plays them like a film.

## 2. Where things are
- Where things are: `src/lib/spherex/spherex.server.ts` (search IRSA, read FITS, align, catalogs), `wcs.ts` (sky position and wavelength maths), `src/components/app.tsx` (the page), `stage.tsx` (the image), `spectrum.tsx` (the chart).

## 3. Words to explain
RA and Dec (sky longitude and latitude); cutout (small piece of a big image); alignment or reprojection (redrawing every photo on one grid); stack (average frames to cut noise); difference (later minus earlier, leaves only what changed); detector arrays (SPHEREx has six); contamination flags (marks for ghosts and streaks, so they are not mistaken for discoveries); proper motion (a star's slow drift across the sky).

## 4. Do today, in this order
1. Run Blinkfield (README) and open Barnard's Star, WISE 0855 and the other three test fields. Note which load, which fail, and the exact error text.
2. Follow the three-minute demo in `README.md` and rehearse it.
3. Deploy (Vercel suits this project, because Grok built it for Vercel). Put the folder on GitHub, import it and set the build command to `npx vite build` to skip the database step. Confirm the public link loads and that a field works on it.
4. Record a screen video of a working run as a backup.
5. Check the organisers' rules on prepared code and AI help, and disclose as in the README.

## 5. Expectations
Barnard's Star and WISE 0855 move roughly 10 and 8 arcseconds a year. A SPHEREx pixel is about 6 arcseconds. Over the data so far, the shift is one or two pixels, so the Difference view is the convincing one. Say that plainly.

## 6. Two-minute pitch
Hook: "Pluto was found because one dot moved between two photos." Problem: "SPHEREx maps the sky in 102 colours; nobody can compare it by hand." Demo: Barnard's Star in Difference mode, flags on, then WISE 0855 with the spectral scan. How: "Small cutouts, aligned to one grid, with contamination flags and Gaia and WISE overlays." Next: more catalogues, hosted data, new releases (one line in `SPHEREX_COLLECTIONS`).

## 7. Likely judge questions
- Is it real data? Yes, from NASA's IRSA archive.
- What did you build? Be open: the app was generated with AI, you chose the design, tested it and can explain it. Make sure you can.
- How does it update? Add the new collection name in `SPHEREX_COLLECTIONS`.
- What is missing? Official calibrated spectrophotometry; the chart is a small aperture (stated in the app's README).
