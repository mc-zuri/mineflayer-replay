# mineflayer-replay

A bug finder for PrismarineJS, not a place for fixes. Read `README.md` first. When this repo is
checked out inside the `E:\contribute` root, the root `CLAUDE.md` and its skills apply.

- Never patch mineflayer, prismarine-physics or data behaviour here to make a case pass. Find the
  owning package and fix it there, with that package's own unit test.
- Use only public mineflayer API (see the README's integration contract). If a case needs
  internals, record the gap in the README instead of reaching into private fields.
- Never edit fixtures or add entries to `known-failures.json` to make the suite green. Remove an
  entry only after its case passes; regenerate the list only with the baseline tool.
- Compare numbers with `Object.is`; keep `-0`.
- Version scope: mineflayer `testedVersions` (1.8.8 → 26.1).
- Code style: `standard`; tests: mocha.
