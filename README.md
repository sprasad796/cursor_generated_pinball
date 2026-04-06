# Pinball Shooter (You vs Computer)

A tiny, dependency-free browser game inspired by pinball: aim and shoot a ball into a bumper field, score points, then the computer takes its shot. After **3 balls each**, highest total score wins.

## Run it

- Open `index.html` in a browser, or run a local server:

```bash
cd pinball-shooter
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Controls

- **Aim + power**: click/touch near the **launcher circle** (bottom center), drag to aim, release to shoot.
- **Restart**: button in the HUD.

## Scoring

- **Bumpers**: small points per hit.
- **Targets**: bigger points, disappear when hit (reset each ball).

