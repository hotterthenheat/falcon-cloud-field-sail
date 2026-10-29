const KEY = 'slayer_alert_sound';

export function alertSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function beepAlert(): void {
  if (!alertSoundOn()) return;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const o = ctx.createOscillator();
  o.frequency.value = 660;
  o.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.08);
}
