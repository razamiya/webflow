/* =====================================================================
   GLOBE ENGINE — "The Light Ahead"
   Standalone ES module. Host this file on a CDN (e.g. jsDelivr via
   GitHub) and load it from Webflow with:

     <script type="importmap">
     { "imports": { "three": "https://unpkg.com/three@0.165.0/build/three.module.js" } }
     </script>
     <script type="module" src="YOUR_CDN_URL/globe-engine.js"></script>

   WHAT THIS FILE DOES
   - Finds (or creates) a full-screen fixed canvas and renders a
     procedural, shader-based Earth in it.
   - Exposes a single public control surface: window.Globe
   - Every other piece of the experience (quiz form, scroll position,
     toggles) talks to the globe ONLY through window.Globe — this file
     never needs to know who is calling it.

   MOUNT POINT
   - By default it looks for an element with id="globe-stage" to put
     the canvas into. If that element doesn't exist, it creates one
     itself and appends it to <body> as a fixed full-screen layer
     behind everything else (z-index: 0).
   ===================================================================== */

import * as THREE from "three";

(function initGlobeEngine() {
  // ---- 1. Mount point -------------------------------------------------
  let stage = document.getElementById("globe-stage");
  if (!stage) {
    stage = document.createElement("div");
    stage.id = "globe-stage";
    stage.style.position = "fixed";
    stage.style.inset = "0";
    stage.style.zIndex = "0";
    document.body.prepend(stage);
  }

  let canvas = document.getElementById("globe-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "globe-canvas";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    stage.appendChild(canvas);
  }

  // ---- 2. Renderer / scene / camera -----------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(1.1, 0.1, 3.6);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setClearColor(0x000000, 0);

  // Cap pixel ratio at 2 — rendering at full retina density (3x on some
  // phones) costs a lot of GPU time for no visible benefit.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", resize);

  // ---- 3. Shader material ----------------------------------------------
  const globeUniforms = {
    uTime: { value: 0 },
    uImpact: { value: 0 }, // 0 = pristine nature, 1 = fully digital
    uLightDir: { value: new THREE.Vector3(2, 1.5, 3) },
  };

  const globeMaterial = new THREE.ShaderMaterial({
    uniforms: globeUniforms,
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uImpact;
      uniform vec3 uLightDir;
      varying vec3 vPos;

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

        float land = vnoise(n * 2.3) * 0.65 + vnoise(n * 5.1 + 11.0) * 0.35;
        land = smoothstep(0.46, 0.56, land);

        vec3 ocean = vec3(0.09, 0.20, 0.34);
        vec3 forest = vec3(0.14, 0.42, 0.28);
        vec3 natureColor = mix(ocean, forest, land);
        vec3 digitalBase = vec3(0.035, 0.038, 0.045);
        vec3 surface = mix(natureColor, digitalBase, smoothstep(0.0, 1.0, uImpact));

        float diff = max(dot(n, normalize(uLightDir)), 0.16);
        surface *= diff;

        float coarse = lightDots(n, 9.0, mix(0.90, 0.62, uImpact), 0.4) * land;
        float fine = lightDots(n, 30.0, mix(0.965, 0.72, uImpact), 0.34) * land;
        float seaCables = lightDots(n, 30.0, mix(0.99, 0.88, uImpact), 0.3) * (1.0 - land) * smoothstep(0.25, 1.0, uImpact);
        float dots = clamp(coarse * 0.9 + fine * 0.8 + seaCables * 0.5, 0.0, 1.3);

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

  // ---- 4. Animation loop -------------------------------------------------
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

  // ---- 5. Public API: window.Globe ---------------------------------------
  const listeners = new Set();

  window.Globe = {
    /** Set light coverage as a 0–1 fraction. */
    setImpact(value) {
      impactTarget = THREE.MathUtils.clamp(value, 0, 1);
      listeners.forEach((fn) => fn(impactTarget));
      return impactTarget;
    },
    /** Set light coverage as a 0–100 percentage. */
    setImpactPercent(percent) {
      return this.setImpact(percent / 100);
    },
    /** Map any raw value + its known max to 0–1 automatically. */
    setFromValue(value, max) {
      if (!max || max <= 0) return this.setImpact(0);
      return this.setImpact(value / max);
    },
    /** Nudge the current target up/down by a delta (0–1 units). */
    adjustImpact(delta) {
      return this.setImpact(impactTarget + delta);
    },
    /** Current target, 0–1. */
    getImpact() {
      return impactTarget;
    },
    /** Current target, 0–100. */
    getImpactPercent() {
      return Math.round(impactTarget * 100);
    },
    /** Currently rendered value (0–1) — lags the target slightly since it eases in. */
    getRenderedImpact() {
      return impactCurrent;
    },
    /** Subscribe to every change. Returns an unsubscribe function. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // Let the page know the engine is ready (useful if your form/script
  // loads before this file finishes initializing).
  window.dispatchEvent(new CustomEvent("globe:ready"));
})();
