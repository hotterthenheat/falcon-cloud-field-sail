const KEY = 'slayer_alert_sound';

export function alertSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setAlertSound(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* the desk's disk warning covers a full store */
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
