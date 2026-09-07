# RegAnchor brand marks

| File | Use |
|------|-----|
| `../favicon.svg` | Browser tab / Google indexing — **RA monogram** (white on ink) |
| `mark-light.svg` | Light UI — ink RA on transparent (512) |
| `mark-dark.svg` | Dark UI / marketplace — white RA on `#0A0E14` (512) |
| `ra-monogram-ink.svg` | Wide source lockup (ink) |
| `ra-monogram-white.svg` | Wide source lockup (white) |
| `ra-mark-light.png` | 2048px raster (ink RA on white) |
| `ra-mark-dark.png` | 2048px raster (white RA on ink) |
| `wordmark-*.svg` / `wordmark-*.png` | Full RegAnchor wordmark (separate from monogram) |

The **RA** monogram is the combined R+A mark (not a lone Inter “R”). Prefer white RA on dark surfaces (Cursor, dark tabs) and ink RA on light paper.

Legal entity remains **MLA Group Ltd**.

Rebuild square favicon/marks from Desktop source SVGs:

```bash
node tools/build-ra-monogram.mjs
```

Export high-res PNGs from the square SVGs:

```bash
node tools/export-brand-marks.mjs
```
