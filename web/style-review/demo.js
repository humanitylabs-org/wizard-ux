// Extracted unchanged from wizard-os/style/demo.html at 89ff5f69658481cdf0fec6715771f5ff0ab7910e.
// External script preserves the live Wizard shell's script-src 'self' CSP.
const sheet=document.getElementById('sheet');
document.getElementById('open').onclick=()=>sheet.showModal();
document.getElementById('close').onclick=()=>sheet.close();
document.getElementById('skin').onchange=e=>document.documentElement.dataset.skin=e.target.value;
document.querySelector('form').onsubmit=e=>e.preventDefault();
window.__wizardCloseOverlay=()=>{if(sheet.open){sheet.close();return true;}return false;};
