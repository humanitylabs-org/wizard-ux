// Phone media player for Podcasts (wizard-ux issue 1661): the work is in core/background-audio-legacy.js, which sends
// the playing app's own id to the Android player while this is on, and in the Android app (audio/AudioPolicy,
// BackgroundAudioService).
export default function setup(api) { return () => {}; }
