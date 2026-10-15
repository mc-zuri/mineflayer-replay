# mineflayer-replay

Replays recorded sessions of the vanilla Java client, tick by tick, and reports the
first point where PrismarineJS diverges from vanilla. It is a **bug finder**: each
divergence is fixed in the package that owns the behaviour (mineflayer,
prismarine-physics, minecraft-data, minecraft-protocol, …) with a unit test in
that package's own suite. Replay results are evidence, not the regression test.

Status: skeleton. The harness is being ported from a proof of concept.

## Layers

- **Engine** — feeds each recorded tick's inputs to `prismarine-physics`
  (`Physics(registry, world).simulatePlayer`) and compares position, velocity,
  ground and collision flags with vanilla's state after the tick.
  `trajectory` mode simulates continuously; `stepwise` restarts every tick from
  vanilla's state to locate the first diverging tick.
- **Bot** — drives a whole mineflayer bot over a fake client that decodes the
  recorded server packets with the real codecs, then compares the movement
  packets the bot writes with the recorded client packets byte for byte.

Numbers are compared with `Object.is`, so `-0` and `0` differ.

## Integration contract with mineflayer

The bot layer uses only public mineflayer API:

- `createBot({ client })` — an injected client (already supported).
- `physicsManual` option + `bot.physicsTick()` — run exactly one client tick on
  demand instead of the wall-clock timer (proposed upstream).

The start state of each case is reached by feeding recorded packets, not by
writing private bot fields. Any remaining gap is documented here rather than
worked around through internals.

## Versions

Mineflayer's `testedVersions` (`lib/version.js`): 1.8.8 → 26.1.

## Fixtures

Fixtures are not committed. `fixtures.manifest.json` lists, per version, the
release asset, its sha256 and the recorder revision that produced it.

## Known failures

`known-failures.json` lists cases that currently diverge. The list may only
shrink: a listed case that starts passing fails the suite until it is removed.

## License

MIT
