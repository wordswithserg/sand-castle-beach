# Sand Castle Beach

A 1–4 player co-op heist game: play as banana slugs breaking into procedurally generated sand castles guarded by crabs, using shape-shifting stealth ("skulking") and rolling to get around.

## What's here right now

`slug-demo/` — a small Three.js prototype built to test the two core movement mechanics in isolation before anything else is built:

- **Skulk** — hold `C` to go short & wide, hold `V` to go tall & narrow. The silhouette change actually gates which obstacles you can pass, not just cosmetic.
- **Roll** — hold `Shift` to curl into a ball and move faster.

Run it:

```bash
cd slug-demo
npm install
npm run dev
```

Then open the printed local URL. Controls: `W`/`S` move, `A`/`D` turn, `C` skulk wide, `V` skulk tall, `Shift` roll.

## Status

Early prototype — feel-testing the movement mechanics before building anything else (guards, items, castle generation, multiplayer).
