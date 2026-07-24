(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayMsg = document.getElementById("overlayMsg");
  const startBtn = document.getElementById("startBtn");
  const hud = document.getElementById("hud");
  const controls = document.getElementById("controls");
  const castleCountEl = document.getElementById("castleCount");
  const timeCountEl = document.getElementById("timeCount");
  const laserBtn = document.getElementById("laserBtn");
  const bombBtn = document.getElementById("bombBtn");
  const suitBtn = document.getElementById("suitBtn");

  /** 城堡直徑約 5cm（螢幕約 188px @96dpi），以邏輯座標呈現 */
  const CASTLE_DIAMETER = 96;
  const CASTLE_RADIUS = CASTLE_DIAMETER / 2;
  /** 玩家飛行：約 5 秒抵達一座城堡的距離 */
  const PLAYER_SPEED = 2.4;
  /** 坦克射速 2.5 倍 */
  const TANK_FIRE_MULT = 2.5;
  const BASE_TANK_COOLDOWN = 1.1;
  const TANK_COOLDOWN = BASE_TANK_COOLDOWN / TANK_FIRE_MULT;
  const TURRET_COOLDOWN = 1.35;
  const ENEMY_SPAWN_INTERVAL = 2.2;

  const state = {
    running: false,
    won: false,
    lost: false,
    time: 0,
    weapon: "laser",
    suitOn: false,
    pointer: { x: 0, y: 0, active: false },
    player: null,
    castles: [],
    bullets: [],
    lasers: [],
    enemies: [],
    particles: [],
    aimPulse: 0,
    bombFlash: 0,
    lastEnemySpawn: 0,
    width: 960,
    height: 640,
  };

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(220, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.width = w;
    state.height = h;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function angleTo(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x);
  }

  function createPlayer() {
    return {
      x: state.width * 0.18,
      y: state.height * 0.55,
      angle: 0,
      radius: 14,
      fireCooldown: 0,
      bombCooldown: 0,
      trail: [],
    };
  }

  function createCastles() {
    const list = [];
    const count = state.width < 520 ? 3 : 4;
    const marginX = CASTLE_RADIUS + 40;
    const usableW = state.width - marginX * 2;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = marginX + usableW * (0.35 + t * 0.55);
      const y = state.height * (0.28 + (i % 2) * 0.38 + rand(-0.04, 0.04));
      // 四門砲固定方向：前、後、左、右
      const fixedDirs = [
        { angle: -Math.PI / 2, label: "前" }, // 往前
        { angle: Math.PI / 2, label: "後" },  // 往後
        { angle: Math.PI, label: "左" },      // 往左
        { angle: 0, label: "右" },            // 往右
      ];
      const turrets = fixedDirs.map((dir) => ({
        angle: dir.angle,
        cooldown: rand(0.2, TURRET_COOLDOWN),
      }));
      list.push({
        x,
        y,
        radius: CASTLE_RADIUS,
        alive: true,
        tankAngle: rand(0, Math.PI * 2),
        tankCooldown: rand(0, TANK_COOLDOWN),
        turrets,
        hitFlash: 0,
      });
    }
    return list;
  }

  function spawnEnemyPlane() {
    const side = Math.floor(Math.random() * 4);
    let x;
    let y;
    if (side === 0) {
      x = rand(0, state.width);
      y = -20;
    } else if (side === 1) {
      x = state.width + 20;
      y = rand(0, state.height);
    } else if (side === 2) {
      x = rand(0, state.width);
      y = state.height + 20;
    } else {
      x = -20;
      y = rand(0, state.height);
    }
    const target = state.player || { x: state.width / 2, y: state.height / 2 };
    const angle = angleTo({ x, y }, target) + rand(-0.35, 0.35);
    state.enemies.push({
      x,
      y,
      angle,
      speed: rand(1.1, 1.9),
      radius: 12,
      fireCooldown: rand(0.6, 1.6),
      life: 1,
    });
  }

  function addBullet(x, y, angle, speed, fromEnemy, kind) {
    state.bullets.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: kind === "tank" ? 5 : 4,
      fromEnemy: !!fromEnemy,
      kind: kind || "normal",
      life: 4.5,
    });
  }

  function addLaserBeam(x, y, angle, fromPlayer, length) {
    state.lasers.push({
      x,
      y,
      angle,
      length: length || 420,
      width: fromPlayer ? 4 : 3,
      fromPlayer: !!fromPlayer,
      life: fromPlayer ? 0.12 : 0.18,
      maxLife: fromPlayer ? 0.12 : 0.18,
      damageDone: false,
    });
  }

  function burstParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.6, 3.5);
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.8),
        color,
        size: rand(2, 5),
      });
    }
  }

  function clearAllBullets() {
    for (const b of state.bullets) {
      burstParticles(b.x, b.y, "#fbbf24", 3);
    }
    state.bullets.length = 0;
  }

  function firePlayerLaser() {
    const p = state.player;
    if (!p || p.fireCooldown > 0) return;
    p.fireCooldown = 0.18;
    addLaserBeam(p.x, p.y, p.angle, true, 520);
    burstParticles(
      p.x + Math.cos(p.angle) * 18,
      p.y + Math.sin(p.angle) * 18,
      "#38bdf8",
      4
    );
  }

  function fireGiantBomb() {
    const p = state.player;
    if (!p || p.bombCooldown > 0) return;
    p.bombCooldown = 0.85;
    state.bombFlash = 0.35;
    clearAllBullets();
    const rays = 16;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      addLaserBeam(p.x, p.y, a, true, 600);
    }
    burstParticles(p.x, p.y, "#f59e0b", 28);
  }

  function setWeapon(name) {
    if (name !== "laser" && name !== "bomb") return;
    state.weapon = name;
    laserBtn.classList.toggle("active", name === "laser");
    bombBtn.classList.toggle("active", name === "bomb");
  }

  function toggleSuit() {
    state.suitOn = !state.suitOn;
    suitBtn.classList.toggle("active", state.suitOn);
  }

  function destroyCastle(castle) {
    if (!castle.alive) return;
    castle.alive = false;
    castle.hitFlash = 0.4;
    burstParticles(castle.x, castle.y, "#92400e", 30);
    burstParticles(castle.x, castle.y, "#fbbf24", 18);
  }

  function hitPlayer() {
    if (state.lost || state.won) return;
    // 防護衣無限可用，但被擊中時不會產生防護效果
    state.lost = true;
    state.running = false;
    burstParticles(state.player.x, state.player.y, "#dc2626", 40);
    showEnd(false);
  }

  function checkWin() {
    if (state.castles.every((c) => !c.alive)) {
      state.won = true;
      state.running = false;
      showEnd(true);
    }
  }

  function showEnd(won) {
    overlay.hidden = false;
    overlayTitle.textContent = won ? "任務成功" : "任務失敗";
    overlayMsg.textContent = won
      ? "你摧毀了所有城堡防線！雷射準線、巨型炸彈與無盡彈藥助你一臂之力。"
      : state.suitOn
        ? "你被擊中了。防護衣已裝備，但被擊中時不會產生防護效果。"
        : "你被擊中一次，任務失敗。再試一次，瞄準城堡核心！";
    startBtn.textContent = "再次出擊";
    controls.hidden = true;
  }

  function startGame() {
    resize();
    state.running = true;
    state.won = false;
    state.lost = false;
    state.time = 0;
    state.suitOn = false;
    state.weapon = "laser";
    state.bullets = [];
    state.lasers = [];
    state.enemies = [];
    state.particles = [];
    state.bombFlash = 0;
    state.aimPulse = 0;
    state.lastEnemySpawn = 0;
    state.player = createPlayer();
    state.castles = createCastles();
    state.pointer.x = state.player.x + 80;
    state.pointer.y = state.player.y;
    overlay.hidden = true;
    hud.hidden = false;
    controls.hidden = false;
    setWeapon("laser");
    suitBtn.classList.remove("active");
  }

  function pointerFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches && e.touches[0] ? e.touches[0] : e;
    return {
      x: ((src.clientX - rect.left) / rect.width) * state.width,
      y: ((src.clientY - rect.top) / rect.height) * state.height,
    };
  }

  function updatePlayer(dt) {
    const p = state.player;
    if (!p) return;

    const targetAngle = angleTo(p, state.pointer);
    let diff = targetAngle - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.angle += diff * Math.min(1, 8 * dt);

    p.x += Math.cos(p.angle) * PLAYER_SPEED * 60 * dt;
    p.y += Math.sin(p.angle) * PLAYER_SPEED * 60 * dt;

    p.x = Math.max(16, Math.min(state.width - 16, p.x));
    p.y = Math.max(16, Math.min(state.height - 16, p.y));

    p.trail.push({ x: p.x, y: p.y, life: 0.35 });
    if (p.trail.length > 18) p.trail.shift();
    for (const t of p.trail) t.life -= dt;

    if (p.fireCooldown > 0) p.fireCooldown -= dt;
    if (p.bombCooldown > 0) p.bombCooldown -= dt;

    if (state.pointer.active && state.weapon === "laser") {
      firePlayerLaser();
    } else if (state.pointer.active && state.weapon === "bomb") {
      fireGiantBomb();
    }
  }

  function updateCastles(dt) {
    const p = state.player;
    for (const c of state.castles) {
      if (!c.alive) {
        if (c.hitFlash > 0) c.hitFlash -= dt;
        continue;
      }
      c.tankAngle = angleTo(c, p);
      c.tankCooldown -= dt;
      if (c.tankCooldown <= 0) {
        c.tankCooldown = TANK_COOLDOWN;
        const muzzle = CASTLE_RADIUS * 0.55;
        addBullet(
          c.x + Math.cos(c.tankAngle) * muzzle,
          c.y + Math.sin(c.tankAngle) * muzzle,
          c.tankAngle,
          220,
          true,
          "tank"
        );
      }

      for (const turret of c.turrets) {
        turret.cooldown -= dt;
        if (turret.cooldown <= 0) {
          turret.cooldown = TURRET_COOLDOWN;
          const tx = c.x + Math.cos(turret.angle) * (CASTLE_RADIUS * 0.78);
          const ty = c.y + Math.sin(turret.angle) * (CASTLE_RADIUS * 0.78);
          addLaserBeam(tx, ty, turret.angle, false, 280);
        }
      }
    }
  }

  function updateEnemies(dt) {
    state.lastEnemySpawn += dt;
    if (state.lastEnemySpawn >= ENEMY_SPAWN_INTERVAL) {
      state.lastEnemySpawn = 0;
      spawnEnemyPlane();
    }

    const p = state.player;
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const desired = angleTo(e, p);
      let diff = desired - e.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      e.angle += diff * Math.min(1, 2.2 * dt);
      e.x += Math.cos(e.angle) * e.speed * 60 * dt;
      e.y += Math.sin(e.angle) * e.speed * 60 * dt;
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        e.fireCooldown = rand(1.1, 1.8);
        addBullet(e.x, e.y, e.angle, 180, true, "plane");
      }

      if (
        e.x < -80 ||
        e.y < -80 ||
        e.x > state.width + 80 ||
        e.y > state.height + 80
      ) {
        state.enemies.splice(i, 1);
        continue;
      }

      if (dist(e, p) < e.radius + p.radius) {
        hitPlayer();
        return;
      }
    }
  }

  function segmentHitsCircle(x, y, angle, length, cx, cy, radius) {
    const x2 = x + Math.cos(angle) * length;
    const y2 = y + Math.sin(angle) * length;
    const dx = x2 - x;
    const dy = y2 - y;
    const fx = x - cx;
    const fy = y - cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    let disc = b * b - 4 * a * c;
    if (disc < 0 || a === 0) return false;
    disc = Math.sqrt(disc);
    const t1 = (-b - disc) / (2 * a);
    const t2 = (-b + disc) / (2 * a);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
  }

  function updateProjectiles(dt) {
    const p = state.player;

    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (
        b.life <= 0 ||
        b.x < -40 ||
        b.y < -40 ||
        b.x > state.width + 40 ||
        b.y > state.height + 40
      ) {
        state.bullets.splice(i, 1);
        continue;
      }
      if (b.fromEnemy && dist(b, p) < b.radius + p.radius) {
        hitPlayer();
        return;
      }
      if (!b.fromEnemy) {
        for (const c of state.castles) {
          if (c.alive && dist(b, c) < c.radius) {
            destroyCastle(c);
            state.bullets.splice(i, 1);
            checkWin();
            break;
          }
        }
      }
    }

    for (let i = state.lasers.length - 1; i >= 0; i--) {
      const l = state.lasers[i];
      l.life -= dt;
      if (!l.damageDone) {
        l.damageDone = true;
        if (l.fromPlayer) {
          for (const c of state.castles) {
            if (c.alive && segmentHitsCircle(l.x, l.y, l.angle, l.length, c.x, c.y, c.radius * 0.85)) {
              destroyCastle(c);
            }
          }
          for (let ei = state.enemies.length - 1; ei >= 0; ei--) {
            const e = state.enemies[ei];
            if (segmentHitsCircle(l.x, l.y, l.angle, l.length, e.x, e.y, e.radius)) {
              burstParticles(e.x, e.y, "#64748b", 12);
              state.enemies.splice(ei, 1);
            }
          }
          checkWin();
        } else if (segmentHitsCircle(l.x, l.y, l.angle, l.length, p.x, p.y, p.radius)) {
          hitPlayer();
          return;
        }
      }
      if (l.life <= 0) state.lasers.splice(i, 1);
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life -= dt;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
  }

  function update(dt) {
    if (!state.running) return;
    state.time += dt;
    state.aimPulse += dt * 4;
    if (state.bombFlash > 0) state.bombFlash -= dt;

    updatePlayer(dt);
    updateCastles(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateParticles(dt);

    const alive = state.castles.filter((c) => c.alive).length;
    castleCountEl.textContent = `城堡 ${alive}`;
    timeCountEl.textContent = `時間 ${state.time.toFixed(1)}s`;
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, state.height);
    g.addColorStop(0, "#5aa9d8");
    g.addColorStop(0.45, "#9ecceb");
    g.addColorStop(1, "#d9eef8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, state.width, state.height);

    ctx.save();
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 137) % state.width) + (state.time * (8 + i)) % state.width;
      const cy = 40 + (i * 37) % (state.height * 0.45);
      ctx.beginPath();
      ctx.ellipse(cx % state.width, cy, 50 + i * 8, 16 + i * 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    ctx.restore();

    const groundH = Math.max(28, state.height * 0.08);
    const gg = ctx.createLinearGradient(0, state.height - groundH, 0, state.height);
    gg.addColorStop(0, "#4d7c59");
    gg.addColorStop(1, "#2f523a");
    ctx.fillStyle = gg;
    ctx.fillRect(0, state.height - groundH, state.width, groundH);
  }

  function drawCastle(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    if (!c.alive) {
      ctx.globalAlpha = 0.35;
    }

    ctx.beginPath();
    ctx.arc(0, 0, c.radius, 0, Math.PI * 2);
    const stone = ctx.createRadialGradient(0, -10, 8, 0, 0, c.radius);
    stone.addColorStop(0, c.alive ? "#c4b5a0" : "#7a7268");
    stone.addColorStop(1, c.alive ? "#6b5b4a" : "#3f3a35");
    ctx.fillStyle = stone;
    ctx.fill();
    ctx.strokeStyle = "rgba(40, 30, 20, 0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 城垛一圈
    const battlements = 10;
    for (let i = 0; i < battlements; i++) {
      const a = (i / battlements) * Math.PI * 2;
      const bx = Math.cos(a) * (c.radius * 0.78);
      const by = Math.sin(a) * (c.radius * 0.78);
      ctx.fillStyle = c.alive ? "#8b7355" : "#55504a";
      ctx.fillRect(bx - 5, by - 5, 10, 10);
    }

    // 中央塔
    ctx.fillStyle = c.alive ? "#5c4a3a" : "#3a3530";
    ctx.beginPath();
    ctx.arc(0, 0, c.radius * 0.28, 0, Math.PI * 2);
    ctx.fill();

    if (c.alive) {
      // 坦克（可旋轉射擊）
      ctx.save();
      ctx.rotate(c.tankAngle);
      ctx.fillStyle = "#2f3e2f";
      ctx.fillRect(-10, -8, 20, 16);
      ctx.fillStyle = "#1f2a1f";
      ctx.fillRect(4, -3, 22, 6);
      ctx.restore();

      // 固定方向砲：前、後、左、右
      for (const turret of c.turrets) {
        const tx = Math.cos(turret.angle) * (c.radius * 0.78);
        const ty = Math.sin(turret.angle) * (c.radius * 0.78);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(turret.angle);
        ctx.fillStyle = "#334155";
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0f766e";
        ctx.fillRect(0, -2, 14, 4);
        ctx.restore();
      }
    }

    if (c.hitFlash > 0) {
      ctx.globalAlpha = c.hitFlash;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(0, 0, c.radius * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlane(entity, color, suit) {
    ctx.save();
    ctx.translate(entity.x, entity.y);
    ctx.rotate(entity.angle);

    if (suit) {
      ctx.strokeStyle = "rgba(14, 116, 144, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 14, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(14, 116, 144, 0.25)";
      ctx.beginPath();
      ctx.ellipse(0, 0, 26, 17, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-12, 9);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-12, -9);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(-2, -8, 4, 16);
    ctx.restore();
  }

  function drawAimLine() {
    const p = state.player;
    if (!p || state.weapon !== "laser") return;
    const pulse = 0.45 + Math.sin(state.aimPulse) * 0.2;
    ctx.save();
    ctx.strokeStyle = `rgba(14, 165, 233, ${pulse})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(
      p.x + Math.cos(p.angle) * 220,
      p.y + Math.sin(p.angle) * 220
    );
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawLasers() {
    for (const l of state.lasers) {
      const alpha = Math.max(0, l.life / l.maxLife);
      const x2 = l.x + Math.cos(l.angle) * l.length;
      const y2 = l.y + Math.sin(l.angle) * l.length;
      ctx.save();
      ctx.strokeStyle = l.fromPlayer
        ? `rgba(56, 189, 248, ${0.85 * alpha})`
        : `rgba(248, 113, 113, ${0.8 * alpha})`;
      ctx.lineWidth = l.width;
      ctx.shadowColor = l.fromPlayer ? "#38bdf8" : "#f87171";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBullets() {
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = b.kind === "tank" ? "#78350f" : "#7f1d1d";
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life * 1.4);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayerTrail() {
    const p = state.player;
    if (!p) return;
    for (const t of p.trail) {
      if (t.life <= 0) continue;
      ctx.globalAlpha = t.life * 0.5;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    drawSky();

    if (state.bombFlash > 0) {
      ctx.fillStyle = `rgba(251, 191, 36, ${state.bombFlash * 0.35})`;
      ctx.fillRect(0, 0, state.width, state.height);
    }

    for (const c of state.castles) drawCastle(c);
    drawLasers();
    drawBullets();
    drawParticles();

    for (const e of state.enemies) drawPlane(e, "#475569", false);

    if (state.player) {
      drawPlayerTrail();
      drawAimLine();
      drawPlane(state.player, state.suitOn ? "#0e7490" : "#b45309", state.suitOn);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  startBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startGame();
  });

  laserBtn.addEventListener("click", () => setWeapon("laser"));
  bombBtn.addEventListener("click", () => {
    setWeapon("bomb");
    if (state.running) fireGiantBomb();
  });
  suitBtn.addEventListener("click", () => toggleSuit());

  canvas.addEventListener("pointerdown", (e) => {
    if (!state.running) {
      startGame();
      return;
    }
    const pos = pointerFromEvent(e);
    state.pointer.x = pos.x;
    state.pointer.y = pos.y;
    state.pointer.active = true;
    if (state.weapon === "laser") firePlayerLaser();
    if (state.weapon === "bomb") fireGiantBomb();
    canvas.setPointerCapture?.(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = pointerFromEvent(e);
    state.pointer.x = pos.x;
    state.pointer.y = pos.y;
  });

  canvas.addEventListener("pointerup", () => {
    state.pointer.active = false;
  });

  canvas.addEventListener("pointercancel", () => {
    state.pointer.active = false;
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      if (!state.running) {
        startGame();
        return;
      }
      if (state.weapon === "bomb") fireGiantBomb();
      else firePlayerLaser();
    }
    if (e.key === "1") setWeapon("laser");
    if (e.key === "2") {
      setWeapon("bomb");
      if (state.running) fireGiantBomb();
    }
    if (e.key === "3") toggleSuit();
  });

  window.addEventListener("resize", () => {
    const wasRunning = state.running;
    const ratioX = state.player ? state.player.x / state.width : 0.5;
    const ratioY = state.player ? state.player.y / state.height : 0.5;
    resize();
    if (state.player) {
      state.player.x = ratioX * state.width;
      state.player.y = ratioY * state.height;
    }
    if (!wasRunning && state.castles.length === 0) {
      // preview idle sky only
    }
  });

  resize();
  state.castles = [];
  state.player = null;
  requestAnimationFrame(frame);
})();
