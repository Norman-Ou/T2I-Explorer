# Bundled interface fonts

Public Sans Variable and IBM Plex Mono were copied byte-for-byte from the local
Dive T2I Explorer style reference captured on 2026-10-11. The original filenames
and language subsets are retained; the application loads them from the same
origin through Vite's CSS asset pipeline.

- Public Sans: [upstream](https://github.com/uswds/public-sans),
  [license](Public-Sans-OFL.txt).
- IBM Plex Mono: [upstream](https://github.com/IBM/plex),
  [license](IBM-Plex-Mono-OFL.txt).

Both families use the SIL Open Font License 1.1. License notices are included
alongside the unmodified font files. Unsupported scripts use the system font
fallbacks declared in the stylesheet.
