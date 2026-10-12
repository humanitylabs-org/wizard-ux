/* User-triggered visible-window capture. Native PixelCopy includes canvas and hosted apps.
 * A desktop browser may use its own screen-share picker; Android web has no capture API. */
(() => {
  const pending = new Map();
  window.__wosScreenResult = (id, data, error) => {
    const p = pending.get(id); if (!p) return;
    pending.delete(id); clearTimeout(p.timer);
    if (error || !/^data:image\/png;base64,/.test(data || '')) return p.reject(new Error(error || 'Screen capture failed'));
    try {
      const raw = atob(data.split(',')[1]);
      if (raw.length > 8 * 1024 * 1024) throw new Error('Screen capture too large');
      const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      p.resolve(new File([bytes], 'screenshot-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png', { type: 'image/png' }));
    } catch (e) { p.reject(e); }
  };
  window.WosScreenCapture = {
    async capture() {
      const bridge = window.WizardOSNative;
      if (typeof bridge?.captureScreen === 'function') {
        const id = crypto.randomUUID().replace(/-/g, '');
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('Screen capture timed out · tap Screenshot again')); }, 12000);
          pending.set(id, { resolve, reject, timer });
          try { bridge.captureScreen(id); } catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
        });
      }
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screenshot needs the updated Wizard Android app');
      // Keep the browser's capture-picker invocation within the user's click activation.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true });
      try {
        const video = document.createElement('video'); video.srcObject = stream; video.muted = true;
        await video.play();
        if (!video.videoWidth || !video.videoHeight) throw new Error('Screen capture has no image');
        const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        if (!blob) throw new Error('Screen capture failed');
        return new File([blob], 'screenshot-' + Date.now() + '.png', { type: 'image/png' });
      } finally { stream.getTracks().forEach(t => t.stop()); }
    }
  };
})();
