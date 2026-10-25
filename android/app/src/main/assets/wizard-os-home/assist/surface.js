/* Wizard over the lock screen — native surface (Wizard Lock test build).
   Motion: shared Wizard Motion Kit v1 (words, card, hint, spread, haptics, tones) + the Live Mode canvas orb.
   Native bridge: window.WizardNative (send, cancel, listen, unlock, items, openWizard, close, log, corner, full).
   Shapes: 'full' over the lock screen; 'corner' (unlocked) = only the orb, bottom-right. */
const M = window.WizardMotion, N = window.WizardNative || {
  send(){}, cancel(){}, pause(){}, listen(){}, unlock(){}, items(){return '[]'}, openWizard(){}, close(){}, log(){}, locked(){return true}};
const $ = id => document.getElementById(id);
const hint = M.hint($('hint')), card = M.card($('card'), $('layer'));
const S = { state:'idle', locked:true, level:0, heard:'', ms:0 };
window.__wl = S;

/* ---------- canvas orb (Live Mode) ---------- */
const C=$('c'),X=C.getContext('2d');let Wd,Ht,D=1;
function rs(){D=Math.min(devicePixelRatio||1,2);Wd=innerWidth;Ht=innerHeight;C.width=Wd*D;C.height=Ht*D}
rs();addEventListener('resize',rs);
let P=[],mode='calm',glow=.6,ripples=[],lv=0;
for(let i=0;i<110;i++)P.push({x:Math.random(),y:Math.random(),vx:(Math.random()-.5)*.0006,vy:(Math.random()-.5)*.0006,s:Math.random()*1.6+.3});
let MODE='full';
const orbXY=()=>MODE==='corner'?({x:Wd-66,y:Ht/2}):({x:Wd/2,y:Ht*.40});
/* The orb's look follows the conversation, exactly like the app's dock orb. */
const O=window.Orb||{setMode(){},setLevel(){}};
function orbMode(m){O.setMode(m);document.body.classList.toggle('paused',m==='paused')}
function draw(t){
  X.setTransform(D,0,0,D,0,0);X.clearRect(0,0,Wd,Ht);
  const {x:ox,y:oy}=orbXY(),breathe=Math.sin(t/1400)*.5+.5;
  if(MODE==='corner'){drawCorner(t,ox,oy,breathe);requestAnimationFrame(draw);return}
  for(const p of P){
    if(mode==='gather'){p.vx+=(.5-p.x)*.00009;p.vy+=(.40-p.y)*.00009;p.vx*=.96;p.vy*=.96}
    else if(mode!=='burst'){p.vx+=(Math.random()-.5)*.00003;p.vy+=(Math.random()-.5)*.00003;p.vx*=.995;p.vy*=.995}
    p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x+=1;if(p.x>1)p.x-=1;if(p.y<0)p.y+=1;if(p.y>1)p.y-=1;
    X.fillStyle=`rgba(185,168,255,${.12+.32*breathe*p.s/2})`;X.beginPath();X.arc(p.x*Wd,p.y*Ht,p.s,0,7);X.fill()}
  ripples=ripples.filter(rp=>{rp.r+=4;rp.a*=.955;X.strokeStyle=`rgba(${rp.c||'185,168,255'},${rp.a})`;X.lineWidth=2;X.beginPath();X.arc(ox,oy,rp.r,0,7);X.stroke();return rp.a>.02});
  requestAnimationFrame(draw)}
/* Corner orb: same orb, smaller; the waveform becomes a ring that breathes with your voice. */
function drawCorner(t,ox,oy,breathe){
  ripples=ripples.filter(rp=>{rp.r+=2.4;rp.a*=.94;X.strokeStyle=`rgba(${rp.c||'185,168,255'},${rp.a})`;X.lineWidth=2;X.beginPath();X.arc(ox,oy,rp.r,0,7);X.stroke();return rp.a>.03&&rp.r<64});
}
requestAnimationFrame(draw);
const words = M.words($('words'), { anchor: orbXY, lanes:[.56,.61,.66,.71], max:5 });

/* ---------- helpers ---------- */
let idleTimer=0;
function idleClose(ms){clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(S.state==='card'||S.state==='idle')N.close()},ms)}
function setTop(t){$('top').textContent=t||'';$('top').classList.toggle('on',!!t)}
function chips(on){['unlockC','cancelC','pauseC','shotC'].forEach(id=>$(id).classList.toggle('on',on));if(!on)shotBadge(0);$('unlockC').style.display=S.locked?'':'none';
  if(inCorner())N.corner&&N.corner(on)}
function setCard(k,m,s,acts,cls){
  $('k').textContent=k;$('m').textContent=m;$('s').textContent=s||'';
  $('card').classList.toggle('err',cls==='err');
  const a=$('acts');a.innerHTML='';
  (acts||[]).forEach(([label,fn,ghost])=>{const b=document.createElement('button');b.textContent=label;if(ghost)b.className='ghost';
    b.addEventListener('click',e=>{e.stopPropagation();fn()});a.appendChild(b)});
  card.rise();
}

let bubT=0;
function bubble(k,t,cls,wide=true){
  clearTimeout(bubT);$('bubK').textContent=k;$('bubT').textContent=t;$('bub').classList.toggle('err',cls==='err');
  N.corner&&N.corner(wide);setTimeout(()=>$('bub').classList.add('on'),60);
}
function bubbleOff(){$('bub').classList.remove('on');clearTimeout(bubT);bubT=setTimeout(()=>{if(MODE==='corner'&&S.state!=='card')N.corner&&N.corner(false)},300)}
const inCorner=()=>MODE==='corner';
function shotBadge(n){$('shotN').textContent=n>0?String(n):'';$('shotC').classList.toggle('has',n>0);
  $('shotC').setAttribute('aria-label',n>0?n+(n===1?' screenshot':' screenshots')+' attached':'Attach a screenshot')}

/* ---------- called by native ---------- */
const W = window.W = {
  setMode(m){
    MODE=m==='corner'?'corner':'full';
    document.body.classList.toggle('corner',MODE==='corner');document.documentElement.classList.toggle('corner',MODE==='corner');
    window.ORB_R=MODE==='corner'?.62:.32;
    document.body.classList.toggle('canshot',MODE==='corner'&&typeof N.shot==='function');
    document.documentElement.style.background=document.body.style.background=MODE==='corner'?'transparent':'#000';
    rs();
  },
  begin(){
    clearTimeout(idleTimer);
    if(inCorner()){$('bub').classList.remove('on');N.corner&&N.corner(false)}
    if(card.open)card.sink();$('zl').classList.remove('on','deep');
    S.state='listen';S.heard='';S.paused=false;mode='calm';glow=.9;ripples.push({r:18,a:.5});
    orbMode('listen');
    M.haptic('press');M.chime([523,.9,.07]);
    setTop('listening');chips(true);
    hint.show('talk · tap the orb or stop talking to send','listen',0,true);
  },
  level(v){S.level=+v||0;O.setLevel(S.paused?0:Math.min(1,S.level*1.4))},
  onPaused(p){S.paused=!!p;orbMode(p?'paused':'listen');setTop(p?'paused':'listening');
    hint.show(p?'paused · tap the orb to carry on':'talk · tap the orb or stop talking to send','listen',0,true)},
  onSending(via){
    S.state='think';mode='gather';glow=1;chips(false);setTop('');S.paused=false;
    orbMode('think');O.setLevel(0);
    // 0.8.6: sending IS the confirmation (it is saved on the phone first). One "sent" tick and the orb leaves.
    M.haptic('sent');M.chime('sent');ripples.push({r:16,a:.7,c:'79,240,176'});
    if(inCorner())return;
    hint.show('sending to Wizard…','send',0,true);
  },
  /* The words are back: show them while they go on to Wizard. No confirm — talking is sending. */
  onHeard(text,ms){
    S.heard=text;S.ms=ms;
    if(inCorner())return;
    text.split(/\s+/).slice(0,10).forEach((w,i)=>setTimeout(()=>words.add(w),i*110));
    hint.show('sending to Wizard…','send',0,true);
  },
  onDelivered(){
    S.state='card';mode='calm';glow=.5;orbMode('done');setTimeout(()=>orbMode('idle'),1600);
    ripples.push({r:16,a:.7,c:'79,240,176'});M.chime('sent');M.haptic('sent');
    const t=S.heard||'Your voice note';
    if(inCorner()){bubble('Sent to Wizard · tap to open',t);idleClose(6000);return}
    words.hot('✓');words.gather();
    setTimeout(()=>{
      setCard('Sent to Wizard','“'+t+'”',S.locked?'the reply waits in Wizard OS':'',
        [['Talk again',()=>N.listen()],['Open thread',()=>W.openWizard(),true]]);
      hint.show(S.locked?'back to the lock screen · or talk again':'tap Open thread to see the reply','card',0,true);
      idleClose(9000);
    },700);
  },
  /* Wizard isn't answering yet: it is saved on the phone and keeps retrying by itself. */
  onQueued(why){
    S.state='card';mode='calm';glow=.45;orbMode('idle');M.haptic('notice');
    const t=S.heard||'Your voice note';
    if(inCorner()){bubble('Saved · sending when Wizard is back',t);idleClose(7000);return}
    setCard('Saved on your phone','“'+t+'”',(why?why+' · ':'')+'it sends by itself when Wizard is back',
      [['Talk again',()=>N.listen()]]);
    hint.show('nothing is lost · back to the lock screen','card',0,true);idleClose(9000);
  },
  onNothing(){
    S.state='idle';mode='calm';glow=.5;chips(false);setTop('');orbMode('idle');O.setLevel(0);
    if(inCorner()){bubble('Didn’t catch that','hold the side button to try again','err');idleClose(2800);return}
    hint.show('didn’t catch that · hold the side button to try again','none',0,true);idleClose(3500);
  },
  onError(kind,msg){
    S.state='card';mode='calm';glow=.4;chips(false);setTop('');M.haptic('error');orbMode('idle');
    if(inCorner()){bubble(kind==='mic'?'Microphone':'Couldn’t send',msg,'err');idleClose(6000);return}
    setCard(kind==='mic'?'Microphone':'Couldn’t send', msg, '',
      [['Try again',()=>N.listen()]],'err');
    hint.show('back to the lock screen','err',0,true);idleClose(10000);
  },
  lockState(locked){S.locked=!!locked;$('lock').textContent=locked?'🔒 locked':'unlocked';
    if(S.state==='listen')chips(true)},
  onUnlocked(){
    if(!S.locked&&inCorner())return;
    S.locked=false;$('lock').textContent='unlocked';$('unlockC').style.display='none';
    M.chime('open');
    if(W._after){const f=W._after;W._after=null;f();return}
    // Unlocked mid-talk: shrink to the corner orb and keep listening; the phone is yours again.
    if(card.open)card.sink();
    if(S.state==='card'&&S.heard){N.corner&&N.corner(true);setTimeout(()=>bubble('Heard you · tap to open',S.heard),80);idleClose(7000)}
    else N.corner&&N.corner(false);
  },
  /* Screen result from native: n>0 attached (count), -1 the screen refused capture, -2 four already, -3 needs Android 11. */
  onShot(n){
    if(n>0){shotBadge(n);M.haptic('press');$('shotC').classList.add('flash');setTimeout(()=>$('shotC').classList.remove('flash'),260);N.log&&N.log('shot attached '+n);return}
    M.haptic('error');N.log&&N.log('shot failed '+n);
  },
  reset(){clearTimeout(idleTimer);$('bub').classList.remove('on');if(card.open)card.sink();S.state='idle';S.heard='';S.paused=false;setTop('');chips(false);orbMode('idle')},
  onUnlockCancelled(){W._after=null;if(S.state==='listen')hint.show('still locked · still listening','unlock',2200,true)},
  openWizard(){N.openWizard(S.heard||'')},
  showList(){
    if(S.locked){W._after=W.showList;N.unlock();return}
    let items=[];try{items=JSON.parse(N.items()||'[]')}catch(e){}
    const fmt=t=>new Date(t).toLocaleString([], {weekday:'short',hour:'2-digit',minute:'2-digit'});
    $('zlist').innerHTML=items.length?items.slice(0,12).map(i=>`<div class="wm-zi"><div class="t"></div><small></small></div>`).join(''):'<div class="empty">Nothing yet. Hold the side button and talk.</div>';
    [...$('zlist').children].forEach((el,i)=>{if(!items[i])return;el.querySelector('.t').textContent=items[i].text;el.querySelector('small').textContent=fmt(items[i].at)});
    if(card.open)card.sink();
    N.full&&N.full();
    clearTimeout(idleTimer);S.state='list';$('zl').classList.add('on');M.chime('open');
    hint.show('spread again for times · back closes','list',0,true);
  },
  back(){
    // Back only steps out of the private list. Otherwise it is ignored: talking, sending and the card stay put,
    // and the X is the only cancel (James, 10 Oct 2026).
    if(S.state==='list'){$('zl').classList.remove('on','deep');S.state=card.open?'card':'idle';
      if(S.state==='idle')idleClose(6000);return 'handled'}
    return '';
  },
};

/* ---------- gestures ---------- */
$('orbHit').addEventListener('click',()=>{if(S.state==='listen'&&S.paused){N.pause()}else if(S.state==='listen'){N.send()}else if(inCorner()&&S.state!=='think'){N.listen()}});
$('bub').addEventListener('click',e=>{e.stopPropagation();if(S.state==='card')W.openWizard();else if(S.state!=='think')N.close()});
$('cancelC').addEventListener('click',e=>{e.stopPropagation();N.cancel();W.onNothing();hint.show('cancelled','c',0,true)});
$('pauseC').addEventListener('click',e=>{e.stopPropagation();N.pause&&N.pause()});
$('unlockC').addEventListener('click',e=>{e.stopPropagation();N.unlock()});
$('shotC').addEventListener('click',e=>{e.stopPropagation();if(S.state==='listen'&&N.shot)N.shot()});
M.spread(document.body,{onOut(){ if(inCorner())return; if(S.state==='list'){$('zl').classList.add('deep');return} if(S.state!=='listen'&&S.state!=='think')W.showList() },
  onIn(){ if(S.state==='list')W.back() }});
document.addEventListener('pointerdown',()=>{M.sound.unlock()},{capture:true});
hint.show('hold the side button and talk','start',0,true);
if(location.hash==='#corner')W.setMode('corner'); // browser preview of the corner shape
