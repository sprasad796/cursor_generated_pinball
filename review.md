# Code Review — Pinball Shooter

Reviewed files:
- `index.html`
- `style.css`
- `game.js`
- `README.md`

## What’s working well
- **Simple, dependency-free delivery**: one HTML/CSS/JS bundle is easy to run and share.
- **Readable game loop**: `tick()` → `stepPhysics()` → `render()` is straightforward.
- **Small, clear collision helpers**: `circleVsCircleResolve()` and `ballVsAabbResolve()` are easy to reason about.
- **Nice UX touches**: aim preview, score flash, and simple audio cues make the game feel responsive.

## Key risks / issues found (with remedial actions)

### P0 (should fix soon)
- **`style.css` light-mode inconsistency in `.help`**
  - **Issue**: The app background is white, but `.help` uses `background: rgba(255, 255, 255, 0.05)` and a **white border** (`rgba(255, 255, 255, 0.10)`), which will be very low-contrast on white. This looks like a leftover from dark mode.
  - **Remedy**: Switch `.help` background/border to use black-based alphas (matching `.panel`/`.score`) or reuse the existing CSS variables (`--panel`, `--panel2`).

- **Input handling can “steal” Space globally**
  - **Issue**: `window.addEventListener("keydown", ...)` calls `e.preventDefault()` for Space regardless of focus. This can interfere with accessibility (e.g., space-activating a focused button) and page scrolling expectations.
  - **Remedy**:
    - Only `preventDefault()` when the **game is in a state where boost is valid** and focus is not in an input/control you don’t own.
    - Alternatively, bind keyboard control when the canvas is focused (e.g., click/tap on the game panel to focus).

### P1 (recommended)
- **Monolithic `game.js` makes changes riskier**
  - **Issue**: Rendering, physics, AI, UI wiring, configuration, and state are all in one file. This increases merge conflicts and makes it harder to test/extend (e.g., more obstacles, levels).
  - **Remedy**: Split into modules (even without a build step) by using multiple script files:
    - `physics.js` (collision + integrator)
    - `field.js` (buildField, obstacle definitions)
    - `render.js` (draw functions)
    - `controls.js` (pointer + keyboard + UI bindings)
    - `game.js` as the orchestrator

- **Color system is partially “tokenized” but still uses hard-coded colors**
  - **Issue**: You introduced a `COLORS` object, but some draw code still uses raw RGBA strings (e.g., obstacle fill/stroke, booster fill/stroke). Also `COLORS.ballGlow` is set twice (in `COLORS` and then again right after).
  - **Remedy**:
    - Add tokens like `COLORS.obstacleFill`, `COLORS.obstacleStroke`, `COLORS.boosterFill`, `COLORS.boosterStroke`.
    - Remove redundant assignments like `COLORS.ballGlow = ...` if it matches the constant.

- **Controls documentation is out of date**
  - **Issue**: `README.md` doesn’t mention Boost (Space) or pads (A/D or buttons).
  - **Remedy**: Update `README.md` “Controls” section to reflect the new controls and the “2 boosts per ball” behavior.

### P2 (nice improvements)
- **Canvas CSS background != game “background”**
  - **Issue**: The canvas element has a CSS background, but `render()` clears the canvas each frame. That’s fine, but it means the “background” is purely CSS and will not be captured if you ever export a screenshot from canvas pixels.
  - **Remedy**: Optionally add a `drawBackground()` that paints a background into the canvas (and make CSS background plain).

- **Booster pads collision uses `ballVsAabbResolve` (reflection + impulse)**
  - **Issue**: A booster pad both resolves collision (can reflect velocity) and then adds an impulse. That can feel “extra bouncy” or unpredictable.
  - **Remedy**: Consider detecting overlap without reflection (AABB overlap test) and only applying the impulse, or apply impulse based on pre-collision velocity.

- **UI feedback for boosts/pads**
  - **Issue**: Boosts are limited per ball, but there’s no visible indicator.
  - **Remedy**: Show `boostsLeft` in the HUD (e.g., “Boost: 2”) and/or disable the Boost button when empty/cooldown.

## Security & privacy
- **No obvious security issues**: no network calls, no storage, no user-generated HTML insertion.
- **Audio**: Uses WebAudio; good that it’s gated behind a user toggle. Consider handling `AudioContext` resume/suspend more explicitly if needed.

## Accessibility notes
- **Buttons have visible labels** (good). Consider adding `aria-label` with clearer names for `Pad L` / `Pad R`.
- **Keyboard support exists** (good). Consider scoping keyboard listeners to the game container to avoid interfering with other page interactions.

## Performance notes
- Current object counts are small; performance is fine.
- If you add many more obstacles/balls later, consider:
  - Spatial partitioning for collisions
  - Avoiding repeated `Math.sqrt` where possible
  - Drawing in batches / reducing state changes in `ctx`

## Suggested quick wins (high impact, low effort)
1. Fix `.help` styling for white background (contrast).
2. Update `README.md` controls for Boost + Pads.
3. Tokenize hard-coded obstacle/booster colors into `COLORS`.
4. Add a tiny HUD readout for boosts remaining and disable the Boost button when unavailable.

