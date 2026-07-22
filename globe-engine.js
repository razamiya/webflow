/* =====================================================================
   GLOBE ENGINE — "The Light Ahead"  (v3 — real Earth textures)
   Standalone ES module. Same public API as v2 — window.Globe is
   unchanged, so nothing in your Webflow form/JS needs to change.

   WHAT'S NEW IN v3
   - At low impact, the globe now uses a REAL Earth day-map and
     night-lights texture (not procedural noise) — this is what fixes
     the "hazy/blurry continents" problem. Real coastlines, real
     cloud texture, real city lights.
   - As uImpact rises, the surface still fades toward the dark
     "digital" base, and a procedural light-grid (same lightDots
     technique as before) fades IN on top, replacing real city
     lights with the server-grid look.
   - Day/night terminator, ambient floor, and specular ocean glint
     from v2 are all kept.

   TEXTURE SOURCE
   Earth day/night textures loaded from the official three.js example
   asset set (examples/textures/planets/ in the three.js GitHub repo),
   which has shipped with three.js for years and is commonly used in
   tutorials this way. For a production build, ask your developer to
   host their own copy of these images (rather than hotlinking GitHub
   long-term) and confirm current licensing/attribution requirements
   for whichever texture source they end up using.
   ===================================================================== */

import * as THREE from "three";

(function initGlobeEngine() {
  // ---- 1. Mount point -------------------------------------------------
  let canvas = document.getElementById("globe-canvas");
  let stage;

  if (canvas) {
    stage = canvas.parentElement || document.body;
  } else {
    stage = document.getElementById("globe-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.id = "globe-stage";
      stage.style.position = "fixed";
      stage.style.inset = "0";
      stage.style.zIndex = "0";
      document.body.prepend(stage);
    }
    canvas = document.createElement("canvas");
    canvas.id = "globe-canvas";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    stage.appendChild(canvas);
  }

  // ---- 2. Renderer / scene / camera -----------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(1.1, 0.1, 3.6);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  function resize() {
    const width = stage.clientWidth || window.innerWidth;
    const height = stage.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  resize();
  new ResizeObserver(resize).observe(stage);
  window.addEventListener("resize", resize);

  // ---- 3. Starfield -------------------------------------------------------
  function createStarfield() {
    const starCount = 800;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 40 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.8,
    });
    return new THREE.Points(geometry, material);
  }
  scene.add(createStarfield());

  // ---- 4. Load real Earth textures ----------------------------------------
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  // Solar System Scope free textures (CC BY 4.0 — credit required).
  const dayMap = loader.load(
    "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg"
  );
  const nightMap = loader.load(
    "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_lights_2048.png"
  );
  dayMap.colorSpace = THREE.SRGBColorSpace;
  nightMap.colorSpace = THREE.SRGBColorSpace;

  // ---- 5. Shader material ---------------------------------------------------
  const globeUniforms = {
    uTime: { value: 0 },
    uImpact: { value: 0 },
    uLightDir: { value: new THREE.Vector3(2, 1.5, 3) },
    uDayMap: { value: dayMap },
    uNightMap: { value: nightMap },
  };

  const globeMaterial = new THREE.ShaderMaterial({
    uniforms: globeUniforms,
    vertexShader: `
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        vPos = position;
        vUv = uv;
        vNormalW = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uImpact;
      uniform vec3 uLightDir;
      uniform sampler2D uDayMap;
      uniform sampler2D uNightMap;
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec2 vUv;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      float lightDots(vec3 p, float freq, float threshold, float dotRadius) {
        vec3 scaled = p * freq;
        vec3 cell = floor(scaled);
        vec3 local = fract(scaled) - 0.5;
        float h = hash(cell);
        float on = step(threshold, h);
        float shape = smoothstep(dotRadius, dotRadius * 0.2, length(local));
        return on * shape;
      }

      void main() {
        vec3 n = normalize(vPos);
        vec3 N = normalize(vNormalW);
        vec3 L = normalize(uLightDir);

        vec3 dayColor = texture2D(uDayMap, vUv).rgb;
        vec3 cityLights = texture2D(uNightMap, vUv).rgb; // real night-lights map

        // Roughly estimate land vs ocean from the day texture's own
        // brightness/greenness, just to steer the digital-grid overlay
        // (oceans get "sea cable" dots, land gets "server grid" dots).
        float landGuess = clamp(dayColor.g - dayColor.b * 0.5, 0.0, 1.0);
        landGuess = smoothstep(0.08, 0.22, landGuess);

        // --- day / night terminator ---
        float sunDot = dot(N, L);
        float dayMix = smoothstep(-0.15, 0.15, sunDot);
        float nightFactor = 1.0 - dayMix;
        float ambientFloor = 0.10;
        float lightAmount = mix(ambientFloor, 1.0, dayMix);

        vec3 litDay = dayColor * lightAmount;
        vec3 litNight = dayColor * ambientFloor + cityLights * 1.6;
        vec3 photoSurface = mix(litNight, litDay, dayMix);

        // --- specular ocean glint (day side only) ---
        vec3 halfDir = normalize(L + vViewDir);
        float specAngle = max(dot(N, halfDir), 0.0);
        float spec = pow(specAngle, 48.0) * (1.0 - landGuess) * dayMix;
        vec3 specColor = mix(vec3(0.6, 0.75, 0.95), vec3(1.0, 0.6, 0.3), uImpact);
        photoSurface += spec * specColor * 0.7;

        // --- fade toward the dark "digital" base as impact rises ---
        vec3 digitalBase = vec3(0.035, 0.038, 0.045) * (0.4 + 0.6 * lightAmount);
        vec3 surface = mix(photoSurface, digitalBase, smoothstep(0.0, 1.0, uImpact) * 0.85);

        // --- procedural digital grid overlay, grows in with impact ---
        float coarse = lightDots(n, 9.0, mix(1.0, 0.62, uImpact), 0.4) * landGuess;
        float fine = lightDots(n, 30.0, mix(1.0, 0.72, uImpact), 0.34) * landGuess;
        float seaCables = lightDots(n, 30.0, mix(1.0, 0.88, uImpact), 0.3) * (1.0 - landGuess) * smoothstep(0.15, 1.0, uImpact);
        float grid = clamp(coarse * 0.9 + fine * 0.8 + seaCables * 0.5, 0.0, 1.3);
        grid *= smoothstep(0.0, 0.35, uImpact); // grid only starts appearing after a little impact
        float gridVisibility = mix(0.25, 1.0, nightFactor);
        grid *= gridVisibility;

        float twinkle = 0.82 + 0.18 * sin(uTime * 1.6 + dot(n, vec3(12.9898, 78.233, 45.164)) * 8.0);
        vec3 serverOrange = vec3(1.0, 0.45, 0.12);

        vec3 color = surface + grid * serverOrange * twinkle;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), globeMaterial);
  scene.add(globe);

  // ---- 6. Fresnel atmosphere rim ----------------------------------------
  const rimMaterial = new THREE.ShaderMaterial({
    uniforms: globeUniforms,
    transparent: true,
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uImpact;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float rim = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);
        vec3 warm = vec3(0.3, 0.55, 0.9);
        vec3 hot = vec3(1.0, 0.45, 0.15);
        gl_FragColor = vec4(mix(warm, hot, uImpact), rim * 0.5);
      }
    `,
  });
  const rimMesh = new THREE.Mesh(new THREE.SphereGeometry(1.03, 64, 64), rimMaterial);
  scene.add(rimMesh);

  // ---- 7. Animation loop ---------------------------------------------------
  const clock = new THREE.Clock();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let impactTarget = 0;
  let impactCurrent = 0;

  function tick() {
    const delta = clock.getDelta();
    globeUniforms.uTime.value += delta;
    impactCurrent += (impactTarget - impactCurrent) * 0.06;
    globeUniforms.uImpact.value = impactCurrent;
    if (!reduceMotion) {
      globe.rotation.y += delta * 0.045;
      rimMesh.rotation.y = globe.rotation.y;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- 8. Public API: window.Globe (unchanged) ---------------------------
  const listeners = new Set();

  window.Globe = {
    setImpact(value) {
      impactTarget = THREE.MathUtils.clamp(value, 0, 1);
      listeners.forEach((fn) => fn(impactTarget));
      return impactTarget;
    },
    setImpactPercent(percent) { return this.setImpact(percent / 100); },
    setFromValue(value, max) {
      if (!max || max <= 0) return this.setImpact(0);
      return this.setImpact(value / max);
    },
    adjustImpact(delta) { return this.setImpact(impactTarget + delta); },
    getImpact() { return impactTarget; },
    getImpactPercent() { return Math.round(impactTarget * 100); },
    getRenderedImpact() { return impactCurrent; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  window.dispatchEvent(new CustomEvent("globe:ready"));
})();
