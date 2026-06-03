(() => {
  "use strict";

  const THREE = window.THREE;
  const canvas = document.querySelector("#gameCanvas");
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

  if (!THREE) {
    message.textContent = "3D engine failed to load. Check your internet connection and refresh.";
    throw new Error("Three.js was not loaded.");
  }

  const CELL = 3;
  const SHIP_HEIGHT = 3.2;
  const EYE_HEIGHT = 1.62;
  const PLAYER_RADIUS = 0.55;
  const ALIEN_RADIUS = 0.62;
  const TARGET_FPS = 120;
  const FIXED_TIMESTEP = 1 / TARGET_FPS;
  const MAX_FRAME_STEPS = 5;
  const MAX_PIXEL_RATIO = 1.25;
  const FAST_SHADOW_SIZE = 512;
  const MAX_DYNAMIC_SHIP_LIGHTS = 10;
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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.physicallyCorrectLights = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020408);
  scene.fog = new THREE.FogExp2(0x03060a, 0.034);

  const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 120);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  const keys = new Set();
  const raycaster = new THREE.Raycaster();
  const wallMeshes = [];
  const aliens = [];
  const shots = [];
  const particles = [];

  const player = {
    x: 2.5 * CELL,
    z: 1.7 * CELL,
    yaw: -Math.PI / 2,
    pitch: 0,
    health: 100,
    clip: 12,
    reserve: 36,
    maxClip: 12,
    fireCooldown: 0,
    reloadTimer: 0,
    hurtTimer: 0,
    bob: 0,
    radius: PLAYER_RADIUS,
  };

  let state = "menu";
  let lastFrame = performance.now();
  let fixedAccumulator = 0;
  let fpsSampleTime = performance.now();
  let fpsSampleFrames = 0;
  let missionTime = 0;
  let kills = 0;
  let waveTimer = 0;
  let messageTimer = 0;
  let gunGroup;
  let gunMuzzle;
  let muzzleFlash;
  let flashLight;
  let flashTimer = 0;
  let playerFlashlight;
  let flashlightTarget;
  let terminalScreenMaterial;
  let terminalScreenLight;
  const shipLights = [];

  function makeTexture(size, painter, repeatX = 1, repeatY = 1) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = size;
    textureCanvas.height = size;
    const textureContext = textureCanvas.getContext("2d");
    painter(textureContext, size);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  }

  function paintNoise(context, size, base, fleck, strength = 0.12) {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    const image = context.getImageData(0, 0, size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 255 * strength;
      image.data[i] = Math.max(0, Math.min(255, image.data[i] + noise));
      image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + noise));
      image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + noise));
    }
    context.putImageData(image, 0, 0);
    context.globalAlpha = 0.28;
    context.fillStyle = fleck;
    for (let i = 0; i < 240; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const w = Math.random() * 18 + 2;
      const h = Math.random() * 2 + 0.5;
      context.fillRect(x, y, w, h);
    }
    context.globalAlpha = 1;
  }

  function createTextures() {
    return {
      wall: makeTexture(512, (context, size) => {
        paintNoise(context, size, "#253039", "#7c8d90", 0.16);
        context.strokeStyle = "rgba(185, 207, 210, 0.22)";
        context.lineWidth = 3;
        for (let x = 0; x <= size; x += size / 4) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, size);
          context.stroke();
        }
        for (let y = 0; y <= size; y += size / 3) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(size, y);
          context.stroke();
        }
        context.strokeStyle = "rgba(0, 0, 0, 0.28)";
        context.lineWidth = 10;
        context.strokeRect(22, 26, size - 44, size - 52);
        context.fillStyle = "rgba(255, 255, 255, 0.08)";
        context.fillRect(44, 50, size - 88, 4);
      }, 1.2, 1.2),
      floor: makeTexture(512, (context, size) => {
        paintNoise(context, size, "#171c20", "#788278", 0.2);
        context.strokeStyle = "rgba(190, 200, 198, 0.18)";
        context.lineWidth = 4;
        for (let x = 0; x <= size; x += size / 5) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, size);
          context.stroke();
        }
        for (let y = 0; y <= size; y += size / 5) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(size, y);
          context.stroke();
        }
        context.fillStyle = "rgba(10, 12, 12, 0.34)";
        for (let i = 0; i < 22; i += 1) {
          context.fillRect(Math.random() * size, Math.random() * size, Math.random() * 80 + 18, Math.random() * 6 + 2);
        }
      }, 1.6, 1.6),
      ceiling: makeTexture(512, (context, size) => {
        paintNoise(context, size, "#10171c", "#5b6b6f", 0.18);
        context.strokeStyle = "rgba(130, 165, 172, 0.18)";
        context.lineWidth = 4;
        for (let y = size / 4; y < size; y += size / 4) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(size, y);
          context.stroke();
        }
      }, 1.2, 1.2),
      glove: makeTexture(256, (context, size) => {
        paintNoise(context, size, "#090b0e", "#5e6a6d", 0.1);
        context.strokeStyle = "rgba(210, 220, 220, 0.12)";
        context.lineWidth = 2;
        for (let x = 0; x < size; x += 18) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x + size * 0.22, size);
          context.stroke();
        }
      }, 2, 2),
      pistol: makeTexture(256, (context, size) => {
        paintNoise(context, size, "#88754f", "#2f281c", 0.11);
        context.strokeStyle = "rgba(255, 240, 184, 0.18)";
        context.lineWidth = 3;
        for (let y = 28; y < size; y += 58) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(size, y + 24);
          context.stroke();
        }
      }, 1.4, 1.4),
      alien: makeTexture(256, (context, size) => {
        paintNoise(context, size, "#1d3a2b", "#86ff8f", 0.23);
        context.globalAlpha = 0.28;
        context.fillStyle = "#020704";
        for (let i = 0; i < 40; i += 1) {
          context.beginPath();
          context.ellipse(Math.random() * size, Math.random() * size, Math.random() * 18 + 4, Math.random() * 8 + 2, Math.random() * Math.PI, 0, Math.PI * 2);
          context.fill();
        }
        context.globalAlpha = 1;
      }, 1.8, 1.8),
    };
  }

  const textures = createTextures();

  function createTerminalTexture() {
    const terminalCanvas = document.createElement("canvas");
    terminalCanvas.width = 1024;
    terminalCanvas.height = 512;
    const terminalContext = terminalCanvas.getContext("2d");

    terminalContext.fillStyle = "#021006";
    terminalContext.fillRect(0, 0, terminalCanvas.width, terminalCanvas.height);

    terminalContext.fillStyle = "rgba(29, 255, 105, 0.08)";
    for (let y = 0; y < terminalCanvas.height; y += 8) {
      terminalContext.fillRect(0, y, terminalCanvas.width, 2);
    }

    terminalContext.strokeStyle = "rgba(54, 255, 129, 0.8)";
    terminalContext.lineWidth = 6;
    terminalContext.strokeRect(22, 22, terminalCanvas.width - 44, terminalCanvas.height - 44);

    terminalContext.shadowColor = "#38ff83";
    terminalContext.shadowBlur = 16;
    terminalContext.fillStyle = "#65ff95";
    terminalContext.font = "700 38px Consolas, 'Courier New', monospace";

    const lines = [
      "ORION NASA DOCUMENT",
      "ORION LAUNCHED ON  2039 JUNE 23RD",
      "________________________________",
      "ATTEMEP TO ALIEN CONTACT",
      "{ STATUS: FAILED }",
      "{ CREW: UNKNOWN (PRESUMED DEAD) ??? }",
      "________________________________",
    ];

    lines.forEach((line, index) => {
      terminalContext.fillText(line, 52, 76 + index * 54);
    });

    terminalContext.font = "700 24px Consolas, 'Courier New', monospace";
    terminalContext.fillText("ARCHIVE ACCESS: ORION_BRIDGE / BLACKBOX", 54, 468);

    const texture = new THREE.CanvasTexture(terminalCanvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  }

  const terminalTexture = createTerminalTexture();

  const materials = {
    floor: new THREE.MeshStandardMaterial({
      color: 0x8b9490,
      map: textures.floor,
      bumpMap: textures.floor,
      bumpScale: 0.045,
      roughness: 0.86,
      metalness: 0.34,
    }),
    floorAlt: new THREE.MeshStandardMaterial({
      color: 0x747e7c,
      map: textures.floor,
      bumpMap: textures.floor,
      bumpScale: 0.04,
      roughness: 0.8,
      metalness: 0.42,
    }),
    ceiling: new THREE.MeshStandardMaterial({
      color: 0x6f7a80,
      map: textures.ceiling,
      bumpMap: textures.ceiling,
      bumpScale: 0.035,
      roughness: 0.86,
      metalness: 0.34,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: 0x9aa5a6,
      map: textures.wall,
      bumpMap: textures.wall,
      bumpScale: 0.055,
      roughness: 0.72,
      metalness: 0.58,
    }),
    wallDark: new THREE.MeshStandardMaterial({
      color: 0x727c7d,
      map: textures.wall,
      bumpMap: textures.wall,
      bumpScale: 0.045,
      roughness: 0.84,
      metalness: 0.42,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x59747a, roughness: 0.42, metalness: 0.72 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xb38a32, roughness: 0.5, metalness: 0.3 }),
    grate: new THREE.MeshStandardMaterial({ color: 0x111719, roughness: 0.74, metalness: 0.72 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x38484c, roughness: 0.55, metalness: 0.82 }),
    slime: new THREE.MeshStandardMaterial({
      color: 0x31533a,
      emissive: 0x0c2b13,
      emissiveIntensity: 0.35,
      roughness: 0.18,
      metalness: 0.02,
      transparent: true,
      opacity: 0.58,
    }),
    laptop: new THREE.MeshStandardMaterial({ color: 0x1b2021, roughness: 0.68, metalness: 0.45 }),
    laptopKey: new THREE.MeshStandardMaterial({ color: 0x070909, roughness: 0.78, metalness: 0.18 }),
    terminalScreen: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x27ff6f,
      emissiveIntensity: 2.8,
      map: terminalTexture,
      emissiveMap: terminalTexture,
      roughness: 0.18,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
    light: new THREE.MeshStandardMaterial({
      color: 0x86fff0,
      emissive: 0x42ffe6,
      emissiveIntensity: 1.8,
      roughness: 0.25,
    }),
    redLight: new THREE.MeshStandardMaterial({
      color: 0xff405c,
      emissive: 0xff163d,
      emissiveIntensity: 1.5,
      roughness: 0.3,
    }),
    alienSkin: new THREE.MeshPhysicalMaterial({
      color: 0x4b7655,
      map: textures.alien,
      bumpMap: textures.alien,
      bumpScale: 0.055,
      emissive: 0x0b371e,
      emissiveIntensity: 0.18,
      roughness: 0.32,
      metalness: 0.02,
      clearcoat: 0.48,
      clearcoatRoughness: 0.2,
    }),
    alienDark: new THREE.MeshPhysicalMaterial({
      color: 0x101914,
      map: textures.alien,
      bumpMap: textures.alien,
      bumpScale: 0.045,
      emissive: 0x031006,
      emissiveIntensity: 0.14,
      roughness: 0.38,
      metalness: 0.02,
      clearcoat: 0.58,
      clearcoatRoughness: 0.18,
    }),
    alienEye: new THREE.MeshStandardMaterial({
      color: 0xff2e55,
      emissive: 0xff1b48,
      emissiveIntensity: 2.8,
      roughness: 0.2,
    }),
    alienClaw: new THREE.MeshStandardMaterial({
      color: 0xd8ffc2,
      emissive: 0x56733e,
      emissiveIntensity: 0.38,
      roughness: 0.4,
    }),
    pistol: new THREE.MeshStandardMaterial({
      color: 0xb29c68,
      map: textures.pistol,
      bumpMap: textures.pistol,
      bumpScale: 0.025,
      roughness: 0.5,
      metalness: 0.66,
    }),
    pistolDark: new THREE.MeshStandardMaterial({ color: 0x17130e, roughness: 0.64, metalness: 0.5 }),
    glove: new THREE.MeshStandardMaterial({
      color: 0x171a1d,
      map: textures.glove,
      bumpMap: textures.glove,
      bumpScale: 0.02,
      roughness: 0.92,
      metalness: 0.03,
    }),
    gloveHighlight: new THREE.MeshStandardMaterial({
      color: 0x30383b,
      map: textures.glove,
      bumpMap: textures.glove,
      bumpScale: 0.018,
      roughness: 0.86,
      metalness: 0.05,
    }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x5d6546, roughness: 0.7, metalness: 0.12 }),
    ammoGlow: new THREE.MeshStandardMaterial({
      color: 0x3bf0d8,
      emissive: 0x25c8c2,
      emissiveIntensity: 1.4,
      roughness: 0.25,
    }),
    muzzle: new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0 }),
  };

  const geometries = {
    wall: new THREE.BoxGeometry(CELL, SHIP_HEIGHT, CELL),
    floor: new THREE.BoxGeometry(CELL, 0.08, CELL),
    ceiling: new THREE.BoxGeometry(CELL, 0.08, CELL),
    trim: new THREE.BoxGeometry(CELL * 0.78, 0.08, 0.1),
    lightStrip: new THREE.BoxGeometry(1.2, 0.04, 0.22),
    particle: new THREE.SphereGeometry(0.065, 8, 8),
  };

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function gridToWorld(value) {
    return value * CELL;
  }

  function mapAtGrid(col, row) {
    if (row < 0 || row >= SHIP_MAP.length || col < 0 || col >= SHIP_MAP[0].length) {
      return "1";
    }
    return SHIP_MAP[row][col];
  }

  function mapAtWorld(x, z) {
    return mapAtGrid(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  function isWallWorld(x, z) {
    return mapAtWorld(x, z) === "1";
  }

  function collides(x, z, radius) {
    const checks = [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius * 0.72, radius * 0.72],
      [-radius * 0.72, radius * 0.72],
      [radius * 0.72, -radius * 0.72],
      [-radius * 0.72, -radius * 0.72],
    ];
    return checks.some(([dx, dz]) => isWallWorld(x + dx, z + dz));
  }

  function tryMove(entity, dx, dz) {
    const radius = entity.radius || ALIEN_RADIUS;
    const nextX = entity.x + dx;
    const nextZ = entity.z + dz;
    if (!collides(nextX, entity.z, radius)) entity.x = nextX;
    if (!collides(entity.x, nextZ, radius)) entity.z = nextZ;
  }

  function hasLineOfSight(x0, z0, x1, z1) {
    const distance = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(distance / 0.35);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      if (isWallWorld(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) {
        return false;
      }
    }
    return true;
  }

  function makeMesh(geometry, material, position, scale) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    if (scale) mesh.scale.copy(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function addPipe(position, axis, length, radius = 0.045) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), materials.pipe);
    pipe.position.copy(position);
    if (axis === "x") pipe.rotation.z = Math.PI / 2;
    if (axis === "z") pipe.rotation.x = Math.PI / 2;
    pipe.castShadow = true;
    pipe.receiveShadow = true;
    scene.add(pipe);
    return pipe;
  }

  function addWallFaceDetail(col, row, x, z, direction) {
    const horizontal = direction === "north" || direction === "south";
    const sign = direction === "north" || direction === "west" ? -1 : 1;
    const panelGeometry = horizontal
      ? new THREE.BoxGeometry(CELL * 0.76, 1.38, 0.055)
      : new THREE.BoxGeometry(0.055, 1.38, CELL * 0.76);
    const panelPosition = new THREE.Vector3(
      x + (!horizontal ? sign * (CELL / 2 + 0.032) : 0),
      1.48,
      z + (horizontal ? sign * (CELL / 2 + 0.032) : 0),
    );
    const panel = makeMesh(panelGeometry, (col + row) % 2 === 0 ? materials.wallDark : materials.trim, panelPosition);
    scene.add(panel);

    const pipeAxis = horizontal ? "x" : "z";
    const pipeOffset = horizontal
      ? new THREE.Vector3(0, 2.62, sign * (CELL / 2 + 0.09))
      : new THREE.Vector3(sign * (CELL / 2 + 0.09), 2.62, 0);
    addPipe(new THREE.Vector3(x + pipeOffset.x, pipeOffset.y, z + pipeOffset.z), pipeAxis, CELL * 0.78, 0.04);

    const slatCount = 5;
    for (let i = 0; i < slatCount; i += 1) {
      const offset = -0.34 + i * 0.17;
      const slatGeometry = horizontal
        ? new THREE.BoxGeometry(CELL * 0.34, 0.035, 0.065)
        : new THREE.BoxGeometry(0.065, 0.035, CELL * 0.34);
      const slatPosition = horizontal
        ? new THREE.Vector3(x + offset, 1.08 + i * 0.04, z + sign * (CELL / 2 + 0.075))
        : new THREE.Vector3(x + sign * (CELL / 2 + 0.075), 1.08 + i * 0.04, z + offset);
      scene.add(makeMesh(slatGeometry, materials.grate, slatPosition));
    }
  }

  function addWallDetails(col, row, x, z) {
    if (mapAtGrid(col, row - 1) !== "1") addWallFaceDetail(col, row, x, z, "north");
    if (mapAtGrid(col, row + 1) !== "1") addWallFaceDetail(col, row, x, z, "south");
    if (mapAtGrid(col - 1, row) !== "1") addWallFaceDetail(col, row, x, z, "west");
    if (mapAtGrid(col + 1, row) !== "1") addWallFaceDetail(col, row, x, z, "east");
  }

  function addOpenCellDetails(col, row, x, z) {
    if ((col + row) % 3 === 0) {
      for (let i = 0; i < 4; i += 1) {
        const grate = makeMesh(
          new THREE.BoxGeometry(CELL * 0.58, 0.025, 0.045),
          materials.grate,
          new THREE.Vector3(x, 0.095, z - 0.28 + i * 0.18),
        );
        scene.add(grate);
      }
    }

    if ((col * 7 + row * 3) % 11 === 0) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.45 + Math.random() * 0.35, 28), materials.slime);
      puddle.position.set(x + (Math.random() - 0.5) * 0.7, 0.105, z + (Math.random() - 0.5) * 0.7);
      puddle.rotation.x = -Math.PI / 2;
      puddle.scale.set(1, 0.42 + Math.random() * 0.35, 1);
      scene.add(puddle);
    }

    if ((col + row) % 4 === 1) {
      addPipe(new THREE.Vector3(x, SHIP_HEIGHT - 0.28, z), col % 2 === 0 ? "x" : "z", CELL * 0.62, 0.035);
    }
  }

  function buildShip() {
    scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x050607, 0.16));

    const emergencyLight = new THREE.DirectionalLight(0xff6a7a, 1.1);
    emergencyLight.position.set(18, 10, -8);
    emergencyLight.castShadow = true;
    emergencyLight.shadow.mapSize.set(FAST_SHADOW_SIZE, FAST_SHADOW_SIZE);
    scene.add(emergencyLight);

    let lightCount = 0;
    for (let row = 0; row < SHIP_MAP.length; row += 1) {
      for (let col = 0; col < SHIP_MAP[row].length; col += 1) {
        const x = col * CELL + CELL / 2;
        const z = row * CELL + CELL / 2;
        const position = new THREE.Vector3(x, 0, z);

        if (SHIP_MAP[row][col] === "1") {
          const wall = makeMesh(
            geometries.wall,
            (row + col) % 3 === 0 ? materials.wallDark : materials.wall,
            new THREE.Vector3(x, SHIP_HEIGHT / 2, z),
          );
          scene.add(wall);
          wallMeshes.push(wall);
          addWallDetails(col, row, x, z);

          if ((row + col) % 4 === 0) {
            const panel = makeMesh(
              new THREE.BoxGeometry(CELL * 0.82, 0.08, CELL * 0.82),
              materials.trim,
              new THREE.Vector3(x, SHIP_HEIGHT * 0.72, z),
            );
            panel.scale.y = 1;
            scene.add(panel);
          }
          continue;
        }

        const floor = makeMesh(
          geometries.floor,
          (row + col) % 2 === 0 ? materials.floor : materials.floorAlt,
          new THREE.Vector3(position.x, 0, position.z),
        );
        const ceiling = makeMesh(
          geometries.ceiling,
          materials.ceiling,
          new THREE.Vector3(position.x, SHIP_HEIGHT, position.z),
        );
        floor.receiveShadow = true;
        ceiling.receiveShadow = true;
        scene.add(floor, ceiling);
        addOpenCellDetails(col, row, x, z);

        if ((row + col) % 3 === 0) {
          const trim = makeMesh(
            geometries.trim,
            materials.hazard,
            new THREE.Vector3(position.x, 0.08, position.z - CELL * 0.42),
          );
          scene.add(trim);
        }

        if ((row + col) % 5 === 0) {
          const strip = makeMesh(
            geometries.lightStrip,
            lightCount % 4 === 0 ? materials.redLight : materials.light,
            new THREE.Vector3(position.x, SHIP_HEIGHT - 0.08, position.z),
          );
          scene.add(strip);
          if (lightCount < MAX_DYNAMIC_SHIP_LIGHTS) {
            const point = new THREE.PointLight(lightCount % 4 === 0 ? 0xff405c : 0x48fff0, lightCount % 4 === 0 ? 18 : 24, 9.5, 2.05);
            point.position.set(position.x, SHIP_HEIGHT - 0.45, position.z);
            scene.add(point);
            shipLights.push({
              light: point,
              base: point.intensity,
              phase: Math.random() * Math.PI * 2,
              emergency: lightCount % 4 === 0,
            });
          }
          lightCount += 1;
        }
      }
    }

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    for (let i = 0; i < 520; i += 1) {
      starPositions.push(
        (Math.random() - 0.5) * 160,
        Math.random() * 60 + 8,
        (Math.random() - 0.5) * 160,
      );
    }
    starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xdff8ff, size: 0.22, transparent: true, opacity: 0.65 }),
    );
    scene.add(stars);
  }

  function cylinderBetween(start, end, radius, material) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.82, length, 10), material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function createAlienVisual(kind) {
    const group = new THREE.Group();
    const size = kind === "rusher" ? 0.86 : 1;
    group.scale.setScalar(size);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 18), materials.alienSkin);
    core.position.y = 1.14;
    core.scale.set(0.76, 1.28, 0.58);
    core.castShadow = true;
    group.add(core);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 18), materials.alienDark);
    chest.position.set(0, 1.55, 0.1);
    chest.scale.set(0.85, 0.72, 0.48);
    chest.castShadow = true;
    group.add(chest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.56, 28, 18), materials.alienDark);
    head.position.set(0, 2.23, 0.22);
    head.scale.set(0.95, 0.58, 1.25);
    head.castShadow = true;
    group.add(head);

    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 5), materials.alienClaw);
    crown.position.set(0, 2.52, -0.36);
    crown.rotation.x = -Math.PI / 2;
    crown.castShadow = true;
    group.add(crown);

    const eyeGlow = new THREE.PointLight(0xff2748, 2.8, 2.3, 2.2);
    eyeGlow.position.set(0, 2.22, 0.82);
    group.add(eyeGlow);

    for (let spine = 0; spine < 7; spine += 1) {
      const ridge = new THREE.Mesh(new THREE.ConeGeometry(0.06 + spine * 0.006, 0.28, 7), materials.alienClaw);
      ridge.position.set(0, 2.22 - spine * 0.19, -0.43 - spine * 0.015);
      ridge.rotation.x = -Math.PI / 2.25;
      ridge.castShadow = true;
      group.add(ridge);
    }

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), materials.alienEye);
      eye.position.set(side * 0.18, 2.27, 0.85);
      group.add(eye);

      const mandible = cylinderBetween(
        new THREE.Vector3(side * 0.12, 2.06, 0.63),
        new THREE.Vector3(side * 0.34, 1.86, 0.95),
        0.035,
        materials.alienClaw,
      );
      group.add(mandible);

      const arm = cylinderBetween(
        new THREE.Vector3(side * 0.48, 1.55, 0.1),
        new THREE.Vector3(side * 1.05, 0.84, 0.45),
        0.085,
        materials.alienSkin,
      );
      group.add(arm);

      const forearm = cylinderBetween(
        new THREE.Vector3(side * 1.05, 0.84, 0.45),
        new THREE.Vector3(side * 0.68, 0.32, 0.92),
        0.07,
        materials.alienDark,
      );
      group.add(forearm);

      for (let claw = -1; claw <= 1; claw += 1) {
        const talon = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 8), materials.alienClaw);
        talon.position.set(side * (0.67 + claw * 0.06), 0.2, 1.05);
        talon.rotation.x = Math.PI / 2;
        talon.rotation.z = side * (0.35 + claw * 0.18);
        talon.castShadow = true;
        group.add(talon);
      }

      const leg = cylinderBetween(
        new THREE.Vector3(side * 0.25, 0.5, -0.05),
        new THREE.Vector3(side * 0.48, 0.08, 0.36),
        0.1,
        materials.alienDark,
      );
      group.add(leg);

      const tendon = cylinderBetween(
        new THREE.Vector3(side * 0.18, 1.95, 0.36),
        new THREE.Vector3(side * 0.38, 1.2, 0.5),
        0.026,
        materials.alienClaw,
      );
      group.add(tendon);
    }

    for (let rib = 0; rib < 5; rib += 1) {
      const ribMesh = new THREE.Mesh(new THREE.TorusGeometry(0.37 - rib * 0.018, 0.018, 8, 26, Math.PI), materials.alienClaw);
      ribMesh.position.set(0, 1.72 - rib * 0.16, 0.43);
      ribMesh.rotation.x = Math.PI * 0.54;
      ribMesh.castShadow = true;
      group.add(ribMesh);
    }

    group.userData.body = core;
    group.userData.head = head;
    return group;
  }

  function createGun() {
    gunGroup = new THREE.Group();
    gunGroup.position.set(0.36, -0.34, -0.78);
    gunGroup.rotation.set(-0.04, -0.08, -0.18);
    camera.add(gunGroup);

    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.42), materials.sleeve);
    sleeve.position.set(-0.05, -0.35, 0.04);
    sleeve.rotation.set(0.22, -0.18, -0.14);
    sleeve.castShadow = false;
    gunGroup.add(sleeve);

    const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 12), materials.gloveHighlight);
    wrist.position.set(0.05, -0.24, -0.04);
    wrist.scale.set(1.05, 0.72, 0.82);
    gunGroup.add(wrist);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.44, 0.22), materials.pistolDark);
    grip.position.set(0.1, -0.22, -0.32);
    grip.rotation.x = -0.18;
    gunGroup.add(grip);

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.72), materials.pistol);
    slide.position.set(0.12, -0.04, -0.55);
    slide.rotation.x = 0.02;
    gunGroup.add(slide);

    const ejectionPort = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.12), materials.pistolDark);
    ejectionPort.position.set(0.12, 0.062, -0.42);
    gunGroup.add(ejectionPort);

    for (let i = 0; i < 7; i += 1) {
      const serration = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.018), materials.pistolDark);
      serration.position.set(-0.026, -0.035, -0.3 - i * 0.048);
      serration.rotation.y = -0.18;
      gunGroup.add(serration);
    }

    for (const z of [-0.32, -0.76]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.008, 16), materials.pistolDark);
      screw.position.set(-0.025, -0.032, z);
      screw.rotation.z = Math.PI / 2;
      gunGroup.add(screw);
    }

    const upperRail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.055, 0.42), materials.pistol);
    upperRail.position.set(0.12, 0.085, -0.57);
    gunGroup.add(upperRail);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 18), materials.pistolDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.12, -0.035, -0.97);
    gunGroup.add(barrel);

    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.01, 8, 18), materials.pistol);
    muzzleRing.position.set(0.12, -0.035, -1.14);
    muzzleRing.rotation.x = Math.PI / 2;
    gunGroup.add(muzzleRing);

    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.34), materials.ammoGlow);
    glow.position.set(-0.035, 0.025, -0.56);
    gunGroup.add(glow);

    const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.012, 8, 18, Math.PI * 1.45), materials.pistolDark);
    triggerGuard.position.set(0.1, -0.145, -0.42);
    triggerGuard.rotation.set(Math.PI / 2, 0, 0.2);
    gunGroup.add(triggerGuard);

    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), materials.glove);
    palm.position.set(-0.02, -0.18, -0.23);
    palm.scale.set(1.2, 0.92, 0.88);
    gunGroup.add(palm);

    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.045, 0.28, 10), materials.gloveHighlight);
    thumb.position.set(-0.1, -0.1, -0.34);
    thumb.rotation.set(0.95, 0.18, 0.78);
    gunGroup.add(thumb);

    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.32 - i * 0.018, 10), i === 0 ? materials.gloveHighlight : materials.glove);
      finger.position.set(0.03 + i * 0.035, -0.13 - i * 0.018, -0.17);
      finger.rotation.set(1.18, 0.08, -0.3);
      gunGroup.add(finger);

      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), materials.gloveHighlight);
      knuckle.position.set(0.02 + i * 0.035, -0.04 - i * 0.018, -0.25);
      knuckle.scale.set(1, 0.65, 0.7);
      gunGroup.add(knuckle);
    }

    const supportPalm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), materials.glove);
    supportPalm.position.set(-0.16, -0.28, -0.36);
    supportPalm.scale.set(1.3, 0.55, 0.92);
    supportPalm.rotation.z = -0.35;
    gunGroup.add(supportPalm);

    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.038, 0.27, 10), materials.glove);
      finger.position.set(-0.22 + i * 0.045, -0.2, -0.48 - i * 0.012);
      finger.rotation.set(1.35, -0.2, 0.12);
      gunGroup.add(finger);
    }

    muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 12), materials.muzzle);
    muzzleFlash.position.set(0.12, -0.035, -1.22);
    muzzleFlash.rotation.x = -Math.PI / 2;
    muzzleFlash.visible = false;
    gunGroup.add(muzzleFlash);

    flashLight = new THREE.PointLight(0xffc857, 0, 4, 2);
    flashLight.position.set(0.12, -0.02, -1.15);
    gunGroup.add(flashLight);

    gunMuzzle = new THREE.Object3D();
    gunMuzzle.position.set(0.12, -0.035, -1.24);
    gunGroup.add(gunMuzzle);
  }

  function createCameraLighting() {
    playerFlashlight = new THREE.SpotLight(0xd8e8ff, 34, 32, Math.PI / 8.5, 0.7, 1.65);
    playerFlashlight.position.set(0.1, -0.12, -0.2);
    playerFlashlight.castShadow = true;
    playerFlashlight.shadow.mapSize.set(FAST_SHADOW_SIZE, FAST_SHADOW_SIZE);
    camera.add(playerFlashlight);

    flashlightTarget = new THREE.Object3D();
    flashlightTarget.position.set(0, -0.05, -12);
    camera.add(flashlightTarget);
    playerFlashlight.target = flashlightTarget;

    const helmetFill = new THREE.PointLight(0x6d91ff, 0.85, 2.2, 2);
    helmetFill.position.set(0, -0.2, -0.55);
    camera.add(helmetFill);
  }

  function createSpawnLaptop() {
    const group = new THREE.Group();
    group.position.set(gridToWorld(3.35), 0, gridToWorld(1.7));
    group.rotation.y = -Math.PI / 2;
    group.scale.setScalar(1.28);
    scene.add(group);

    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.25), materials.wallDark);
    crate.position.set(0, 0.35, 0);
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.09, 1.02), materials.laptop);
    base.position.set(0, 0.76, 0.1);
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const screenBack = new THREE.Mesh(new THREE.BoxGeometry(1.82, 1.08, 0.07), materials.laptop);
    screenBack.position.set(0, 1.25, -0.42);
    screenBack.rotation.x = -0.16;
    screenBack.castShadow = true;
    screenBack.receiveShadow = true;
    group.add(screenBack);

    terminalScreenMaterial = materials.terminalScreen;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 0.94), terminalScreenMaterial);
    screen.position.set(0, 1.25, -0.382);
    screen.rotation.x = -0.16;
    group.add(screen);

    const keyboardRows = 4;
    const keyboardCols = 9;
    for (let row = 0; row < keyboardRows; row += 1) {
      for (let col = 0; col < keyboardCols; col += 1) {
        const key = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.018, 0.055), materials.laptopKey);
        key.position.set(-0.46 + col * 0.115, 0.82, -0.05 + row * 0.075);
        key.castShadow = true;
        group.add(key);
      }
    }

    const trackpad = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.012, 0.18), materials.laptopKey);
    trackpad.position.set(0, 0.825, 0.35);
    group.add(trackpad);

    terminalScreenLight = new THREE.PointLight(0x28ff70, 6.5, 4.2, 2.1);
    terminalScreenLight.position.set(0, 1.28, -0.58);
    group.add(terminalScreenLight);
  }

  function resetGame() {
    player.x = gridToWorld(2.5);
    player.z = gridToWorld(1.7);
    player.yaw = -Math.PI / 2;
    player.pitch = 0;
    player.health = 100;
    player.clip = 12;
    player.reserve = 36;
    player.fireCooldown = 0;
    player.reloadTimer = 0;
    player.hurtTimer = 0;
    player.bob = 0;
    missionTime = 0;
    kills = 0;
    waveTimer = 4;
    messageTimer = 0;

    for (const alien of aliens) scene.remove(alien.group);
    aliens.length = 0;
    for (const shot of shots) scene.remove(shot.line);
    shots.length = 0;
    for (const particle of particles) scene.remove(particle.mesh);
    particles.length = 0;

    spawnAlien(16.5, 10.5, "stalker");
    spawnAlien(13.5, 5.5, "rusher");
    spawnAlien(7.5, 11.5, "stalker");
    setMessage("Contain the breach. GPS is offline, and Orion is drifting.");
    updateHud();
  }

  function spawnAlien(tileX, tileZ, kind = "stalker") {
    const group = createAlienVisual(kind);
    group.position.set(gridToWorld(tileX), 0, gridToWorld(tileZ));
    scene.add(group);
    aliens.push({
      x: group.position.x,
      z: group.position.z,
      radius: ALIEN_RADIUS,
      kind,
      health: kind === "rusher" ? 65 : 95,
      maxHealth: kind === "rusher" ? 65 : 95,
      speed: kind === "rusher" ? 2.65 : 1.95,
      attackTimer: 0,
      stun: 0,
      sway: Math.random() * Math.PI * 2,
      group,
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

  function updatePlayer(dt) {
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const speed = sprint ? 5.8 : 3.9;
    const forward = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const strafe = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
    const move = new THREE.Vector3();

    if (forward || strafe) {
      const forwardVector = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const rightVector = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      move.addScaledVector(forwardVector, forward);
      move.addScaledVector(rightVector, strafe);
      move.normalize().multiplyScalar(speed * dt);
      player.bob += dt * (sprint ? 13 : 9);
    }

    tryMove(player, move.x, move.z);
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);

    if (player.reloadTimer > 0) {
      player.reloadTimer -= dt;
      if (player.reloadTimer <= 0) finishReload();
    }

    const breathing = Math.sin(missionTime * 1.35) * 0.018;
    camera.position.set(player.x, EYE_HEIGHT + Math.sin(player.bob) * 0.035 + breathing, player.z);
    camera.rotation.x = player.pitch;
    camera.rotation.y = player.yaw;

    const recoil = player.fireCooldown > 0.12 ? -0.045 : 0;
    if (gunGroup) {
      gunGroup.position.y = -0.34 + Math.sin(player.bob) * 0.011 + breathing * 0.38 + recoil;
      gunGroup.position.x = 0.36 + Math.cos(player.bob * 0.5) * 0.009;
      gunGroup.rotation.z = -0.18 + Math.sin(player.bob) * 0.008 + Math.sin(missionTime * 1.1) * 0.006;
    }
  }

  function updateLighting() {
    const time = performance.now() * 0.001;
    for (const item of shipLights) {
      const pulse = Math.sin(time * (item.emergency ? 7.5 : 2.6) + item.phase) * 0.12;
      const randomFlicker = item.emergency && Math.sin(time * 27 + item.phase) > 0.82 ? 0.38 : 0;
      item.light.intensity = item.base * (0.78 + pulse + randomFlicker);
    }

    if (playerFlashlight) {
      const failingPower = player.health < 35 ? Math.sin(time * 22) * 3.5 : 0;
      playerFlashlight.intensity = 34 + Math.sin(time * 2.1) * 1.8 + failingPower;
    }

    if (terminalScreenMaterial && terminalScreenLight) {
      const terminalPulse = 1 + Math.sin(time * 4.2) * 0.08 + (Math.sin(time * 19) > 0.92 ? 0.25 : 0);
      terminalScreenMaterial.emissiveIntensity = 1.8 * terminalPulse;
      terminalScreenLight.intensity = 6.5 * terminalPulse;
    }
  }

  function updateAliens(dt) {
    for (const alien of aliens) {
      alien.attackTimer = Math.max(0, alien.attackTimer - dt);
      alien.stun = Math.max(0, alien.stun - dt);
      alien.sway += dt * 5;

      const dx = player.x - alien.x;
      const dz = player.z - alien.z;
      const playerDistance = Math.hypot(dx, dz);

      if (playerDistance < 1.15 && alien.attackTimer <= 0) {
        alien.attackTimer = alien.kind === "rusher" ? 0.62 : 0.88;
        player.health = Math.max(0, player.health - (alien.kind === "rusher" ? 13 : 20));
        player.hurtTimer = 0.45;
        setMessage("Alien contact. Keep distance.", 1.4);
        if (player.health <= 0) endGame(false);
      }

      if (alien.stun <= 0) {
        const canSeePlayer = playerDistance < 32 && hasLineOfSight(alien.x, alien.z, player.x, player.z);
        const baseAngle = Math.atan2(dx, dz);
        const wander = Math.sin(alien.sway) * (canSeePlayer ? 0.15 : 1.1);
        const moveAngle = baseAngle + wander;
        const step = alien.speed * (canSeePlayer ? 1 : 0.45) * dt;
        tryMove(alien, Math.sin(moveAngle) * step, Math.cos(moveAngle) * step);
      }

      alien.group.position.set(alien.x, Math.sin(alien.sway * 1.2) * 0.035, alien.z);
      alien.group.rotation.y = Math.atan2(player.x - alien.x, player.z - alien.z);
      alien.group.userData.body.rotation.z = Math.sin(alien.sway) * 0.08;
      alien.group.userData.head.rotation.x = Math.sin(alien.sway * 0.7) * 0.08;
    }
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i -= 1) {
      const shot = shots[i];
      shot.life -= dt;
      shot.material.opacity = Math.max(0, shot.life / 0.12);
      if (shot.life <= 0) {
        scene.remove(shot.line);
        shot.geometry.dispose();
        shot.material.dispose();
        shots.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.life -= dt;
      particle.velocity.y -= dt * 1.5;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.material.opacity = Math.max(0, particle.life / particle.maxLife);
      if (particle.life <= 0) {
        scene.remove(particle.mesh);
        particle.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }
  }

  function updateFlash(dt) {
    flashTimer = Math.max(0, flashTimer - dt);
    if (!muzzleFlash) return;
    const visible = flashTimer > 0;
    muzzleFlash.visible = visible;
    muzzleFlash.material.opacity = visible ? flashTimer / 0.08 : 0;
    muzzleFlash.scale.setScalar(visible ? 0.65 + Math.random() * 0.8 : 0.01);
    flashLight.intensity = visible ? 3.8 * (flashTimer / 0.08) : 0;
  }

  function updateHud() {
    healthBar.style.transform = `scaleX(${Math.max(0, player.health / 100)})`;
    ammoReadout.textContent = player.reloadTimer > 0 ? "RELOAD" : `${player.clip} / ${player.reserve}`;
    alienReadout.textContent = String(aliens.length);
  }

  function update(dt) {
    updateLighting();

    if (state !== "playing") {
      camera.position.set(player.x, EYE_HEIGHT, player.z);
      camera.rotation.x = player.pitch;
      camera.rotation.y = player.yaw;
      updateFlash(dt);
      return;
    }

    missionTime += dt;
    messageTimer = Math.max(0, messageTimer - dt);
    if (messageTimer <= 0) {
      message.textContent = "No GPS. No rescue beacon. Clear Orion deck by deck.";
    }

    updatePlayer(dt);
    if (keys.has("Space")) shoot();
    updateAliens(dt);
    updateShots(dt);
    updateParticles(dt);
    updateFlash(dt);

    waveTimer -= dt;
    if (waveTimer <= 0 && aliens.length < 7 && kills < 14) {
      spawnWave();
      waveTimer = 18 + Math.random() * 10;
    }

    updateHud();
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
    flashTimer = 0.08;

    camera.updateMatrixWorld();
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    camera.getWorldPosition(origin);
    camera.getWorldDirection(direction);

    raycaster.set(origin, direction);
    const wallHit = raycaster.intersectObjects(wallMeshes, false)[0];
    let closest = {
      distance: wallHit ? wallHit.distance : 70,
      point: wallHit ? wallHit.point.clone() : origin.clone().addScaledVector(direction, 70),
      alien: null,
    };

    for (const alien of aliens) {
      const center = alien.group.position.clone();
      center.y = 1.45;
      const toAlien = center.clone().sub(origin);
      const projection = toAlien.dot(direction);
      if (projection <= 0 || projection >= closest.distance) continue;

      const closestPoint = origin.clone().addScaledVector(direction, projection);
      const hitRadius = alien.kind === "rusher" ? 0.76 : 0.92;
      if (closestPoint.distanceTo(center) < hitRadius && hasLineOfSight(player.x, player.z, alien.x, alien.z)) {
        closest = {
          distance: projection,
          point: closestPoint,
          alien,
        };
      }
    }

    addShotBeam(closest.point);

    if (closest.alien) {
      const alien = closest.alien;
      alien.health -= closest.distance < 8 ? 42 : 34;
      alien.stun = 0.18;
      spawnParticles(closest.point, 14, 0x75ff9a);
      if (alien.health <= 0) {
        kills += 1;
        spawnParticles(alien.group.position.clone().setY(1.2), 30, 0xbaff58);
        scene.remove(alien.group);
        aliens.splice(aliens.indexOf(alien), 1);
        if (kills >= 14) {
          endGame(true);
        } else if (aliens.length === 0) {
          setMessage("Deck quiet for now. Keep moving.", 2.4);
          waveTimer = Math.min(waveTimer, 5);
        }
      }
    } else {
      spawnParticles(closest.point, 7, 0x8ef7ff);
    }
  }

  function addShotBeam(hitPoint) {
    const start = new THREE.Vector3();
    gunMuzzle.getWorldPosition(start);
    const geometry = new THREE.BufferGeometry().setFromPoints([start, hitPoint]);
    const material = new THREE.LineBasicMaterial({
      color: 0xffd176,
      transparent: true,
      opacity: 1,
      linewidth: 2,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    shots.push({ line, geometry, material, life: 0.12 });
  }

  function spawnParticles(point, count, color) {
    for (let i = 0; i < count; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(geometries.particle, material);
      mesh.position.copy(point);
      scene.add(mesh);
      particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 2.4,
          Math.random() * 1.6 + 0.2,
          (Math.random() - 0.5) * 2.4,
        ),
        life: Math.random() * 0.35 + 0.22,
        maxLife: 0.57,
      });
    }
  }

  function reload() {
    if (state !== "playing" || player.reloadTimer > 0 || player.clip === player.maxClip || player.reserve <= 0) return;
    player.reloadTimer = 1.08;
    setMessage("Reloading handgun.", 1.08);
  }

  function finishReload() {
    const needed = player.maxClip - player.clip;
    const loaded = Math.min(needed, player.reserve);
    player.clip += loaded;
    player.reserve -= loaded;
  }

  function animate(now) {
    const frameTime = Math.min(0.12, (now - lastFrame) / 1000);
    lastFrame = now;

    fixedAccumulator += frameTime;
    let frameSteps = 0;
    while (fixedAccumulator >= FIXED_TIMESTEP && frameSteps < MAX_FRAME_STEPS) {
      update(FIXED_TIMESTEP);
      fixedAccumulator -= FIXED_TIMESTEP;
      frameSteps += 1;
    }

    if (frameSteps === MAX_FRAME_STEPS) {
      fixedAccumulator = 0;
    }

    renderer.render(scene, camera);
    fpsSampleFrames += 1;
    if (now - fpsSampleTime >= 1000) {
      canvas.dataset.fps = String(fpsSampleFrames);
      fpsSampleFrames = 0;
      fpsSampleTime = now;
    }

    requestAnimationFrame(animate);
  }

  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", () => {
    endPanel.classList.add("is-hidden");
    startGame();
  });

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (event.code === "KeyR") reload();
    if (event.code === "Space") {
      event.preventDefault();
      shoot();
    }
    if (event.code === "Enter" && state !== "playing") startGame();
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("mousedown", () => {
    if (state === "playing") {
      canvas.requestPointerLock?.();
      shoot();
    }
  });
  window.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas) return;
    player.yaw -= event.movementX * 0.00235;
    player.pitch -= event.movementY * 0.00185;
    player.pitch = THREE.MathUtils.clamp(player.pitch, -0.82, 0.82);
  });

  buildShip();
  createSpawnLaptop();
  createGun();
  createCameraLighting();
  resize();
  resetGame();
  requestAnimationFrame(animate);
})();
