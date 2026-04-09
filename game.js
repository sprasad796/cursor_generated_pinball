/* Pinball Shooter - lightweight arcade physics (no deps) */
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const ui = {
    playerScore: document.getElementById("playerScore"),
    cpuScore: document.getElementById("cpuScore"),
    ballCount: document.getElementById("ballCount"),
    statusText: document.getElementById("statusText"),
    restartBtn: document.getElementById("restartBtn"),
    padLeftBtn: document.getElementById("padLeftBtn"),
    padRightBtn: document.getElementById("padRightBtn"),
    boostBtn: document.getElementById("boostBtn"),
    soundToggle: document.getElementById("soundToggle"),
  };

  const W = () => canvas.width;
  const H = () => canvas.height;

  const rng = (() => {
    // Deterministic enough per session; not crypto.
    let s = (Date.now() >>> 0) ^ ((Math.random() * 1e9) >>> 0);
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  })();

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const len2 = (x, y) => x * x + y * y;
  const len = (x, y) => Math.sqrt(len2(x, y));

  const audio = (() => {
    let ac = null;
    const ensure = () => {
      if (!ui.soundToggle.checked) return null;
      if (ac) return ac;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        ac = null;
      }
      return ac;
    };
    const beep = (freq, durMs, gain = 0.045) => {
      const a = ensure();
      if (!a) return;
      const t0 = a.currentTime;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
      o.connect(g);
      g.connect(a.destination);
      o.start(t0);
      o.stop(t0 + durMs / 1000);
    };
    return {
      hit: () => beep(760, 70, 0.055),
      target: () => beep(980, 90, 0.06),
      drain: () => beep(240, 180, 0.065),
      win: () => beep(640, 150, 0.06),
      lose: () => beep(180, 240, 0.07),
    };
  })();

  const GAME = {
    ballsPerSide: 3,
    gravity: 820, // px/s^2
    airFriction: 0.995, // per 60fps frame-ish
    restitution: 0.86,
    wallRestitution: 0.78,
    maxSpeed: 1400,
    dtMax: 1 / 30,
  };

  const COLORS = {
    purple: "rgba(176,38,255,0.95)",
    cyan: "rgba(0,229,255,0.95)",
    green: "rgba(43,255,136,0.95)",
    yellow: "rgba(255,212,0,0.95)",
    pink: "rgba(255,45,85,0.95)",
    lane: "rgba(255,255,255,0.10)",
    rail: "rgba(0,229,255,0.38)",
    boundary: "#ffffff",
    ball: "rgba(255,255,255,0.96)",
    ballGlow: "rgba(176,38,255,0.34)",
    aim: "rgba(255,212,0,0.90)",
    bumperA: "rgba(176,38,255,0.95)",
    bumperB: "rgba(0,229,255,0.95)",
    target: "rgba(43,255,136,0.95)",
    textMuted: "rgba(255,255,255,0.68)",
    text: "rgba(255,255,255,0.92)",
    drain: "rgba(255,45,85,0.55)",
  };

  // Keep purple accents consistent.
  COLORS.bumperA = COLORS.purple;
  COLORS.ballGlow = "rgba(176,38,255,0.34)";

  function toCanvasCoords(evt) {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return {
      x: (evt.clientX - r.left) * sx,
      y: (evt.clientY - r.top) * sy,
    };
  }

  function circleVsCircleResolve(a, b, restitution) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = a.r + b.r;
    if (dist <= 0 || dist >= minDist) return false;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    // Push ball out (treat bumper as immovable)
    a.x -= nx * overlap;
    a.y -= ny * overlap;

    // Reflect velocity along normal
    const vn = a.vx * nx + a.vy * ny;
    if (vn > 0) return true;
    a.vx -= (1 + restitution) * vn * nx;
    a.vy -= (1 + restitution) * vn * ny;
    return true;
  }

  function ballVsAabbResolve(ball, box, restitution) {
    const nearestX = clamp(ball.x, box.x, box.x + box.w);
    const nearestY = clamp(ball.y, box.y, box.y + box.h);
    const dx = ball.x - nearestX;
    const dy = ball.y - nearestY;
    const d2 = dx * dx + dy * dy;
    if (d2 > ball.r * ball.r) return false;
    const d = Math.sqrt(d2) || 1;
    const nx = dx / d;
    const ny = dy / d;
    const overlap = ball.r - d;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const vn = ball.vx * nx + ball.vy * ny;
    if (vn > 0) return true;
    ball.vx -= (1 + restitution) * vn * nx;
    ball.vy -= (1 + restitution) * vn * ny;
    return true;
  }

  function formatBallCount(turn, max) {
    return `${turn} / ${max}`;
  }

  const launcher = {
    x: 0,
    y: 0,
    r: 16,
    powerMax: 820,
    powerMin: 260,
    aimMaxLen: 160,
  };

  function buildField() {
    const bumpers = [
      { x: W() * 0.30, y: H() * 0.22, r: 26, color: COLORS.bumperA, score: 25 },
      { x: W() * 0.52, y: H() * 0.18, r: 22, color: COLORS.bumperB, score: 30 },
      { x: W() * 0.70, y: H() * 0.26, r: 26, color: COLORS.bumperA, score: 25 },
      { x: W() * 0.38, y: H() * 0.40, r: 20, color: COLORS.bumperB, score: 35 },
      { x: W() * 0.62, y: H() * 0.42, r: 20, color: COLORS.bumperB, score: 35 },
      { x: W() * 0.50, y: H() * 0.54, r: 28, color: COLORS.bumperA, score: 20 },
    ];

    const targets = [
      { x: W() * 0.18, y: H() * 0.62, w: 56, h: 16, alive: true, score: 60 },
      { x: W() * 0.72, y: H() * 0.64, w: 56, h: 16, alive: true, score: 60 },
      { x: W() * 0.46, y: H() * 0.33, w: 64, h: 16, alive: true, score: 80 },
    ];

    // Simple slanted rails near bottom to keep it "pinball-ish"
    const rails = [
      { x: W() * 0.16, y: H() * 0.78, w: W() * 0.28, h: 10, angle: -18 * (Math.PI / 180) },
      { x: W() * 0.56, y: H() * 0.78, w: W() * 0.28, h: 10, angle: 18 * (Math.PI / 180) },
      // extra mid-field rails (more chaotic bounces)
      { x: W() * 0.18, y: H() * 0.50, w: W() * 0.22, h: 10, angle: 16 * (Math.PI / 180) },
      { x: W() * 0.60, y: H() * 0.52, w: W() * 0.22, h: 10, angle: -16 * (Math.PI / 180) },
    ];

    const walls = [
      // left and right walls
      { x: 10, y: 10, w: 12, h: H() - 20 },
      { x: W() - 22, y: 10, w: 12, h: H() - 20 },
      // top wall
      { x: 10, y: 10, w: W() - 20, h: 12 },
    ];

    // Inner obstacles (AABB blocks)
    const obstacles = [
      { x: W() * 0.35, y: H() * 0.64, w: W() * 0.06, h: 8 },
      { x: W() * 0.59, y: H() * 0.66, w: W() * 0.06, h: 8 },
      { x: W() * 0.4825, y: H() * 0.24, w: W() * 0.045, h: 7 },
    ];

    // Boost pads: push the ball in a direction on contact.
    // dir is normalized-ish; strength is added as velocity (px/s).
    const boosters = [
      { x: W() * 0.12, y: H() * 0.70, w: 44, h: 14, dirX: 1, dirY: -1.2, strength: 420, cooldown: 0.18, lastHitAt: -999 },
      { x: W() * 0.83, y: H() * 0.70, w: 44, h: 14, dirX: -1, dirY: -1.2, strength: 420, cooldown: 0.18, lastHitAt: -999 },
      { x: W() * 0.48, y: H() * 0.44, w: 52, h: 14, dirX: 0, dirY: -1.0, strength: 520, cooldown: 0.22, lastHitAt: -999 },
    ];

    return { bumpers, targets, rails, walls, obstacles, boosters };
  }

  function rotatePoint(px, py, cx, cy, ang) {
    const s = Math.sin(ang);
    const c = Math.cos(ang);
    const x = px - cx;
    const y = py - cy;
    return { x: cx + x * c - y * s, y: cy + x * s + y * c };
  }

  function ballVsRotatedRail(ball, rail) {
    // Transform into rail-local axis (unrotate), collide as AABB, then rotate back.
    const cx = rail.x + rail.w / 2;
    const cy = rail.y + rail.h / 2;
    const p = rotatePoint(ball.x, ball.y, cx, cy, -rail.angle);
    const local = { x: p.x, y: p.y, vx: ball.vx, vy: ball.vy, r: ball.r };
    const v = rotatePoint(ball.vx, ball.vy, 0, 0, -rail.angle);
    local.vx = v.x;
    local.vy = v.y;

    const hit = ballVsAabbResolve(local, { x: rail.x, y: rail.y, w: rail.w, h: rail.h }, GAME.wallRestitution);
    if (!hit) return false;

    const worldP = rotatePoint(local.x, local.y, cx, cy, rail.angle);
    ball.x = worldP.x;
    ball.y = worldP.y;
    const worldV = rotatePoint(local.vx, local.vy, 0, 0, rail.angle);
    ball.vx = worldV.x;
    ball.vy = worldV.y;
    return true;
  }

  function makeBall() {
    launcher.x = W() / 2;
    launcher.y = H() - 42;
    return {
      x: launcher.x,
      y: launcher.y,
      vx: 0,
      vy: 0,
      r: 10.5,
      alive: true,
      launched: false,
    };
  }

  const state = {
    field: buildField(),
    ball: makeBall(),
    phase: "aim", // aim | flying | draining | cpu_aim | match_over
    t: 0,
    boostsLeft: 2,
    lastBoostAt: -999,
    lastPadAt: -999,
    playerTotal: 0,
    cpuTotal: 0,
    playerBall: 1,
    cpuBall: 1,
    activeSide: "player", // player | cpu
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    dragNow: { x: 0, y: 0 },
    lastTime: performance.now(),
    flash: 0,
    cpuPlan: null,
    cpuWait: 0,
  };

  function resetTargets() {
    for (const t of state.field.targets) t.alive = true;
  }

  function resetForNewMatch() {
    state.field = buildField();
    resetTargets();
    state.ball = makeBall();
    state.phase = "aim";
    state.t = 0;
    state.boostsLeft = 2;
    state.lastBoostAt = -999;
    state.lastPadAt = -999;
    state.playerTotal = 0;
    state.cpuTotal = 0;
    state.playerBall = 1;
    state.cpuBall = 1;
    state.activeSide = "player";
    state.isDragging = false;
    state.cpuPlan = null;
    state.cpuWait = 0;
    state.flash = 0;
    updateUI();
    setStatus("Your turn. Drag to aim.");
  }

  function setStatus(msg) {
    ui.statusText.textContent = msg;
  }

  function updateUI() {
    ui.playerScore.textContent = String(state.playerTotal);
    ui.cpuScore.textContent = String(state.cpuTotal);
    const turn = state.activeSide === "player" ? state.playerBall : state.cpuBall;
    ui.ballCount.textContent = formatBallCount(turn, GAME.ballsPerSide);
  }

  function addScore(points, kind = "hit") {
    if (state.activeSide === "player") state.playerTotal += points;
    else state.cpuTotal += points;
    state.flash = 0.16;
    updateUI();
    if (kind === "target") audio.target();
    else audio.hit();
  }

  function drainBall() {
    if (state.phase === "draining" || state.phase === "match_over") return;
    state.phase = "draining";
    audio.drain();
    state.ball.alive = false;
    setStatus(`${state.activeSide === "player" ? "Your" : "Computer"} ball drained.`);
    state.cpuWait = 0.6;
  }

  function endTurnAndMaybeSwitch() {
    if (state.activeSide === "player") {
      state.activeSide = "cpu";
      state.phase = "cpu_aim";
      state.cpuPlan = planCpuShot();
      setStatus("Computer turn…");
    } else {
      state.activeSide = "player";
      state.phase = "aim";
      setStatus("Your turn. Drag to aim.");
    }

    // increment ball counts AFTER each side finishes its current ball
    if (state.activeSide === "cpu") {
      // player just ended
      state.playerBall += 1;
    } else {
      // cpu just ended
      state.cpuBall += 1;
    }

    const done =
      state.playerBall > GAME.ballsPerSide && state.cpuBall > GAME.ballsPerSide;
    if (done) {
      state.phase = "match_over";
      const p = state.playerTotal;
      const c = state.cpuTotal;
      if (p > c) {
        setStatus(`You win! ${p} to ${c}. Press Restart to play again.`);
        audio.win();
      } else if (c > p) {
        setStatus(`Computer wins. ${c} to ${p}. Press Restart to try again.`);
        audio.lose();
      } else {
        setStatus(`Tie game! ${p} to ${c}. Press Restart to play again.`);
        audio.win();
      }
    } else {
      state.ball = makeBall();
      state.boostsLeft = 2;
      state.lastBoostAt = -999;
      state.lastPadAt = -999;
      resetTargets();
      updateUI();
    }
  }

  function padNudge(dir) {
    // Two pads: left/right nudge during flight.
    if (state.phase !== "flying") return;
    if (state.activeSide !== "player") return;
    const cooldown = 0.16;
    if (state.t - state.lastPadAt < cooldown) return;

    const b = state.ball;
    const strength = 260; // lateral impulse (px/s)
    b.vx += dir * strength;
    b.vy -= 60; // tiny lift feels more "pinball"
    state.lastPadAt = state.t;
    state.flash = Math.max(state.flash, 0.10);
  }

  function boostBall() {
    // Player-controlled booster during flight.
    if (state.phase !== "flying") return;
    if (state.activeSide !== "player") return;
    if (state.boostsLeft <= 0) return;

    const cooldown = 0.38;
    if (state.t - state.lastBoostAt < cooldown) return;

    const b = state.ball;
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    const ux = sp > 40 ? b.vx / sp : 0;
    const uy = sp > 40 ? b.vy / sp : -1;
    const strength = 520;

    b.vx += ux * strength;
    b.vy += uy * strength;
    state.boostsLeft -= 1;
    state.lastBoostAt = state.t;
    state.flash = Math.max(state.flash, 0.14);
  }

  function planCpuShot() {
    // A simple AI: aim generally upward, bias toward center bumpers.
    // We "pretend" to drag from launcher opposite the direction we want to shoot.
    const target = [
      { x: W() * 0.50, y: H() * 0.28, w: 0.7 },
      { x: W() * 0.38, y: H() * 0.40, w: 0.9 },
      { x: W() * 0.62, y: H() * 0.42, w: 0.9 },
      { x: W() * 0.46, y: H() * 0.33, w: 1.0 },
    ].reduce((best, item) => (rng() < item.w ? item : best));

    const aimX = target.x + (rng() - 0.5) * 90;
    const aimY = target.y + (rng() - 0.5) * 70;

    const dx = aimX - launcher.x;
    const dy = aimY - launcher.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const ux = dx / d;
    const uy = dy / d;

    const power = clamp(520 + rng() * 380, launcher.powerMin, launcher.powerMax);
    const dragLen = clamp((power / launcher.powerMax) * launcher.aimMaxLen, 55, launcher.aimMaxLen);

    // Drag "back" from the launcher opposite desired direction.
    const dragX = launcher.x - ux * dragLen;
    const dragY = launcher.y - uy * dragLen;
    return { dragX, dragY, power, ux, uy };
  }

  function shootFromDrag(dragX, dragY) {
    const dx = launcher.x - dragX;
    const dy = launcher.y - dragY;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const aimLen = clamp(d, 0, launcher.aimMaxLen);
    const power = clamp((aimLen / launcher.aimMaxLen) * launcher.powerMax, launcher.powerMin, launcher.powerMax);
    const ux = dx / d;
    const uy = dy / d;

    state.ball.launched = true;
    state.phase = "flying";
    state.ball.vx = ux * power;
    state.ball.vy = uy * power;
    setStatus(`${state.activeSide === "player" ? "You" : "Computer"} shot!`);
  }

  function isInsideLauncherZone(p) {
    const d = len(p.x - launcher.x, p.y - launcher.y);
    return d <= 34;
  }

  canvas.addEventListener("pointerdown", (evt) => {
    if (state.phase !== "aim") return;
    const p = toCanvasCoords(evt);
    if (!isInsideLauncherZone(p)) return;
    state.isDragging = true;
    state.dragStart = { ...p };
    state.dragNow = { ...p };
    canvas.setPointerCapture(evt.pointerId);
  });

  canvas.addEventListener("pointermove", (evt) => {
    if (!state.isDragging) return;
    const p = toCanvasCoords(evt);
    state.dragNow = { ...p };
  });

  function endDragShoot() {
    if (!state.isDragging || state.phase !== "aim") return;
    state.isDragging = false;
    shootFromDrag(state.dragNow.x, state.dragNow.y);
  }

  canvas.addEventListener("pointerup", () => endDragShoot());
  canvas.addEventListener("pointercancel", () => (state.isDragging = false));

  ui.restartBtn.addEventListener("click", () => resetForNewMatch());
  ui.padLeftBtn?.addEventListener("click", () => padNudge(-1));
  ui.padRightBtn?.addEventListener("click", () => padNudge(1));
  ui.boostBtn?.addEventListener("click", () => boostBall());
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyA") padNudge(-1);
    if (e.code === "KeyD") padNudge(1);
    if (e.code === "Space") {
      e.preventDefault();
      boostBall();
    }
  });
  ui.soundToggle.addEventListener("change", () => {
    if (!ui.soundToggle.checked) return;
    // Attempt to unlock audio context on user gesture
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      a.close();
    } catch {
      // ignore
    }
  });

  function stepPhysics(dt) {
    const b = state.ball;
    if (!b.alive) return;
    if (!b.launched) return;

    // integrate
    b.vy += GAME.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // clamp speed
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp > GAME.maxSpeed) {
      const k = GAME.maxSpeed / sp;
      b.vx *= k;
      b.vy *= k;
    }

    // apply friction (scaled to ~60fps)
    const f = Math.pow(GAME.airFriction, dt * 60);
    b.vx *= f;
    b.vy *= f;

    // walls
    for (const w of state.field.walls) {
      ballVsAabbResolve(b, w, GAME.wallRestitution);
    }

    // obstacles (inner blocks)
    if (state.field.obstacles) {
      for (const o of state.field.obstacles) {
        ballVsAabbResolve(b, o, GAME.wallRestitution);
      }
    }

    // rails
    for (const r of state.field.rails) {
      if (ballVsRotatedRail(b, r)) {
        // no score, just pinball feel
      }
    }

    // boosters (push pads)
    if (state.field.boosters) {
      for (const pad of state.field.boosters) {
        const hit = ballVsAabbResolve(b, pad, GAME.wallRestitution);
        if (!hit) continue;
        if (state.t - pad.lastHitAt < pad.cooldown) continue;
        pad.lastHitAt = state.t;

        const d = Math.max(0.0001, Math.sqrt(pad.dirX * pad.dirX + pad.dirY * pad.dirY));
        const ux = pad.dirX / d;
        const uy = pad.dirY / d;
        b.vx += ux * pad.strength;
        b.vy += uy * pad.strength;
        addScore(15, "hit");
      }
    }

    // bumpers
    for (const bumper of state.field.bumpers) {
      const hit = circleVsCircleResolve(b, bumper, GAME.restitution);
      if (hit) addScore(bumper.score, "hit");
    }

    // targets
    for (const t of state.field.targets) {
      if (!t.alive) continue;
      const hit = ballVsAabbResolve(b, t, 0.92);
      if (hit) {
        t.alive = false;
        addScore(t.score, "target");
      }
    }

    // drain
    if (b.y - b.r > H() + 8) drainBall();
  }

  function drawField() {
    // subtle playfield border
    ctx.save();
    ctx.strokeStyle = COLORS.boundary;
    ctx.lineWidth = 2;
    ctx.strokeRect(10.5, 10.5, W() - 21, H() - 21);
    ctx.restore();

    // drain region indicator
    ctx.save();
    ctx.fillStyle = COLORS.drain;
    ctx.fillRect(10, H() - 14, W() - 20, 10);
    ctx.restore();

    // rails (slanted)
    for (const r of state.field.rails) {
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(r.angle);
      ctx.translate(-cx, -cy);
      ctx.fillStyle = COLORS.rail;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }

    // obstacles (blocks)
    if (state.field.obstacles) {
      for (const o of state.field.obstacles) {
        ctx.save();
        ctx.fillStyle = "rgba(255,212,0,0.22)";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "rgba(255,212,0,0.78)";
        ctx.lineWidth = 2;
        ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
        ctx.restore();
      }
    }

    // boosters (push pads)
    if (state.field.boosters) {
      for (const p of state.field.boosters) {
        ctx.save();
        const active = state.t - p.lastHitAt < p.cooldown;
        ctx.fillStyle = active ? "rgba(255,45,85,0.32)" : "rgba(255,45,85,0.22)";
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = active ? "rgba(255,45,85,0.95)" : "rgba(255,45,85,0.85)";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
        ctx.restore();
      }
    }

    // bumpers
    for (const b of state.field.bumpers) {
      ctx.save();
      const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.18, b.color);
      g.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // targets
    for (const t of state.field.targets) {
      if (!t.alive) continue;
      ctx.save();
      ctx.fillStyle = COLORS.target;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.strokeStyle = "rgba(255,255,255,0.20)";
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x + 1, t.y + 1, t.w - 2, t.h - 2);
      ctx.restore();
    }

    // launcher zone
    ctx.save();
    ctx.fillStyle = COLORS.lane;
    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawAim() {
    if (state.phase !== "aim" || !state.isDragging) return;
    const dx = launcher.x - state.dragNow.x;
    const dy = launcher.y - state.dragNow.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const aimLen = clamp(d, 0, launcher.aimMaxLen);
    const ux = dx / d;
    const uy = dy / d;
    const ax = launcher.x + ux * aimLen;
    const ay = launcher.y + uy * aimLen;

    ctx.save();
    ctx.strokeStyle = COLORS.aim;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(launcher.x, launcher.y);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    // power ticks
    const p = clamp((aimLen / launcher.aimMaxLen) * launcher.powerMax, launcher.powerMin, launcher.powerMax);
    const pct = Math.round((p / launcher.powerMax) * 100);
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText(`Power ${pct}%`, launcher.x + 14, launcher.y - 12);
    ctx.restore();
  }

  function drawCpuAimPreview() {
    if (state.phase !== "cpu_aim" || !state.cpuPlan) return;
    const { dragX, dragY } = state.cpuPlan;
    const dx = launcher.x - dragX;
    const dy = launcher.y - dragY;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const ux = dx / d;
    const uy = dy / d;
    const ax = launcher.x + ux * 120;
    const ay = launcher.y + uy * 120;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(launcher.x, launcher.y);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawBall() {
    const b = state.ball;
    if (!b.alive) return;
    ctx.save();
    ctx.shadowColor = COLORS.ballGlow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLORS.ball;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawOverlay() {
    if (state.phase !== "match_over") return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W(), H());
    ctx.fillStyle = COLORS.text;
    ctx.font = "800 28px ui-sans-serif, system-ui";
    const p = state.playerTotal;
    const c = state.cpuTotal;
    const title = p > c ? "YOU WIN" : c > p ? "COMPUTER WINS" : "TIE GAME";
    const sub = `Final: You ${p} — Computer ${c}`;
    const hint = "Press Restart to play again.";
    ctx.textAlign = "center";
    ctx.fillText(title, W() / 2, H() / 2 - 24);
    ctx.font = "600 16px ui-sans-serif, system-ui";
    ctx.fillStyle = COLORS.textMuted;
    ctx.fillText(sub, W() / 2, H() / 2 + 6);
    ctx.fillText(hint, W() / 2, H() / 2 + 30);
    ctx.restore();
  }

  function drawScoreFlash() {
    if (state.flash <= 0) return;
    ctx.save();
    const a = clamp(state.flash / 0.16, 0, 1);
    ctx.fillStyle = `rgba(176,38,255,${0.14 * a})`;
    ctx.fillRect(0, 0, W(), H());
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W(), H());
    drawField();
    drawCpuAimPreview();
    drawAim();
    drawBall();
    drawScoreFlash();
    drawOverlay();
  }

  function tick(now) {
    const rawDt = (now - state.lastTime) / 1000;
    state.lastTime = now;
    const dt = Math.min(GAME.dtMax, Math.max(0, rawDt));
    state.t += dt;

    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);

    if (state.phase === "flying") {
      stepPhysics(dt);
    } else if (state.phase === "draining") {
      state.cpuWait -= dt;
      if (state.cpuWait <= 0) endTurnAndMaybeSwitch();
    } else if (state.phase === "cpu_aim") {
      state.cpuWait -= dt;
      if (state.cpuWait <= 0) {
        // animate a short delay then shoot
        state.cpuWait = 0.0;
        if (state.cpuPlan) shootFromDrag(state.cpuPlan.dragX, state.cpuPlan.dragY);
      }
    }

    render();
    requestAnimationFrame(tick);
  }

  // Initialize
  resetForNewMatch();
  updateUI();
  requestAnimationFrame((t) => {
    state.lastTime = t;
    requestAnimationFrame(tick);
  });
})();

