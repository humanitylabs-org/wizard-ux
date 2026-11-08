// Exact semantic obligations, shared by browser script and sealed acceptance runner.
const matrix=()=>[false,true].flatMap(radial=>[false,true].flatMap(two=>['nebula','grove'].map(skin=>({radial,two,skin,name:`${skin}-radial-${radial}-two-${two}`}))));
function checks(broken=false,diagnostic=false){
  const names=[
    'captured deactivated owner CSS reproduces Apps before restoration',
    'restored real CSS selects Miguel panel, not generic overview',
    ...(broken?['baseline palette switch silently clears persisted active pointer and returns Apps']:['fixed legacy overlay keeps selector and box pointer across palette switch','all original My skin rules preserved byte-for-byte']),
    'saved-state scenario has zero page errors'
  ];
  if(broken)return names;
  for(const enabled of [false,true])for(const two of [false,true]){
    names.push('fresh profile retains current palette, never guessed nebula base');
    if(two)names.push('real two-orbs control saves tweak-only recipe without binding overlay to a palette');
    for(const skin of ['nebula','grove']){
      names.push(`${skin} radial:${enabled} two-orbs:${two}: actual Look -> Miguel selector`,'Miguel pill has opaque shared panel and rounded identity','selector panel pixels unchanged over loud text');
      if(diagnostic)return names;
    }
    names.push('reload reads restored CSS and active pointer from box without reseeding','cache-free reload preserves overlay metadata and actual two-orbs choice',enabled?'long hold remains pins-only radial (no desk wedges)':'OFF long hold remains ordinary voice command','tap remains voice','skin changes and reload perform no hidden owner active writes','only explicit radial and two-orbs recipe PATCHes occur; no other recipe writes or refused routes','explicit leave is durable opt-out; no automatic resurrection','restored profile has zero page errors');
  }
  names.push('no agent runs or new sessions');return names;
}
module.exports={checks,matrix};
