# Third-party notices

IJOS has no runtime npm dependencies. It ships one third-party component, copied into the repository:

## KaTeX 0.16.47

- Location: `public/vendor/katex/` (`katex.min.js`, `katex.min.css`, `fonts/*.woff2`)
- Project: https://katex.org · https://github.com/KaTeX/KaTeX
- Code (`katex.min.js`, `katex.min.css`): MIT. Copyright (c) 2013-2020 Khan Academy and other contributors. The full license text is in `public/vendor/katex/LICENSE`.
- Fonts (`fonts/*.woff2`, unmodified from the official KaTeX 0.16.47 distribution): SIL Open Font License 1.1. Copyright (c) 2009-2010 Design Science, Inc.; Copyright (c) 2014-2018 Khan Academy, with Reserved Font Names `KaTeX_*`. This is the license recorded inside each font file. The full license text is in `public/vendor/katex/fonts/OFL.txt`.
- Both license files must stay next to the files when IJOS is redistributed. The fonts may be bundled with IJOS but not sold by themselves, and a modified font may not keep the `KaTeX_*` name.

## Development-only tools (not shipped, not required to run IJOS)

- Playwright for Python: used by `test/e2e_walkthrough.py` for the browser walkthrough. Apache-2.0.
- Node.js built-in test runner and `node:sqlite`: part of Node.js itself.
