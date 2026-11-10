import { durationOf } from './project.js';
export async function decodeNarration(data) {
  if (!data) return null;
  const encoded = data.slice(data.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer;
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    const buffer = await context.decodeAudioData(bytes);
    if (buffer.duration > 120 || buffer.numberOfChannels > 2) throw new Error('Use mono or stereo narration up to two minutes.');
    return buffer;
  } finally { await context.close(); }
}
export function mixAudio(project, narration) {
  const duration = durationOf(project), sampleRate = 48000;
  if (narration && narration.duration > duration + .02) throw new Error('Narration is longer than the video. Use “Fit scenes to narration” or shorten your recording.');
  const output = new AudioBuffer({ numberOfChannels: 2, length: Math.round(duration * sampleRate), sampleRate });
  for (let channel = 0; channel < 2; channel++) {
    const data = output.getChannelData(channel);
    const voice = narration?.getChannelData(Math.min(channel, narration.numberOfChannels - 1));
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const n = voice ? voice[Math.floor(t * narration.sampleRate)] || 0 : 0;
      let bed = 0;
      if (project.music) {
        const beat = t % .5, envelope = Math.exp(-beat * 11);
        const note = [130.8128, 164.8138, 195.9977, 164.8138][Math.floor(t / 2) % 4];
        const fade = Math.min(1, t / .5, (duration - t) / .8);
        bed = (Math.sin(2 * Math.PI * note * t) * .4 + Math.sin(2 * Math.PI * note * 2 * t) * .15) * envelope * fade * (voice ? .06 : .15);
      }
      data[i] = Math.max(-1, Math.min(1, n + bed));
    }
  }
  return output;
}
