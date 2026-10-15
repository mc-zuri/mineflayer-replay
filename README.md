# mineflayer-replay

Replays recorded sessions of the vanilla Java client, tick by tick, and reports the
first point where PrismarineJS diverges from vanilla. It is a **bug finder**: each
divergence is fixed in the package that owns the behaviour (mineflayer,
prismarine-physics, minecraft-data, minecraft-protocol, …) with a unit test in
that package's own suite. Replay results are evidence, not the regression test.

## Usage

```sh
npm install
npm run fixtures            # download the fixtures listed in fixtures.manifest.json
npm test                    # unit tests of the harness (no fixtures needed)
npm run test:engine         # every case through prismarine-physics
npm run test:bot            # every case through a whole mineflayer bot
npx mocha --exit test/replay/engine.test.js -g "1.21.11v"   # one version
npm run baseline -- engine bot --jobs 8 --summary           # rewrite known-failures.json
```

`REPLAY_FIXTURES=<dir>` reads fixtures from another directory.

## Layers

- **Engine** (`lib/engine.js`) feeds each recorded tick's inputs to `prismarine-physics`
  (`Physics(registry, world).simulatePlayer(PlayerState)`), with the keys, view,
  attributes, effects and abilities the server had synced, and compares position,
  velocity, ground and collision flags, fluids, cobweb and elytra with vanilla's
  state after the tick. `trajectory` mode simulates continuously; `stepwise`
  restarts every tick from vanilla's state to locate the first tick that is wrong on
  its own. Riding (`v_*`) and the mineflayer feature cases (`m_*`, `mk_*`) are not
  engine cases.
- **Bot** (`lib/bot.js`) drives a whole mineflayer bot over a fake client
  (`lib/fakeClient.js`) that decodes the recorded server packets with the real
  minecraft-protocol codecs, and compares the movement packets the bot writes each
  tick with the recorded client packets byte for byte, plus position, velocity and
  ground contact.

Numbers are compared with `Object.is`, so `-0` and `0` differ.

## Integration contract with mineflayer

The bot layer uses only public mineflayer API:

- `createBot({ client })`: an injected client.
- `physicsManual` + `bot.tickPhysics()`: run exactly one client tick on demand
  (proposed upstream, branch `feat/physics-manual`).
- `setControlState`, `bot.entity` (position, velocity, view, contact flags),
  `bot.entities`, `bot.world.setColumn`, `activateItem` / `deactivateItem`,
  `entityAtCursor` / `blockAtCursor`, `wake`, `openEntity`.

The start state of each case is reached by feeding packets a server would send:
login, inventory, health, effects, attributes, abilities, and a teleport to the last
position the client sent, answered by one tick.

### Known harness gaps

What the vanilla client held when a case began that mineflayer exposes no way to set.
A case can diverge because of one of these alone; triage marks such a case `harness`.

- The ground flag of the last movement packet the client sent: the bot's comes from
  the teleport answer (`false`).
- The position reminder count (vanilla resends the position every 20 ticks): the
  bot's starts at the teleport answer.
- Powder snow, the stuck-speed multiplier of the tick before, eyes in water, pose and
  swimming state.
- 1.9–1.13 recordings: the recording client put the player in its chunk right after
  each server teleport (an instrumentation side effect, not vanilla).
- Moving pistons, and Java's `Math.sin`/`Math.cos` (V8's differ in the last bit on a
  few inputs; vanilla uses them for elytra from 1.18.2).

## Versions

Mineflayer's `testedVersions` (`lib/version.js`): 1.8.8 → 26.1. Full movement
catalogs exist for 1.12.2, 1.13.2 and 1.20.4+ (except 1.21.4); the other versions
have the mineflayer feature cases and a few movement cases.

## Fixtures

Fixtures are release assets, not committed. `fixtures.manifest.json` lists, per
version, the asset, its sha256, its case count and where the recordings came from.
`tools/manifest.js` writes it for a directory of fixtures; upload the same files to
the release it names.

## Known failures

`known-failures.json` lists cases (`case@version`) that currently diverge. The list
may only shrink: a listed case that starts passing fails the suite until it is
removed. `tools/baseline.js` rewrites it from a full run and refuses to write a run
during which the code it replays changed.

## License

MIT
