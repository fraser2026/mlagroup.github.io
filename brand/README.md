# RegAnchor brand marks

| File | Use |
|------|-----|
| `../favicon.svg` | Browser tab / Google indexing (outlined R, no webfont dependency) |
| `mark-light.svg` | Light UI — ink R on transparent (512 viewBox) |
| `mark-dark.svg` | Dark UI / social — white R on `#0A0E14` square |
| `ra-mark-light.png` | 2048px raster for decks / partners (ink R on white) |
| `ra-mark-dark.png` | 2048px raster for decks / partners (white R on ink) |

Wordmark in product UI remains the text `RegAnchor` set in **IBM Plex Sans Medium** via `.ra-wordmark`. Legal entity remains **MLA Group Ltd**.

Export high-res PNGs from the SVGs (source of truth for the R path):

```bash
node tools/export-brand-marks.mjs
```

Requires Puppeteer Chrome, or set `PUPPETEER_EXECUTABLE_PATH` to a local Chrome install.
