# RegAnchor brand marks

| File | Use |
|------|-----|
| `../favicon.svg` | Browser tab / Google indexing (outlined R, no webfont dependency) |
| `mark-light.svg` | Light UI — ink R on transparent (512 viewBox) |
| `mark-dark.svg` | Dark UI / social — white R on `#0A0E14` square |
| `ra-mark-light.png` | 2048px raster for decks / partners (ink R on white) |
| `ra-mark-dark.png` | 2048px raster for decks / partners (white R on ink) |

The R path is extracted from **Inter Medium** so it matches the live `.ra-wordmark` on the public site and portal (Inter). Legal entity remains **MLA Group Ltd**.

Rebuild the SVG paths:

```bash
node tools/build-favicon-r.mjs
```

Export high-res PNGs from the SVGs:

```bash
node tools/export-brand-marks.mjs
```
