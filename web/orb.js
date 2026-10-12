/* Wizard OS orb — a WebGL glass sphere with a living galaxy inside.
   Exposes window.Orb with setMode(mode) and setLevel(0..1). Falls back to the PNG orb.
   Shared by every Wizard surface: the in-app dock, the side button (android/app/src/main/assets/assist/) and the
   Wizard Everywhere floating orb. The Android copy is checked byte-for-byte by SharedOrbTest. */
(function () {
  const canvas = document.getElementById('orb');
  const fallback = document.getElementById('orbFallback');
  const MODES = {
    idle:     { a: [0.05, 0.02, 0.16], b: [0.42, 0.22, 1.00], c: [1.00, 0.30, 0.82], energy: 0.18, spin: 0.22, ring: 0.0, core: 0.55 },
    listen:   { a: [0.06, 0.02, 0.20], b: [0.55, 0.30, 1.00], c: [1.00, 0.36, 0.86], energy: 0.85, spin: 0.85, ring: 1.0, core: 1.00 },
    command:  { a: [0.00, 0.05, 0.12], b: [0.12, 0.85, 1.00], c: [1.00, 0.80, 0.30], energy: 1.00, spin: 1.40, ring: 1.0, core: 1.15 },
    paused:   { a: [0.04, 0.03, 0.10], b: [0.30, 0.24, 0.60], c: [0.55, 0.40, 0.75], energy: 0.06, spin: 0.00, ring: 0.25, core: 0.30 },
    think:    { a: [0.05, 0.02, 0.18], b: [0.48, 0.32, 1.00], c: [0.35, 0.90, 1.00], energy: 0.60, spin: 2.60, ring: 0.45, core: 0.85 },
    agent:    { a: [0.05, 0.02, 0.16], b: [0.62, 0.30, 1.00], c: [1.00, 0.45, 0.90], energy: 0.70, spin: 0.60, ring: 0.6, core: 1.05 },
    done:     { a: [0.02, 0.06, 0.08], b: [0.20, 0.95, 0.70], c: [0.55, 0.65, 1.00], energy: 0.55, spin: 0.50, ring: 0.5, core: 1.00 },
    // Wizard Everywhere over a keyboard: the same orb, cooler, ready to type what you say.
    type:     { a: [0.01, 0.04, 0.10], b: [0.16, 0.66, 1.00], c: [0.62, 0.42, 1.00], energy: 0.22, spin: 0.30, ring: 0.0, core: 0.60 },
    typing:   { a: [0.01, 0.05, 0.12], b: [0.14, 0.80, 1.00], c: [0.70, 0.45, 1.00], energy: 0.85, spin: 0.85, ring: 1.0, core: 1.00 },
  };

  const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  const FRAG = `
precision highp float;
uniform vec2 res; uniform float t; uniform float lvl; uniform float energy; uniform float spin;
uniform float ring; uniform float core; uniform float press; uniform float R;
uniform vec3 cA; uniform vec3 cB; uniform vec3 cC;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
void main(){
  vec2 uv = (gl_FragCoord.xy*2.-res)/min(res.x,res.y);
  float r = length(uv);
  float Rr = R*(1.0 + 0.035*lvl*energy - 0.04*press);
  vec3 col = vec3(0.); float a = 0.;
  float ang = atan(uv.y, uv.x);
  if (r < Rr) {
    vec2 p = uv/Rr; float rad = length(p); float z = sqrt(max(1.-rad*rad, 0.));
    vec3 nrm = vec3(p, z);
    // refraction: interior is seen through a lens
    vec2 q = p * (0.75 + 0.35*z);
    float qa = atan(q.y,q.x); float qr = length(q);
    float tw = qa + t*spin + (2.6 + 2.0*energy)*(1.0 - qr);
    vec2 s = vec2(cos(tw), sin(tw))*qr;
    float warp = fbm(s*3.0 + vec2(t*.12, -t*.09));
    float f = fbm(s*2.2 + warp*1.6 - vec2(t*.05));
    float arms = pow(.5+.5*sin(qa*2. - log(qr+.04)*4.2 + t*spin*1.6 + warp*2.), 2.5);
    float dust = smoothstep(.55, .95, fbm(s*7. + t*.2)) * .8;
    float stars = step(.985, h(floor(s*60.)))*smoothstep(.9,.2,qr);
    float c0 = exp(-qr*qr*(9.0 - 3.0*energy))*core;
    vec3 inner = cA;
    inner += cB * pow(f, 1.6) * (1.1 + .6*energy);
    inner += cC * arms * f * (.45 + .9*energy + .6*lvl);
    inner += mix(cB,cC,.5) * dust * (.25 + .5*energy);
    inner += vec3(1.,.95,1.) * (c0 + stars*.9);
    inner *= .30 + .85*z;
    float fres = pow(1.-z, 2.2);
    inner += mix(cB, cC, .55 + .45*sin(ang*2.+t*.7)) * fres * (1.0 + .8*energy);
    vec3 L = normalize(vec3(-.55,.65,.75));
    float spec = pow(max(dot(nrm, normalize(L+vec3(0,0,1))),0.), 70.)*1.35;
    float spec2 = pow(max(dot(nrm, normalize(vec3(.6,-.55,.6)+vec3(0,0,1))),0.), 26.)*.18;
    float arc = smoothstep(.035, 0., abs(length(p-vec2(-.18,.24)) - .62)) * smoothstep(-.1,.5,p.y-p.x*.3) * .22;
    inner += spec + spec2*cC + arc;
    inner += cC * pow(max(-p.y,0.), 3.) * .45 * z;
    float edge = smoothstep(Rr, Rr-.018, r);
    float rim = smoothstep(.04,0.,abs(r-Rr+.012))*.55;
    col = (inner + mix(cB,cC,.5)*rim) * edge; a = edge;
  }
  // audio ring
  float rr = Rr + .10 + .05*lvl;
  float wob = .035*ring*(lvl*1.4+.25)*(n(vec2(ang*2.2 + t*1.3, t*.8))-.5)*2.;
  float ringD = abs(r - rr - wob);
  float ringL = exp(-ringD*90.)*ring*(.35+lvl*1.2) + exp(-ringD*28.)*ring*.12;
  float ring2 = exp(-abs(r - rr - .07 + wob*.6)*120.)*ring*lvl*.6;
  vec3 rc = mix(cB, cC, .5+.5*sin(ang*3. - t*2.));
  // halo
  float g = exp(-max(r-Rr,0.)*(5.5 - 1.5*energy)) * (.28 + .5*energy + .4*lvl);
  vec3 glow = mix(cB, cC, .35) * g + rc*(ringL+ring2);
  float ga = clamp(g*.9 + ringL + ring2, 0., 1.);
  col = col + glow*(1.-a);
  float alpha = a + ga*(1.-a);
  gl_FragColor = vec4(col, alpha);
}`;

  let gl = null, prog = null, U = {};
  try {
    gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
  } catch (e) { gl = null; }

  const cur = JSON.parse(JSON.stringify(MODES.idle));
  let target = MODES.idle, level = 0, levelS = 0, press = 0, pressT = 0, mode = 'idle';

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function init() {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['res','t','lvl','energy','spin','ring','core','press','R','cA','cB','cC'].forEach(k => U[k] = gl.getUniformLocation(prog, k));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  function size() {
    // 2x is already sharper than the eye can tell on a ~50 dp orb; 2.5x drew 56% more pixels per frame.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), hh = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const t0 = performance.now();
  let last = t0, phase = 0;
  /* Battery (0.8.5): the orb used to redraw its shader at the screen's full refresh rate (up to 120 fps)
     for as long as it existed, even sitting idle in a corner or behind another app. Now:
       - listening / thinking / any visible change in progress: full rate;
       - resting (idle, type, paused, settled): IDLE_FPS, woken by setTimeout, so nothing ticks between frames;
       - page hidden, canvas not laid out, or Orb.sleep(true): no frames at all until it is back. */
  const IDLE_FPS = 12;
  // Hosts opt into a still resting orb. Native Everywhere keeps its existing cadence by default.
  let restingMotion = true;
  const LIVE = { listen: 1, command: 1, think: 1, agent: 1, typing: 1, done: 1 };
  let raf = 0, timer = 0, asleep = false, settleUntil = 0, frames = 0;
  const hidden = () => asleep || document.hidden;
  function busy(now) {
    return LIVE[mode] || now < settleUntil || Math.abs(levelS - level) > .002 || Math.abs(press - pressT) > .002;
  }
  function schedule(now) {
    if (raf || timer || hidden()) return;
    if (busy(now)) raf = requestAnimationFrame(frame);
    // The next rAF lands up to one vsync after the timer, so aim a little early to keep ~IDLE_FPS.
    else if (restingMotion) timer = setTimeout(() => { timer = 0; if (!hidden()) raf = requestAnimationFrame(frame); },
      Math.max(0, 1000 / IDLE_FPS - (performance.now() - now) - 8));
  }
  function wake() { settleUntil = performance.now() + 1600; if (timer) { clearTimeout(timer); timer = 0; } schedule(performance.now()); }
  function frame(now) {
    raf = 0;
    if (hidden()) return;
    const dt = Math.min((now - last) / 1000, .1); last = now;
    const k = 1 - Math.pow(.0015, dt);
    for (const key of ['energy','spin','ring','core']) cur[key] = lerp(cur[key], target[key], k);
    for (const key of ['a','b','c']) for (let i = 0; i < 3; i++) cur[key][i] = lerp(cur[key][i], target[key][i], k);
    levelS = lerp(levelS, level, 1 - Math.pow(.00002, dt));
    press = lerp(press, pressT, 1 - Math.pow(.0000001, dt));
    phase += dt * (0.6 + cur.spin);
    // Not laid out (display:none, immersive full screen): skip the GPU work and check again at the resting rate.
    if (gl && prog && canvas.clientWidth > 0) {
      size();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.t, (now - t0) / 1000);
      gl.uniform1f(U.lvl, levelS); gl.uniform1f(U.energy, cur.energy);
      gl.uniform1f(U.spin, cur.spin); gl.uniform1f(U.ring, cur.ring);
      gl.uniform1f(U.core, cur.core); gl.uniform1f(U.press, press); gl.uniform1f(U.R, window.ORB_R || .5);
      gl.uniform3fv(U.cA, cur.a); gl.uniform3fv(U.cB, cur.b); gl.uniform3fv(U.cC, cur.c);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frames++;
    }
    const host = canvas.parentElement;
    host.style.setProperty('--lvl', levelS.toFixed(3));
    host.style.setProperty('--energy', cur.energy.toFixed(3));
    schedule(now);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); wake(); } });
  window.addEventListener('resize', wake);

  let ok = false;
  if (gl) { try { init(); ok = true; } catch (e) { console.warn('orb shader', e); } }
  if (!ok) { canvas.hidden = true; fallback.hidden = false; }
  // A lost WebGL context leaves a blank (sometimes white) canvas on Android: show the PNG orb instead.
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; canvas.hidden = true; fallback.hidden = false; });
  wake();

  window.Orb = {
    webgl: ok,
    setMode(m) {
      mode = m; target = MODES[m] || MODES.idle;
      fallback.src = (m === 'idle' || m === 'type') ? 'robert-thread-orb.png' : 'robert-listening-galaxy.png';
      canvas.parentElement.dataset.mode = m;
      wake();
    },
    get mode() { return mode; },
    setRestingMotion(on) { restingMotion = !!on; wake(); },
    setLevel(v) { const l = Math.max(0, Math.min(1, v)); if (l !== level) { level = l; if (!raf) schedule(performance.now()); } },
    press(on) { pressT = on ? 1 : 0; wake(); },
    /** Native hosts call sleep(true) when the orb's window is off screen or the display is off. */
    sleep(on) { asleep = !!on; if (asleep) { cancelAnimationFrame(raf); raf = 0; clearTimeout(timer); timer = 0; } else { last = performance.now(); wake(); } },
    get frames() { return frames; },
  };
})();
