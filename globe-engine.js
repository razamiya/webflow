/* =====================================================================
   GLOBE ENGINE — "The Light Ahead"  (v2 — realistic lighting, sharp coastlines)
   Standalone ES module. Host this file on a CDN (e.g. jsDelivr via
   GitHub) and load it from Webflow with:

     <script type="importmap">
     { "imports": { "three": "https://unpkg.com/three@0.165.0/build/three.module.js" } }
     </script>
     <script type="module" src="YOUR_CDN_URL/globe-engine.js"></script>

   This is the version to use going forward — it reverts the v3
   texture-based experiment (which didn't look right) back to the
   procedural approach, with one extra fix: a third, finer noise layer
   plus a much narrower land/ocean threshold, which gives crisper,
   less "blobby" coastlines than the original v1/v2 procedural noise.

   WHAT'S NEW IN v2
   - Canvas-first mounting: if you place your own
     <canvas id="globe-canvas"> somewhere in Designer, the engine
     renders directly into it (sized to its parent element) instead
     of building its own full-screen background layer. Falls back to
     the old full-screen behavior only if no such canvas is found.
   - ResizeObserver-based sizing: the canvas now tracks the size of
     its actual parent container, not just the browser window — so it
     stays correct across responsive breakpoints, tab switches, etc.
   - Realistic day/night lighting, inspired by the classic
     "sun + terminator + Fresnel atmosphere + specular ocean glint"
     approach used in textured Three.js Earth scenes (e.g.
     bobbyroe/threejs-earth), adapted to our procedural (textureless)
     shader:
       - a soft day/night terminator instead of flat lighting
       - a dim ambient floor so the night side isn't pure black
       - city/data-grid lights are now dim in daylight and bright on
         the night side, like real satellite photography
       - a Blinn-Phong specular glint on ocean surfaces, only on the
         sun-facing side
       - a lightweight starfield for scene depth

   WHAT DIDN'T CHANGE
   - The public API: window.Globe (setImpact, setImpactPercent,
     setFromValue, adjustImpact, getImpact, getImpactPercent,
     getRenderedImpact, onChange) — all identical to before, so
     nothing else in your Webflow setup needs to change.
   ===================================================================== */

import * as THREE from "three";

(function initGlobeEngine() {
  // ---- 1. Mount point -------------------------------------------------
  // Prefer a canvas the user placed themselves in Designer.
  let canvas = document.getElementById("globe-canvas");
  let stage;

  if (canvas) {
    // Use the canvas's own parent element as the sizing reference.
    // No extra full-screen div is created.
    stage = canvas.parentElement || document.body;
  } else {
    // Fallback: no canvas found anywhere on the page — build the
    // old full-screen fixed background layer automatically.
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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
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
  window.addEventListener("resize", resize); // still catch window-level changes too

  // ---- 3. Starfield (lightweight scene depth) ----------------------------
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
      color: 0xffffff,
      size: 0.15,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
    });
    return new THREE.Points(geometry, material);
  }
  scene.add(createStarfield());

  // ---- 4. Shader material -------------------------------------------------
  const globeUniforms = {
    uTime: { value: 0 },
    uImpact: { value: 0 }, // 0 = pristine nature, 1 = fully digital
    uLightDir: { value: new THREE.Vector3(2, 1.5, 3) },
  };

  const globeMaterial = new THREE.ShaderMaterial({
    uniforms: globeUniforms,
    vertexShader: `
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      void main() {
        vPos = position;
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
      varying vec3 vPos;
      varying vec3 vNormalW;
      varying vec3 vViewDir;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      float vnoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z);
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

        float land = vnoise(n * 2.3) * 0.6 + vnoise(n * 5.1 + 11.0) * 0.3 + vnoise(n * 12.0 + 3.0) * 0.1;
        land = smoothstep(0.49, 0.51, land);

        vec3 ocean = vec3(0.09, 0.20, 0.34);
        vec3 forest = vec3(0.14, 0.42, 0.28);
        vec3 natureColor = mix(ocean, forest, land);
        vec3 digitalBase = vec3(0.035, 0.038, 0.045);
        vec3 surface = mix(natureColor, digitalBase, smoothstep(0.0, 1.0, uImpact));

        // --- day / night terminator: soft transition, not a hard clamp ---
        float sunDot = dot(N, L);
        float dayMix = smoothstep(-0.15, 0.15, sunDot);
        float nightFactor = 1.0 - dayMix;

        // Night side isn't pure black — small ambient floor, like real photos.
        float ambientFloor = 0.14;
        float lightAmount = mix(ambientFloor, 1.0, dayMix);
        surface *= lightAmount;

        // --- specular ocean glint (Blinn-Phong), sun-facing side only ---
        vec3 halfDir = normalize(L + vViewDir);
        float specAngle = max(dot(N, halfDir), 0.0);
        float spec = pow(specAngle, 48.0) * (1.0 - land) * dayMix;
        vec3 specColor = mix(vec3(0.6, 0.75, 0.95), vec3(1.0, 0.6, 0.3), uImpact);
        surface += spec * specColor * 0.8;

        // --- scattered lights: coarse "city" points + finer, denser field ---
        float coarse = lightDots(n, 9.0, mix(0.90, 0.62, uImpact), 0.4) * land;
        float fine = lightDots(n, 30.0, mix(0.965, 0.72, uImpact), 0.34) * land;
        float seaCables = lightDots(n, 30.0, mix(0.99, 0.88, uImpact), 0.3) * (1.0 - land) * smoothstep(0.25, 1.0, uImpact);
        float dots = clamp(coarse * 0.9 + fine * 0.8 + seaCables * 0.5, 0.0, 1.3);

        // Lights are dim in daylight, bright on the night side — like real
        // satellite photography, instead of uniformly bright everywhere.
        float lightVisibility = mix(0.18, 1.0, nightFactor);
        dots *= lightVisibility;

        float twinkle = 0.82 + 0.18 * sin(uTime * 1.6 + dot(n, vec3(12.9898, 78.233, 45.164)) * 8.0);

        vec3 warmGold = vec3(1.0, 0.78, 0.4);
        vec3 serverOrange = vec3(1.0, 0.42, 0.1);
        vec3 accent = mix(warmGold, serverOrange, uImpact);

        vec3 color = surface + dots * accent * twinkle;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), globeMaterial);
  scene.add(globe);

  // ---- 5. Fresnel atmosphere rim ----------------------------------------
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

  // ---- 6. Animation loop -------------------------------------------------
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

  // ---- 7. Public API: window.Globe ---------------------------------------
  const listeners = new Set();

  window.Globe = {
    setImpact(value) {
      impactTarget = THREE.MathUtils.clamp(value, 0, 1);
      listeners.forEach((fn) => fn(impactTarget));
      return impactTarget;
    },
    setImpactPercent(percent) {
      return this.setImpact(percent / 100);
    },
    setFromValue(value, max) {
      if (!max || max <= 0) return this.setImpact(0);
      return this.setImpact(value / max);
    },
    adjustImpact(delta) {
      return this.setImpact(impactTarget + delta);
    },
    getImpact() {
      return impactTarget;
    },
    getImpactPercent() {
      return Math.round(impactTarget * 100);
    },
    getRenderedImpact() {
      return impactCurrent;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  window.dispatchEvent(new CustomEvent("globe:ready"));
})();
