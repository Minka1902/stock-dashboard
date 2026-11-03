# Third-party notices

Parts of this project are ported from the following MIT-licensed work. The
ported code was rewritten to fit this codebase. Each module that carries it
says so in its docstring.

## trader-skill and day-trader-skill

- https://github.com/Jakeschincariol/trader-skill
- https://github.com/Jakeschincariol/day-trader-skill

Used in:
- `backend/app/sources/congress.py`: the House Clerk index and PTR parsing (`trader-pelosi/ptr.py`).
- `backend/app/guardrails.py`: the per-trade limits (`trader-risk`).
- Later ports name their source in the same way.

The PTR test fixtures under `backend/tests/fixtures/congress/` are excerpts of
public House Clerk filings, taken from trader-skill's test suite.

```
MIT License

Copyright (c) 2026 Jake Schincariol

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
