(() => {
  "use strict";

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const startPanel = document.querySelector("#startPanel");
  const endPanel = document.querySelector("#endPanel");
  const startButton = document.querySelector("#startButton");
  const restartButton = document.querySelector("#restartButton");
  const endEyebrow = document.querySelector("#endEyebrow");
  const endTitle = document.querySelector("#endTitle");
  const endCopy = document.querySelector("#endCopy");
  const healthBar = document.querySelector("#healthBar");
  const ammoReadout = document.querySelector("#ammoReadout");
  const alienReadout = document.querySelector("#alienReadout");
  const message = document.querySelector("#message");

  const TAU = Math.PI * 2;
  const FOV = Math.PI / 3;
  const MAX_RAY_DISTANCE = 22;
  const WALL_SIZE = 1;
  const SHIP_MAP = [
    "1111111111111111111",
    "1000000010000000001",
    "1011111010111111101",
    "1010000010000010101",
    "1010111111111010101",
    "1000100000000010001",
    "1110101111111011111",
    "1000101000001000001",
    "1011101011101111101",
    "1000001000100000101",
    "1011111110111110101",
    "1000000000100000001",
    "1111111111111111111",
  ];

  const keyState = new Set();
  const mouse = {
    locked: false,
    turn: 0,
  };

  const player = {
    x: 2.5,
    y: 1.7,
    angle: 0,
    health: 100,
    clip: 12,
    reserve: 36,
    maxClip: 12,
    fireCooldown: 0,
    reloadTimer: 0,
    hurtTimer: 0,
    bob: 0,
  };

  const aliens = [];
  const shots = [];
  const stars = [];
  const particles = [];

  let state = "menu";
  let lastFrame = performance.now();
  let elapsed = 0;
  let missionTime = 0;
  let kills = 0;
  let waveTimer = 0;
  let messageTimer = 0;

  function resizeCanvas() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * pixelRatio);
    canvas.height = Math.floor(window.innerHeight * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function createStars() {
    stars.length = 0;
    for (let i = 0; i < 160; i += 1) {
      stars.push({
        x: Math.random(),
        y: Math.random() * 0.45,
        r: Math.random() * 1.8 + 0.35,
        twinkle: Math.random() * TAU,
      });
    }
  }

  function resetGame() {
    player.x = 2.5;
    player.y = 1.7;
    player.angle = 0;
    player.health = 100;
    player.clip = 12;
    player.reserve = 36;
    player.fireCooldown = 0;
    player.reloadTimer = 0;
    player.hurtTimer = 0;
    player.bob = 0;
    aliens.length = 0;
    shots.length = 0;
    particles.length = 0;
    kills = 0;
    missionTime = 0;
    waveTimer = 4;
    spawnAlien(16.5, 10.5, "stalker");
    spawnAlien(13.5, 5.5, "rusher");
    spawnAlien(7.5, 11.5, "stalker");
    setMessage("Contain the breach. GPS is offline, and Orion is drifting.");
  }

  function startGame() {
    resetGame();
    state = "playing";
    startPanel.classList.add("is-hidden");
    endPanel.classList.add("is-hidden");
    canvas.requestPointerLock?.();
  }

  function endGame(victory) {
    state = victory ? "won" : "lost";
    document.exitPointerLock?.();
    endPanel.classList.remove("is-hidden");
    endEyebrow.textContent = victory ? "Signal Restored" : "Mission Failed";
    endTitle.textContent = victory ? "Orion is yours again" : "Orion went silent";
    endCopy.textContent = victory
      ? `You cleared ${kills} hostile lifeforms and stabilized the ship long enough to send a distress ping.`
      : `You eliminated ${kills} hostile lifeforms before the breach reached the bridge.`;
  }

  function setMessage(text, seconds = 3.2) {
    message.textContent = text;
    messageTimer = seconds;
  }

  function mapAt(x, y) {
    const row = Math.floor(y);
    const col = Math.floor(x);
    if (row < 0 || row >= SHIP_MAP.length || col < 0 || col >= SHIP_MAP[0].length) {
      return "1";
    }
    return SHIP_MAP[row][col];
  }

  function isWall(x, y) {
    return mapAt(x, y) === "1";
  }

  function normalizeAngle(angle) {
    while (angle < -Math.PI) angle += TAU;
    while (angle > Math.PI) angle -= TAU;
    return angle;
  }

  function distance(a, b, x = player.x, y = player.y) {
    return Math.hypot(a - x, b - y);
  }

  function hasLineOfSight(x0, y0, x1, y1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 9);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      if (isWall(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) {
        return false;
      }
    }
    return true;
  }

  function spawnAlien(x, y, kind = "stalker") {
    aliens.push({
      x,
      y,
      kind,
      health: kind === "rusher" ? 55 : 80,
      maxHealth: kind === "rusher" ? 55 : 80,
      speed: kind === "rusher" ? 1.55 : 1.05,
      attackTimer: 0,
      stun: 0,
      sway: Math.random() * TAU,
    });
  }

  function spawnWave() {
    const spawnPoints = [
      [16.5, 1.5],
      [16.5, 11.5],
      [10.5, 9.5],
      [5.5, 5.5],
      [1.5, 11.5],
    ];
    const count = Math.min(5, 2 + Math.floor(missionTime / 38));
    for (let i = 0; i < count; i += 1) {
      const point = spawnPoints[(i + kills) % spawnPoints.length];
      spawnAlien(point[0], point[1], i % 3 === 0 ? "rusher" : "stalker");
    }
    setMessage("Motion alarms flare across Orion. More aliens are aboard.", 3);
  }

  function tryMove(entity, dx, dy) {
    const radius = 0.22;
    const nx = entity.x + dx;
    const ny = entity.y + dy;
    if (!isWall(nx + Math.sign(dx) * radius, entity.y) && !isWall(nx + Math.sign(dx) * radius, entity.y + radius) && !isWall(nx + Math.sign(dx) * radius, entity.y - radius)) {
      entity.x = nx;
    }
    if (!isWall(entity.x, ny + Math.sign(dy) * radius) && !isWall(entity.x + radius, ny + Math.sign(dy) * radius) && !isWall(entity.x - radius, ny + Math.sign(dy) * radius)) {
      entity.y = ny;
    }
  }

  function shoot() {
    if (state !== "playing" || player.fireCooldown > 0 || player.reloadTimer > 0) return;
    if (player.clip <= 0) {
      setMessage("Empty magazine.", 1.5);
      player.fireCooldown = 0.16;
      return;
    }

    player.clip -= 1;
    player.fireCooldown = 0.22;
    const spread = (Math.random() - 0.5) * 0.025;
    const shotAngle = player.angle + spread;
    const hit = findShotHit(shotAngle);

    shots.push({
      angle: shotAngle,
      life: 0.12,
      hitDistance: hit?.distance || MAX_RAY_DISTANCE,
    });

    if (hit?.alien) {
      const alien = hit.alien;
      const damage = hit.distance < 4 ? 38 : 30;
      alien.health -= damage;
      alien.stun = 0.16;
      spawnHitParticles(alien.x, alien.y, 10, "#6aff8f");
      if (alien.health <= 0) {
        kills += 1;
        spawnHitParticles(alien.x, alien.y, 26, "#baff58");
        aliens.splice(aliens.indexOf(alien), 1);
        if (kills >= 14) {
          endGame(true);
        } else if (aliens.length === 0) {
          setMessage("Deck quiet for now. Keep moving.", 2.5);
          waveTimer = Math.min(waveTimer, 5);
        }
      }
    } else if (hit?.wall) {
      spawnHitParticles(hit.x, hit.y, 6, "#80f3ff");
    }
  }

  function findShotHit(angle) {
    const wallHit = castRay(angle);
    let closest = {
      wall: true,
      distance: wallHit.distance,
      x: wallHit.x,
      y: wallHit.y,
    };

    for (const alien of aliens) {
      const dx = alien.x - player.x;
      const dy = alien.y - player.y;
      const alienAngle = Math.atan2(dy, dx);
      const diff = Math.abs(normalizeAngle(alienAngle - angle));
      const alienDistance = Math.hypot(dx, dy);
      const hitWidth = Math.max(0.045, 0.24 / alienDistance);
      if (diff < hitWidth && alienDistance < closest.distance && hasLineOfSight(player.x, player.y, alien.x, alien.y)) {
        closest = {
          alien,
          distance: alienDistance,
        };
      }
    }

    return closest;
  }

  function reload() {
    if (player.reloadTimer > 0 || player.clip === player.maxClip || player.reserve <= 0) return;
    player.reloadTimer = 1.05;
    setMessage("Reloading handgun.", 1.1);
  }

  function finishReload() {
    const needed = player.maxClip - player.clip;
    const loaded = Math.min(needed, player.reserve);
    player.clip += loaded;
    player.reserve -= loaded;
  }

  function spawnHitParticles(x, y, count, color) {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 1.7,
        vy: (Math.random() - 0.5) * 1.7,
        life: Math.random() * 0.35 + 0.18,
        color,
      });
    }
  }

  function update(dt) {
    elapsed += dt;
    if (state !== "playing") return;

    missionTime += dt;
    messageTimer = Math.max(0, messageTimer - dt);
    if (messageTimer <= 0) {
      message.textContent = "No GPS. No rescue beacon. Clear Orion deck by deck.";
    }

    const sprint = keyState.has("ShiftLeft") || keyState.has("ShiftRight");
    const speed = sprint ? 3.15 : 2.15;
    let moveX = 0;
    let moveY = 0;
    const forward = Number(keyState.has("KeyW")) - Number(keyState.has("KeyS"));
    const strafe = Number(keyState.has("KeyD")) - Number(keyState.has("KeyA"));

    if (forward || strafe) {
      const sin = Math.sin(player.angle);
      const cos = Math.cos(player.angle);
      moveX = (cos * forward - sin * strafe) * speed * dt;
      moveY = (sin * forward + cos * strafe) * speed * dt;
      const length = Math.hypot(moveX, moveY);
      if (length > speed * dt) {
        moveX = (moveX / length) * speed * dt;
        moveY = (moveY / length) * speed * dt;
      }
      player.bob += dt * (sprint ? 14 : 10);
    }

    player.angle = normalizeAngle(player.angle + mouse.turn + (Number(keyState.has("ArrowRight")) - Number(keyState.has("ArrowLeft"))) * dt * 2.8);
    mouse.turn = 0;
    tryMove(player, moveX, moveY);

    if (keyState.has("Space")) shoot();
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);

    if (player.reloadTimer > 0) {
      player.reloadTimer -= dt;
      if (player.reloadTimer <= 0) finishReload();
    }

    waveTimer -= dt;
    if (waveTimer <= 0 && aliens.length < 7 && kills < 14) {
      spawnWave();
      waveTimer = 18 + Math.random() * 10;
    }

    updateAliens(dt);
    updateParticles(dt);
    updateShots(dt);
    updateHud();
  }

  function updateAliens(dt) {
    for (const alien of aliens) {
      alien.sway += dt * 5;
      alien.attackTimer = Math.max(0, alien.attackTimer - dt);
      alien.stun = Math.max(0, alien.stun - dt);
      const dx = player.x - alien.x;
      const dy = player.y - alien.y;
      const playerDistance = Math.hypot(dx, dy);

      if (playerDistance < 0.7 && alien.attackTimer <= 0) {
        alien.attackTimer = alien.kind === "rusher" ? 0.72 : 0.95;
        player.health = Math.max(0, player.health - (alien.kind === "rusher" ? 12 : 18));
        player.hurtTimer = 0.45;
        setMessage("Alien contact. Keep distance.", 1.5);
        if (player.health <= 0) endGame(false);
      }

      if (alien.stun <= 0) {
        const chaseStrength = playerDistance < 10 && hasLineOfSight(alien.x, alien.y, player.x, player.y) ? 1 : 0.55;
        const angle = Math.atan2(dy, dx);
        const wander = Math.sin(alien.sway) * 0.45;
        const moveAngle = angle + wander * (playerDistance > 4 ? 0.2 : 0.05);
        const step = alien.speed * chaseStrength * dt;
        tryMove(alien, Math.cos(moveAngle) * step, Math.sin(moveAngle) * step);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
      if (particle.life <= 0) particles.splice(i, 1);
    }
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i -= 1) {
      shots[i].life -= dt;
      if (shots[i].life <= 0) shots.splice(i, 1);
    }
  }

  function updateHud() {
    healthBar.style.transform = `scaleX(${Math.max(0, player.health / 100)})`;
    ammoReadout.textContent = player.reloadTimer > 0 ? "RELOAD" : `${player.clip} / ${player.reserve}`;
    alienReadout.textContent = String(aliens.length);
  }

  function castRay(angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    let distanceTravelled = 0;
    let x = player.x;
    let y = player.y;
    const step = 0.025;

    while (distanceTravelled < MAX_RAY_DISTANCE) {
      x += cos * step;
      y += sin * step;
      distanceTravelled += step;
      if (isWall(x, y)) {
        return {
          distance: distanceTravelled,
          x,
          y,
          vertical: Math.abs(x - Math.round(x)) < Math.abs(y - Math.round(y)),
        };
      }
    }
    return {
      distance: MAX_RAY_DISTANCE,
      x,
      y,
      vertical: false,
    };
  }

  function draw() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);
    drawSpace(width, height);
    drawShipView(width, height);
    drawParticles(width, height);
    drawAliens(width, height);
    drawGun(width, height);
    drawReticle(width, height);
    drawDamage(width, height);

    if (state === "menu") {
      drawTitleBackdrop(width, height);
    }
  }

  function drawSpace(width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#02040b");
    gradient.addColorStop(0.45, "#060b16");
    gradient.addColorStop(1, "#10151a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (const star of stars) {
      const alpha = 0.35 + Math.sin(elapsed * 2 + star.twinkle) * 0.25;
      ctx.fillStyle = `rgba(225, 248, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(star.x * width, star.y * height, star.r, 0, TAU);
      ctx.fill();
    }

    ctx.fillStyle = "rgba(57, 241, 216, 0.06)";
    ctx.fillRect(0, height * 0.42, width, 2);
  }

  function drawShipView(width, height) {
    const floorGradient = ctx.createLinearGradient(0, height * 0.5, 0, height);
    floorGradient.addColorStop(0, "#111820");
    floorGradient.addColorStop(1, "#06090d");
    ctx.fillStyle = floorGradient;
    ctx.fillRect(0, height * 0.5, width, height * 0.5);

    const ceilingGradient = ctx.createLinearGradient(0, 0, 0, height * 0.5);
    ceilingGradient.addColorStop(0, "rgba(20, 29, 42, 0.94)");
    ceilingGradient.addColorStop(1, "rgba(8, 13, 20, 0.96)");
    ctx.fillStyle = ceilingGradient;
    ctx.fillRect(0, 0, width, height * 0.5);

    const columns = Math.max(220, Math.floor(width / 4));
    const columnWidth = width / columns;
    for (let i = 0; i < columns; i += 1) {
      const rayAngle = player.angle - FOV / 2 + (i / columns) * FOV;
      const hit = castRay(rayAngle);
      const correctedDistance = hit.distance * Math.cos(rayAngle - player.angle);
      const wallHeight = Math.min(height * 1.6, height / Math.max(correctedDistance, 0.12));
      const x = i * columnWidth;
      const y = height / 2 - wallHeight / 2;
      const shade = Math.max(0, 1 - correctedDistance / MAX_RAY_DISTANCE);
      const metal = hit.vertical ? 62 : 46;
      ctx.fillStyle = `rgb(${Math.floor(metal * shade + 8)}, ${Math.floor(98 * shade + 12)}, ${Math.floor(112 * shade + 18)})`;
      ctx.fillRect(x, y, columnWidth + 1, wallHeight);

      if (i % 8 === 0) {
        ctx.fillStyle = `rgba(122, 235, 255, ${0.12 * shade})`;
        ctx.fillRect(x, y, columnWidth + 1, wallHeight);
      }

      const seam = Math.abs((hit.x + hit.y) % WALL_SIZE - 0.5);
      if (seam < 0.035) {
        ctx.fillStyle = `rgba(16, 255, 224, ${0.16 * shade})`;
        ctx.fillRect(x, y, columnWidth + 1, wallHeight);
      }

      const floorLine = height / 2 + wallHeight / 2;
      if (i % 9 === 0 && floorLine < height) {
        ctx.fillStyle = `rgba(255, 200, 87, ${0.07 * shade})`;
        ctx.fillRect(x, floorLine, columnWidth + 1, height - floorLine);
      }
    }

    drawCorridorLights(width, height);
  }

  function drawCorridorLights(width, height) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 7; i += 1) {
      const t = i / 6;
      const y = height * (0.14 + t * 0.29);
      const lightWidth = width * (0.14 + t * 0.65);
      const pulse = 0.12 + Math.sin(elapsed * 3 + i) * 0.04;
      ctx.fillStyle = `rgba(59, 240, 216, ${pulse})`;
      ctx.fillRect(width / 2 - lightWidth / 2, y, lightWidth, 2);
    }
    ctx.restore();
  }

  function worldToScreen(x, y, width, height, size = 1) {
    const dx = x - player.x;
    const dy = y - player.y;
    const dist = Math.hypot(dx, dy);
    const angle = normalizeAngle(Math.atan2(dy, dx) - player.angle);
    if (Math.abs(angle) > FOV / 1.6 || dist < 0.05) return null;
    const screenX = width / 2 + (angle / (FOV / 2)) * (width / 2);
    const scale = Math.min(height * 1.8, height / dist);
    const screenY = height / 2 + scale * 0.1;
    return {
      x: screenX,
      y: screenY,
      w: scale * size * 0.38,
      h: scale * size * 0.88,
      dist,
    };
  }

  function drawAliens(width, height) {
    const visible = aliens
      .map((alien) => ({ alien, screen: worldToScreen(alien.x, alien.y, width, height, alien.kind === "rusher" ? 0.86 : 1) }))
      .filter((item) => item.screen && hasLineOfSight(player.x, player.y, item.alien.x, item.alien.y))
      .sort((a, b) => b.screen.dist - a.screen.dist);

    for (const { alien, screen } of visible) {
      const wobble = Math.sin(alien.sway) * screen.w * 0.08;
      const alpha = Math.max(0.15, 1 - screen.dist / 18);
      ctx.save();
      ctx.translate(screen.x + wobble, screen.y - screen.h / 2);
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 24;
      ctx.shadowColor = "#67ff86";
      ctx.fillStyle = alien.kind === "rusher" ? "#c7ff4f" : "#59f381";
      ctx.beginPath();
      ctx.ellipse(0, 0, screen.w * 0.45, screen.h * 0.48, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "#101713";
      ctx.beginPath();
      ctx.ellipse(-screen.w * 0.15, -screen.h * 0.08, screen.w * 0.08, screen.h * 0.08, 0, 0, TAU);
      ctx.ellipse(screen.w * 0.15, -screen.h * 0.08, screen.w * 0.08, screen.h * 0.08, 0, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = "rgba(12, 24, 14, 0.8)";
      ctx.lineWidth = Math.max(2, screen.w * 0.04);
      ctx.beginPath();
      ctx.moveTo(-screen.w * 0.24, screen.h * 0.1);
      ctx.quadraticCurveTo(0, screen.h * 0.22, screen.w * 0.24, screen.h * 0.1);
      ctx.stroke();

      ctx.strokeStyle = "rgba(156, 255, 174, 0.7)";
      ctx.lineWidth = Math.max(1, screen.w * 0.018);
      for (let i = -1; i <= 1; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * screen.w * 0.18, -screen.h * 0.42);
        ctx.lineTo(i * screen.w * 0.28, -screen.h * 0.63);
        ctx.stroke();
      }

      const healthWidth = screen.w * 0.72;
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(-healthWidth / 2, -screen.h * 0.68, healthWidth, 5);
      ctx.fillStyle = "#ff4d66";
      ctx.fillRect(-healthWidth / 2, -screen.h * 0.68, healthWidth * Math.max(0, alien.health / alien.maxHealth), 5);
      ctx.restore();
    }
  }

  function drawParticles(width, height) {
    for (const particle of particles) {
      const screen = worldToScreen(particle.x, particle.y, width, height, 0.2);
      if (!screen) continue;
      ctx.fillStyle = particle.color;
      ctx.globalAlpha = Math.max(0, particle.life * 2.6);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y - screen.h, Math.max(2, screen.w), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawGun(width, height) {
    const bob = Math.sin(player.bob) * 8;
    const reloadDrop = player.reloadTimer > 0 ? Math.sin((1.05 - player.reloadTimer) * Math.PI) * 58 : 0;
    const recoil = player.fireCooldown > 0.12 ? -18 : 0;
    const baseX = width * 0.58;
    const baseY = height - 56 + bob + reloadDrop + recoil;

    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.fillStyle = "#151d24";
    ctx.strokeStyle = "#5f7b86";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.roundRect(-76, -78, 152, 42, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#23313a";
    ctx.fillRect(42, -70, 62, 18);
    ctx.fillStyle = "#0b1015";
    ctx.fillRect(-20, -37, 45, 78);
    ctx.fillStyle = "#31434c";
    ctx.fillRect(-12, -30, 30, 62);
    ctx.fillStyle = "rgba(59, 240, 216, 0.8)";
    ctx.fillRect(-62, -66, player.clip <= 0 ? 0 : 48 * (player.clip / player.maxClip), 4);

    if (player.fireCooldown > 0.15) {
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255, 200, 87, 0.9)";
      ctx.beginPath();
      ctx.moveTo(100, -62);
      ctx.lineTo(150 + Math.random() * 18, -75 + Math.random() * 24);
      ctx.lineTo(118, -48);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawReticle(width, height) {
    const x = width / 2;
    const y = height / 2;
    ctx.strokeStyle = "rgba(238, 248, 255, 0.86)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 16, y);
    ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, y + 16);
    ctx.stroke();

    for (const shot of shots) {
      const alpha = shot.life / 0.12;
      const length = Math.min(window.innerWidth * 0.42, shot.hitDistance * 80);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(shot.angle - player.angle);
      ctx.strokeStyle = `rgba(255, 224, 125, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(length, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawDamage(width, height) {
    if (player.hurtTimer <= 0) return;
    const alpha = player.hurtTimer / 0.45;
    ctx.fillStyle = `rgba(255, 31, 68, ${0.22 * alpha})`;
    ctx.fillRect(0, 0, width, height);
  }

  function drawTitleBackdrop(width, height) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(59, 240, 216, 0.08)";
    ctx.fillRect(width * 0.58, height * 0.12, width * 0.22, height * 0.76);
    ctx.strokeStyle = "rgba(255, 200, 87, 0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width * 0.72, height * 0.45, Math.min(width, height) * 0.18, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", () => {
    endPanel.classList.add("is-hidden");
    startGame();
  });

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", (event) => {
    keyState.add(event.code);
    if (event.code === "KeyR") reload();
    if (event.code === "Space") {
      event.preventDefault();
      shoot();
    }
    if (event.code === "Enter" && state !== "playing") startGame();
  });
  window.addEventListener("keyup", (event) => keyState.delete(event.code));
  window.addEventListener("mousedown", () => {
    if (state === "playing") {
      canvas.requestPointerLock?.();
      shoot();
    }
  });
  window.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === canvas) {
      mouse.turn += event.movementX * 0.0022;
    }
  });
  document.addEventListener("pointerlockchange", () => {
    mouse.locked = document.pointerLockElement === canvas;
  });

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r) {
      this.beginPath();
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  resizeCanvas();
  createStars();
  updateHud();
  requestAnimationFrame(loop);
})();
