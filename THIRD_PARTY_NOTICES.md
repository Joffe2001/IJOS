# Third-party notices

IJOS has no runtime npm dependencies. It ships one third-party component, copied into the repository:

## KaTeX 0.16.47

- Location: `public/vendor/katex/` (`katex.min.js`, `katex.min.css`, `fonts/*.woff2`)
- Project: https://katex.org · https://github.com/KaTeX/KaTeX
- License: MIT. Copyright (c) 2013-2020 Khan Academy and other contributors.
- The full license text is in `public/vendor/katex/LICENSE`. It must stay next to the files when IJOS is redistributed.
- Fonts: the `fonts/` folder comes from the official KaTeX 0.16.47 distribution. KaTeX distributes it under the same repository license. The maintainer should confirm the font licensing against the KaTeX repository before a formal release.

## Development-only tools (not shipped, not required to run IJOS)

- Playwright for Python: used by `test/e2e_walkthrough.py` for the browser walkthrough. Apache-2.0.
- Node.js built-in test runner and `node:sqlite`: part of Node.js itself.
