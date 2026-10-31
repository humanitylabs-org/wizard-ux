/* Orb styles for the Orb desktop (layout.js). v7 (Miguel, 31 Oct 2026: "Plasma is my favourite; that quality or higher,
 * not lower"): eight looks, each a small WebGL fragment shader (soft gradients, depth, glow; no flat clip-art), drawn on
 * one shared offscreen GL canvas and copied onto the caller's 2D canvas, so the orb, the picker tiles and the Look
 * button all share one context. Without WebGL the canvas-2D Plasma / Glass / Oracle drawings below stand in.
 *
 * Every frame gets the same inputs: f = { t (seconds), lv (mic level 0..1), state ('idle' | 'listening' | 'thinking' |
 * 'paused'), fl (a "doing it" flash, 1 → 0), cmd (the command state, 0..1), blink, P }. P is the colour:
 * { c: four '#rrggbb', white, core, face }. Every style breathes at rest, swells and stirs with the voice, spins up
 * while sending, tightens into a brighter core inside a ring while it listens for a command, and rings once when one ran.
 *
 * Drawn in-house: the value noise / fBm and every shader here are our own. Ideas (not code) from Teknium's Uncommon Web
 * field guide (webdev.teknium.io): domain-warped fBm nebulae (Paper Shaders' Warp / Mesh gradient) for Plasma and the
 * glass orb's core, Paper Shaders' LiquidMetal for Chrome, and the usual shader-art recipes (limb darkening and a
 * noise corona for Sun, a Doppler-bright lensed accretion disc for Black hole, a banded gas giant with a ring for
 * Planet, sine-turbulence veining with subsurface glow for Marble). Glass and Oracle are the approved concept's own orb
 * (Files › Pages › orb-shell-concept), redrawn as a real lit sphere. */
export const STYLES = Object.freeze([
  ['plasma', 'Plasma'], ['glass', 'Glass'], ['oracle', 'Oracle'], ['chrome', 'Chrome'],
  ['marble', 'Marble'], ['sun', 'Sun'], ['planet', 'Planet'], ['blackhole', 'Black hole'],
]);
// Styles retired in v7 (below Plasma's bar): a device that wore one gets Plasma.
export const RETIRED = Object.freeze(['swarm', 'holo', 'glitch', 'crystal', 'aurora']);
const TAU = Math.PI * 2;
const clamp01 = v => Math.max(0, Math.min(1, v));
/** '#rrggbb' + alpha → '#rrggbbaa' (canvas colour). */
export const A = (hex, a) => hex + Math.round(clamp01(a) * 255).toString(16).padStart(2, '0');
const chans = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) || 0);
const toHex = v => '#' + v.map(n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('');
/** Mix two '#rrggbb' colours (k = share of b). */
export const mix = (a, b, k) => { const x = chans(a), y = chans(b); return toHex(x.map((n, i) => n + (y[i] - n) * k)); };
const spinOf = state => state === 'thinking' ? 3.2 : state === 'listening' ? 1.8 : 1;
// The orb's radius in canvas pixels: breathing, swelling with the voice, a touch tighter in the command state.
const radiusOf = (px, f, k = .3) => px * k * (1 + Math.sin(f.t * 1.3) * .015) * (1 + f.lv * .12 + (f.state === 'listening' ? .05 : 0)) * (1 - (f.cmd || 0) * .12);

/* ---------- shared 2D touches: the listening waves, the command ring, the "doing it" ring ---------- */
function waves(ctx, px, R, f, col) {
  if (f.state !== 'listening' || f.cmd > .5) return;
  const cx = px / 2;
  for (let i = 0; i < 3; i++) {
    const k = (f.t * .9 + i / 3) % 1; ctx.strokeStyle = A(col, (1 - k) * .4); ctx.lineWidth = px * .004;
    ctx.beginPath(); ctx.arc(cx, cx, R * (1.05 + k * .55), 0, TAU); ctx.stroke();
  }
}
// Command: two bright arcs turning round a tight ring, breathing with the voice ("listening for an order").
function cmdRing(ctx, px, R, f) {
  const k = f.cmd || 0; if (k <= .01) return;
  const cx = px / 2, r = R * (1.24 + f.lv * .08), a0 = f.t * 1.7, c = f.P.c;
  ctx.save(); ctx.lineCap = 'round';
  ctx.strokeStyle = A(c[2], .2 * k); ctx.lineWidth = px * .018; ctx.beginPath(); ctx.arc(cx, cx, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = A(f.P.white, .32 * k); ctx.lineWidth = px * .003; ctx.beginPath(); ctx.arc(cx, cx, r, 0, TAU); ctx.stroke();
  ctx.shadowColor = c[2]; ctx.shadowBlur = px * .025; ctx.strokeStyle = A(f.P.white, .95 * k); ctx.lineWidth = px * .008;
  for (const o of [0, Math.PI]) { ctx.beginPath(); ctx.arc(cx, cx, r, a0 + o, a0 + o + Math.PI * (.45 + f.lv * .25)); ctx.stroke(); }
  ctx.restore();
}
function flashRing(ctx, px, R, f) {
  if (!(f.fl > 0)) return;
  const cx = px / 2; ctx.strokeStyle = A(f.P.white, f.fl * .9); ctx.lineWidth = px * .006 * f.fl;
  ctx.beginPath(); ctx.arc(cx, cx, R * (1 + (1 - f.fl) * .9), 0, TAU); ctx.stroke();
}
function overlays(ctx, px, R, f) { waves(ctx, px, R, f, f.P.c[2]); cmdRing(ctx, px, R, f); flashRing(ctx, px, R, f); }

/* ---------- WebGL: one shared context, one program per style, compiled on first use ---------- */
const CAP = 640;   // the shader never renders more than CAP² pixels; the copy scales up (the halo is soft anyway)
const SCALE = { plasma: .5 };   // a soft cloud loses nothing at half resolution, and it is the heaviest
let GL = null;     // null = not tried yet, false = unavailable
function glOf(mk) {
  if (GL !== null) return GL;
  GL = false;
  try {
    const cv = mk(CAP);
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return GL;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    GL = { cv, gl, progs: new Map() };
    cv.addEventListener?.('webglcontextlost', e => { e.preventDefault(); GL = false; });
  } catch (_) { GL = false; }
  return GL;
}
const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
// Shared GLSL: uniforms, our value noise and fBm, the palette ramp, and helpers.
const HEAD = `precision highp float;
uniform vec2 uRes;uniform float uPh,uLv,uFl,uCmd,uR,uCalm;uniform vec3 uC0,uC1,uC2,uC3,uW,uK;
float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
const mat3 RM=mat3(.54,.72,-.43,-.78,.62,.07,.32,.31,.9);
// each octave turned (RM is a rotation) so the value-noise lattice never shows as squares
float fbm(vec3 p){float a=.5,s=0.;p=RM*p;for(int i=0;i<5;i++){s+=a*vn(p);p=RM*p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s/.97;}
float fbm3(vec3 p){float a=.5,s=0.;p=RM*p;for(int i=0;i<3;i++){s+=a*vn(p);p=RM*p*2.07+vec3(4.1,2.3,7.7);a*=.5;}return s/.875;}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 roty(vec3 n,float a){float c=cos(a),s=sin(a);return vec3(n.x*c+n.z*s,n.y,-n.x*s+n.z*c);}
vec3 pal(float x){x=clamp(x,0.,1.)*3.;return x<1.?mix(uC0,uC1,x):x<2.?mix(uC1,uC2,x-1.):mix(uC2,uC3,x-2.);}
vec2 P(){return (gl_FragCoord.xy/uRes)*2.-1.;}
float edge(vec2 p){return smoothstep(1.,.62,length(p));}
float pxl(){return 2./(uRes.x*uR);}
void outp(vec3 c,float a,vec3 g,float ga){a=clamp(a,0.,1.);ga=clamp(ga,0.,1.);gl_FragColor=vec4(c*a+g*ga*(1.-a),a+ga*(1.-a));}
`;
const FRAG = {
  /* Plasma: a living nebula; domain-warped fBm with filaments, a ragged soft edge, a hot heart, no rim. */
  plasma: `vec3 cc(float i){return i<.5?uC0:i<1.5?uC1:i<2.5?uC2:uC3;}
 float ramp(float r){return r<.6?mix(.3,.1,r/.6):r<1.?mix(.1,0.,(r-.6)/.4):0.;}
 vec3 lobes(vec2 s,float t,float sp){vec3 E=vec3(0.);for(int i=0;i<8;i++){float fi=float(i);float a=t*.22*sp*(mod(fi,2.)>.5?1.:-1.)+fi*.9;
  float rr=.13+.08*sin(t*.5+fi*1.7)+uLv*.05;vec2 c=vec2(.5+cos(a)*rr+sin(t*.31+fi)*.04,.5+sin(a*1.21)*rr);float br=.22+.05*sin(t*.8+fi*2.)+uLv*.1;
  E+=cc(mod(fi,4.))*ramp(length(s-c)/br);}
  float m=length(s-.5)/.5;float k=m<.2?1.:m<.55?mix(1.,.9,(m-.2)/.35):m<.8?mix(.9,.4,(m-.55)/.25):m<1.?mix(.4,0.,(m-.8)/.2):0.;return E*k;}
 void main(){vec2 p=P();float d=length(p)/uR;float sp=.8,t=uPh;
 vec2 w=vec2(fbm3(vec3(p*1.5,uPh*.08)),fbm3(vec3(p*1.5+5.2,uPh*.08+1.3)))-.5;float f=fbm(vec3(p*3.+w*1.4,uPh*.12+9.));
 float h=clamp((d-.6)/1.05,0.,1.);vec3 hc=h<.5?mix(uC0*(.5+uLv*.3),uC1*.12,h*2.):mix(uC1*.12,vec3(0.),(h-.5)*2.);float ha=h<.5?mix(.5+uLv*.3,.12,h*2.):mix(.12,0.,(h-.5)*2.);
 vec3 E=hc*.55;float A=ha*.55;
 float D=.98+uLv*.1;vec3 L=lobes((p+w*.06)/D*.5+.5,t,sp)+lobes(rot(-t*.12*sp)*(p+w*.05)/(D*.7)*.5+.5,t,sp)*.45;
 L*=.8+.4*f;E=min(E+L,vec3(1.));A=max(A,max(E.r,max(E.g,E.b)));
 float hr=d/(.3+uLv*.2+uCmd*.1);float ht=hr<1.?(1.-hr)*(.16+uLv*.3+uCmd*.4):0.;E=E*(1.-ht)+uW*ht;A=A+ht*(1.-A);
 gl_FragColor=vec4(E,clamp(A,0.,1.));}`,
  /* Glass (and Oracle, calmer): a lit glass sphere; a refracted warped nebula inside, Fresnel rim, two highlights. */
  glass: `void main(){vec2 p=P();vec2 q=p/uR;float d=length(q);float aa=pxl()*1.2;
 float ins=1.-smoothstep(1.-aa,1.+aa,d);float z=sqrt(max(0.,1.-d*d));vec3 N=vec3(q,z);
 vec2 uv=rot(uPh*.2*uCalm)*(q*(1.45-.55*z));vec3 s=vec3(uv*1.1,uPh*.13*uCalm);
 vec2 w=vec2(fbm(s),fbm(s+vec3(3.3,7.1,1.9)));float n=fbm(vec3(uv*1.6+(w-.5)*(2.2+uLv*1.6)*uCalm,uPh*.09+4.));
 vec3 in1=mix(uK,uC0,smoothstep(.15,.65,n));in1=mix(in1,uC1,smoothstep(.45,.85,w.x)*.85);in1=mix(in1,uC2,smoothstep(.6,.92,n)*.75);
 in1*=.35+.85*z;in1+=uW*exp(-d*d*(5.-uLv*2.+uCmd*7.))*(.18+uLv*.45+uCmd*.65);
 float fr=pow(1.-z,2.4);vec3 col=in1+mix(uC2,uW,.4)*fr*.8;
 vec3 H=normalize(normalize(vec3(-.45,.55,.7))+vec3(0,0,1));float sh=max(dot(N,H),0.);
 col+=uW*(pow(sh,70.)*1.1+pow(sh,9.)*.07);col+=uC1*pow(max(dot(N,normalize(vec3(.55,-.6,.35))),0.),5.)*.35;
 col+=uC3*smoothstep(aa*3.,0.,abs(d-1.+aa*1.5))*.35;
 float g=exp(-max(d-1.,0.)*3.)*(.42+uLv*.4)*edge(p);outp(col,ins,mix(uC0,uC1,.35),g);}`,
  /* Chrome: liquid metal; a wobbling blob whose rippled normal reflects a banded studio sky with a coloured sheen. */
  chrome: `vec3 env(vec3 r){float y=r.y*.9+(fbm3(r*1.1+vec3(0.,0.,uPh*.1))-.5)*.45;float b=.5+.5*sin(y*7.+uPh*.2)*.75+.25*sin(y*13.-r.x*2.+uPh*.3);
 vec3 c=mix(uK*.4+uC0*.18,mix(uC1,uW,.35),smoothstep(.25,.95,b));c+=uW*pow(b,30.)*1.2;c+=uC2*pow(1.-b,6.)*.25;
 return c;}
 void main(){vec2 p=P();vec2 q=p/uR;float d=length(q)+1e-4;vec2 dir=q/d;
 float wob=(fbm3(vec3(dir*1.2,uPh*.25))-.5)*(.16+uLv*.38)*(1.-uCmd*.6);float rad=1.+wob;float d2=d/rad;float aa=pxl()*1.2;
 float ins=1.-smoothstep(1.-aa,1.+aa,d2);float z=sqrt(max(0.,1.-d2*d2));
 vec2 rip=vec2(fbm3(vec3(q*1.1,uPh*.18)),fbm3(vec3(q*1.1+5.,uPh*.18)))-.5;
 vec3 N=normalize(vec3(q/rad+rip*(1.1+uLv*.7)*(.3+z*.7),z*1.15));vec3 r=reflect(vec3(0,0,-1),N);
 vec3 col=vec3(env(r+vec3(.06,.03,0)).r,env(r).g,env(r-vec3(.06,.03,0)).b);
 float fr=pow(1.-N.z,2.5);col=mix(col,pal(.55+.45*r.y),fr*.55);col*=.65+.45*N.z;col+=mix(uC2,uW,.5)*fr*.3;
 col+=uW*exp(-d*d*(6.+uCmd*6.))*(uLv*.3+uCmd*.45);
 float g=exp(-max(d2-1.,0.)*3.2)*(.3+uLv*.35)*edge(p);outp(col,ins,mix(uC1,uC2,.4),g);}`,
  /* Marble: polished stone; sine-turbulence veins (deep accent and a fine gold), clouded body, gloss, light glowing
   * through the stone (strongest at the rim and with the voice). */
  marble: `void main(){vec2 p=P();vec2 q=p/uR;float d=length(q);float aa=pxl()*1.2;float ins=1.-smoothstep(1.-aa,1.+aa,d);
 float z=sqrt(max(0.,1.-d*d));vec3 N=vec3(q,z);vec3 M=roty(N,uPh*.05);
 vec3 wq=M*vec3(1.,1.6,1.)+vec3(fbm3(M*1.2+3.),fbm3(M*1.2+8.),fbm3(M*1.2+13.))*1.2;
 float r1=1.-abs(2.*fbm(wq*1.5)-1.);float r2=1.-abs(2.*fbm3(wq*3.6+4.)-1.);
 float big=pow(r1,14.),haze=pow(r1,4.),fine=pow(r2,22.);
 float cl=fbm(M*2.4+11.);vec3 base=mix(mix(uW,uC2,.1),mix(uW,uC1,.24),smoothstep(.35,.8,cl));base*=.94+.08*fbm3(M*10.);
 vec3 vc=mix(mix(uC0,uK,.4),vec3(.45),.3);
 vec3 col=mix(base,mix(base,vc,.55),haze*.45);col=mix(col,vc,big*.8);col=mix(col,mix(vc,base,.35),fine*.3);
 vec3 L=normalize(vec3(-.5,.55,.68));float df=clamp((dot(N,L)+.45)/1.45,0.,1.);
 col*=.4+.7*df;float sh=max(dot(N,normalize(L+vec3(0,0,1))),0.);col+=uW*(pow(sh,110.)*.95+pow(sh,16.)*.1);
 float glow=.1+uLv*.55+uCmd*.5;col+=uC1*(exp(-d*d*2.4)*glow+pow(1.-z,2.)*(.35+uLv*.3)*(1.-df*.5))*(1.-big*.6);
 float g=exp(-max(d-1.,0.)*3.3)*(.3+uLv*.45)*edge(p);outp(col,ins,mix(uC1,uW,.25),g);}`,
  /* Sun: a turning star; granulated boiling surface with limb darkening, and a streaming noise corona. */
  sun: `void main(){vec2 p=P();vec2 q=p/uR;float d=length(q)+1e-4;float aa=pxl()*1.2;float ins=1.-smoothstep(1.-aa,1.+aa,d);
 float z=sqrt(max(0.,1.-d*d));vec3 N=roty(vec3(q,z),uPh*.07);
 float g1=fbm(N*3.2+vec3(0,0,uPh*.2));float g2=fbm3(N*9.+g1*2.3-uPh*.12);
 float heat=.42+(g2-.5)*1.1+(g1-.5)*.7+uLv*.2+uCmd*.15;
 vec3 hot=mix(uC3,uW,.55);vec3 col=mix(uC0*.7,uC1,smoothstep(.0,.45,heat));col=mix(col,hot,smoothstep(.4,.85,heat));col=mix(col,uW,smoothstep(.8,1.1,heat)*.8);
 col*=.45+.75*pow(z,.5);col+=uW*exp(-d*d*(5.+uCmd*6.))*(.15+uCmd*.4);
 vec2 dir=q/d;float rays=fbm(vec3(dir*2.4,d*1.5-uPh*.38))*.8+fbm3(vec3(dir*6.,d*2.-uPh*.6))*.5;
 float cor=exp(-max(d-1.,0.)*(3.4-uLv*1.2))*(.35+rays*.9)*(1.+uLv*.6)*edge(p);
 vec3 cc=mix(uC1,mix(uC3,uW,.35),smoothstep(1.5,1.,d));outp(col,ins,cc,cor);}`,
  /* Planet: a banded gas giant lit from one side, a scattering atmosphere, a storm, and a fine ring passing in front. */
  planet: `void main(){vec2 p=P();vec2 q0=rot(-.36)*p/uR;float pr=.74;vec2 q=q0/pr;float d=length(q);float aa=pxl()/pr*1.2;
 float ins=1.-smoothstep(1.-aa,1.+aa,d);float z=sqrt(max(0.,1.-d*d));vec3 N=vec3(q,z);vec3 M=roty(N,uPh*.09);
 float wv=fbm(vec3(M.x*2.,M.y*9.,M.z*2.)+3.);float b=M.y*5.5+(wv-.5)*2.2;float t=.5+.5*sin(b*2.);
 vec3 col=mix(uC0,uC2,t);col=mix(col,uC3,smoothstep(.55,.9,fbm3(vec3(M.x*3.,M.y*14.,M.z*3.)))*.45);
 vec2 sd=M.xy-vec2(.25,-.28);float storm=exp(-dot(sd,sd)*28.)*step(0.,M.z);col=mix(col,mix(uC1,uW,.3),storm*.8);
 vec3 L=normalize(vec3(-.62,.38,.68));float lit=smoothstep(-.2,.65,dot(N,L));col*=.05+1.05*lit;
 col+=mix(uC1,uW,.25)*pow(1.-z,2.2)*(.55*lit+.08)*(1.+uLv*.6);col+=uW*exp(-d*d*4.)*(uLv*.2+uCmd*.35);
 vec2 e=vec2(q0.x,q0.y/.24);float rr=length(e)/pr;
 float band=smoothstep(1.32,1.38,rr)*smoothstep(2.12,2.02,rr)*(1.-smoothstep(1.62,1.66,rr)*smoothstep(1.71,1.67,rr)*.85);
 float rt=.55+.45*sin(rr*70.)*sin(rr*23.+1.)+(fbm3(vec3(rr*18.,0.,1.))-.5)*.5;
 float rl=.35+.75*smoothstep(-1.2,1.,-e.x/max(rr,1e-3)*.4+.6);vec3 rc=mix(uC2,uW,.35)*rl*(.75+uLv*.4);
 float ra=band*clamp(rt,0.,1.)*.85;float back=step(0.,q0.y);ra*=1.-back*ins;
 float a=ins+ra*(1.-ins);vec3 c=(col*ins*(1.-ra)+rc*ra)/max(a,1e-3);
 float g=exp(-max(d-1.,0.)*4.)*(.3+uLv*.35)*edge(p);outp(c,a,mix(uC1,uC2,.5),g);}`,
  /* Black hole: a dark horizon ringed by a thin photon ring, its swirling accretion disc (bright on the side coming
   * towards us) passing in front, and the far side of the disc lensed up over the top. */
  blackhole: `void main(){vec2 p=P();vec2 q=rot(.16)*p/uR;float rc=length(q)+1e-4;float rh=.4+uLv*.03-uCmd*.04;float aa=pxl()*1.2;
 vec2 e=vec2(q.x,q.y/.27);float rr=length(e)+1e-4;float sw=uPh*.55;
 vec2 er=rot(sw*(.85/rr))*e;float st=fbm(vec3(er*1.6,rr*4.))*.7+fbm3(vec3(er*4.,rr*9.))*.5;
 float disc=smoothstep(.55,.72,rr)*smoothstep(1.62,1.05,rr);float beam=1.+.75*(-e.x/rr);
 float heat=clamp(1.25-rr*.75,0.,1.);vec3 dc=mix(uC0,mix(uC3,uW,.5),heat);dc=mix(dc,uW,heat*heat*.6);
 float da=disc*clamp(st*1.25,0.,1.)*beam*(.75+uLv*.5);
 vec2 lr=rot(sw*1.2/rc)*q;float lens=exp(-pow((rc-.6)/.15,2.))*(.25+.85*smoothstep(-.4,.8,q.y/rc))*(.5+.9*fbm3(vec3(lr*3.,rc*6.)))*(1.+uLv*.6)*(1.+.5*(-q.x/rc));
 float hor=1.-smoothstep(rh-aa,rh+aa,rc);float ring=exp(-pow((rc-rh*1.12)/(.018+uLv*.01),2.))*(1.1+uCmd*.6);
 float g=exp(-max(rc-.5,0.)*2.6)*(.28+uLv*.3)*edge(p);vec3 gc=mix(uC0,uC1,.5);
 float back=step(0.,q.y);vec3 c=gc;float a=0.;float x;
 x=clamp(da*back,0.,1.);c=mix(c,dc,x);a=max(a,x);
 x=clamp(lens,0.,1.);c=mix(c,mix(mix(uC3,uC2,.5),uW,.35),x);a=max(a,x);
 c=mix(c,vec3(0.),hor);a=max(a,hor);
 x=clamp(ring,0.,1.);c=mix(c,mix(uC3,uW,.6),x);a=max(a,x);
 x=clamp(da*(1.-back),0.,1.);c=mix(c,dc,x);a=max(a,x);
 outp(c,a,gc,g);}`,
};
FRAG.oracle = FRAG.glass;
const UNI = ['uRes', 'uPh', 'uLv', 'uFl', 'uCmd', 'uR', 'uCalm', 'uC0', 'uC1', 'uC2', 'uC3', 'uW', 'uK'];
function program(G, style) {
  if (G.progs.has(style)) return G.progs.get(style);
  const gl = G.gl, sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(m || 'shader'); } return s; };
  let p = null;
  try {
    p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, HEAD + FRAG[style]));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  } catch (e) { try { console.warn('[orb] shader', style, e.message); } catch (_) {} p = null; }
  const rec = p ? { p, u: Object.fromEntries(UNI.map(n => [n, gl.getUniformLocation(p, n)])) } : null;
  G.progs.set(style, rec); return rec;
}
const rgb01 = hex => chans(hex).map(v => v / 255);
/** A shader style: draws f into ctx (px × px); false when WebGL can't. */
function shaded(style, mk) {
  let ph = 0, last = -1, q = 1, cost = 0;   // q: resolution this device affords (a slow GPU steps it down, never below 40%)
  return (ctx, px, f) => {
    const G = glOf(mk); if (!G) return false;
    const rec = program(G, style); if (!rec) return false;
    const t0 = performance.now(), gl = G.gl, n = Math.max(8, Math.min(CAP, Math.round(px * (SCALE[style] || 1) * q)));
    const dt = last >= 0 && f.t > last ? Math.min(.1, f.t - last) : 0; last = f.t;
    if (!ph) ph = f.t % 1000;   // the first frame (and a reduced-motion still) starts mid-motion, never at zero
    ph += dt * spinOf(f.state) * (f.state === 'paused' ? .3 : 1);
    const R = radiusOf(n, f) / (n / 2), c = f.P.c, u = rec.u;
    gl.viewport(0, 0, n, n); gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(rec.p);
    gl.uniform2f(u.uRes, n, n); gl.uniform1f(u.uPh, ph); gl.uniform1f(u.uLv, f.lv || 0); gl.uniform1f(u.uFl, f.fl || 0);
    gl.uniform1f(u.uCmd, f.cmd || 0); gl.uniform1f(u.uR, R); gl.uniform1f(u.uCalm, style === 'oracle' ? .55 : 1);
    ['uC0', 'uC1', 'uC2', 'uC3'].forEach((k, i) => gl.uniform3fv(u[k], rgb01(c[i])));
    gl.uniform3fv(u.uW, rgb01(f.P.white)); gl.uniform3fv(u.uK, rgb01(f.P.core));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.clearRect(0, 0, px, px); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(G.cv, 0, G.cv.height - n, n, n, 0, 0, px, px);
    // the copy waits for the GPU, so this is the frame's real cost: keep the big orb under ~12 ms
    if (px > 200) { cost = cost ? cost * .8 + (performance.now() - t0) * .2 : performance.now() - t0; if (cost > 12 && q > .4) { q = Math.max(.4, q * .8); cost = 0; } else if (cost < 4 && q < 1) q = Math.min(1, q * 1.05); }
    return true;
  };
}

/* ---------- canvas-2D stand-ins (no WebGL): the v6 Plasma cloud and the concept's glass orb ---------- */
function halo(ctx, px, R, P, lv, k = 1) {
  const c = P.c, cx = px / 2, g = ctx.createRadialGradient(cx, cx, R * .6, cx, cx, R * 1.65);
  g.addColorStop(0, A(c[0], (.5 + lv * .3) * k)); g.addColorStop(.5, A(c[1], .12 * k)); g.addColorStop(1, A(c[1], 0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, px, px);
}
function glass2d(ctx, px, f, R, calm = 1) {
  const { t, lv, state, P } = f, c = P.c, cx = px / 2, cy = px / 2;
  ctx.clearRect(0, 0, px, px); halo(ctx, px, R, P, lv, calm < 1 ? .8 : 1);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
  const base = ctx.createRadialGradient(cx, cy - R * .3, R * .1, cx, cy, R);
  base.addColorStop(0, A(c[0], .55)); base.addColorStop(1, P.core); ctx.fillStyle = base; ctx.fillRect(0, 0, px, px);
  ctx.globalCompositeOperation = 'screen';
  const spin = spinOf(state) * calm, swirls = calm < 1 ? 3 : 5;
  for (let i = 0; i < swirls; i++) {
    const a = t * .35 * spin * (i % 2 ? 1 : -1.2) + i * 1.26, rr = R * (.38 + .12 * Math.sin(t * .7 + i));
    const bx = cx + Math.cos(a) * rr, by = cy + Math.sin(a * 1.3) * rr * .8, br = R * (.55 + .1 * Math.sin(t + i * 2) + lv * .2);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br); g.addColorStop(0, A(c[i % 4], .75)); g.addColorStop(1, A(c[i % 4], 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const hl = ctx.createRadialGradient(cx - R * .35, cy - R * .45, 0, cx - R * .35, cy - R * .45, R * .7);
  hl.addColorStop(0, A(P.white, .28)); hl.addColorStop(1, A(P.white, 0)); ctx.fillStyle = hl; ctx.fillRect(0, 0, px, px);
  ctx.restore();
  ctx.strokeStyle = A(c[3], .35 + lv * .3); ctx.lineWidth = px * .004; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
}
function plasma2d(mk) {
  const S = 96; let off = null, o = null;
  return (ctx, px, f) => {
    if (!off) { off = mk(S); o = off.getContext('2d'); }
    const { t, lv, state, P } = f, c = P.c, sp = spinOf(state) * .8, R = radiusOf(px, f);
    o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, S, S); o.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const a = t * .22 * sp * (i % 2 ? 1 : -1) + i * .9, rr = S * (.13 + .08 * Math.sin(t * .5 + i * 1.7) + lv * .05);
      const x = S / 2 + Math.cos(a) * rr + Math.sin(t * .31 + i) * S * .04, y = S / 2 + Math.sin(a * 1.21) * rr, br = S * (.22 + .05 * Math.sin(t * .8 + i * 2) + lv * .1);
      const g = o.createRadialGradient(x, y, 0, x, y, br); g.addColorStop(0, A(c[i % 4], .3)); g.addColorStop(.6, A(c[i % 4], .1)); g.addColorStop(1, A(c[i % 4], 0));
      o.fillStyle = g; o.fillRect(0, 0, S, S);
    }
    o.globalCompositeOperation = 'destination-in';
    const m = o.createRadialGradient(S / 2, S / 2, S * .1, S / 2, S / 2, S * .5);
    m.addColorStop(0, A(P.white, 1)); m.addColorStop(.55, A(P.white, .9)); m.addColorStop(.8, A(P.white, .4)); m.addColorStop(1, A(P.white, 0));
    o.fillStyle = m; o.fillRect(0, 0, S, S);
    ctx.clearRect(0, 0, px, px); halo(ctx, px, R, P, lv, .55);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const D = px * (.98 + lv * .1) * (1 + Math.sin(t * 1.3) * .02);
    ctx.drawImage(off, (px - D) / 2, (px - D) / 2, D, D);
    ctx.translate(px / 2, px / 2); ctx.rotate(t * .12 * sp); ctx.globalAlpha = .45; const D2 = D * .7;
    ctx.drawImage(off, -D2 / 2, -D2 / 2, D2, D2);
    ctx.restore();
    const h = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, R * (.3 + lv * .2));
    h.addColorStop(0, A(P.white, .16 + lv * .3 + (f.cmd || 0) * .4)); h.addColorStop(1, A(P.white, 0)); ctx.fillStyle = h; ctx.fillRect(0, 0, px, px);
  };
}

/* ---------- Oracle's face: calm eyes that blink, a mouth that follows the voice (drawn over the glass) ---------- */
function face(ctx, px, R, f) {
  const { t, lv, state, blink, P } = f, cx = px / 2, cy = px / 2;
  const veil = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); veil.addColorStop(0, A(P.core, .3)); veil.addColorStop(1, A(P.core, 0));
  ctx.fillStyle = veil; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
  ctx.save(); ctx.strokeStyle = A(P.face, .92); ctx.lineCap = 'round'; ctx.lineWidth = px * .009; ctx.shadowColor = P.face; ctx.shadowBlur = px * .03;
  const ey = cy - R * .12, ex = R * .3, open = blink ? .02 : (state === 'listening' ? .16 : .1);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * ex, ey, R * .13, R * open, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }
  const mo = state === 'listening' ? R * (.02 + .08 * lv) : state === 'thinking' ? R * (.03 + .03 * Math.abs(Math.sin(t * 6))) : R * .012;
  ctx.beginPath(); ctx.ellipse(cx, cy + R * .32, R * .16, mo, 0, 0, TAU); ctx.stroke();
  ctx.restore();
}

/** The drawing for a style: (ctx, px, f) → one frame on a px × px canvas. A retired style draws Plasma. */
export function renderer(style, mk) {
  const id = STYLES.some(s => s[0] === style) ? style : RETIRED.includes(style) ? 'plasma' : 'glass';
  const gl = shaded(id, mk), soft = ['plasma', 'sun', 'blackhole'].includes(id) ? plasma2d(mk) : null;
  return (ctx, px, f) => {
    const R = radiusOf(px, f);
    if (!gl(ctx, px, f)) { if (soft) soft(ctx, px, f); else glass2d(ctx, px, f, R, id === 'oracle' ? .6 : 1); }
    if (id === 'oracle') face(ctx, px, R, f);
    overlays(ctx, px, R, f);
  };
}
/** Whether the shader path is live (QA). */
export const webgl = mk => !!glOf(mk);
