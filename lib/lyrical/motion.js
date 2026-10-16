// Shared deterministic choreography for preview and export. Vocal boundaries
// decide visibility; measured audio energy only modulates movement.
import { wordSegments } from "./project.js";
const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const smooth = (n) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const out = (n) => 1 - Math.pow(1 - clamp(n), 3);
export const MOTION_PRESETS = Object.freeze({
  rise: "Rise & expand",
  slide: "Directional slide",
  zoom: "Impact zoom",
  mask: "Masked reveal",
  sway: "Sway & flow",
  breathe: "Pulse & breathe",
  drift: "Floating drift",
  ripple: "Row ripple",
  stagger: "Staggered rows",
  elastic: "Elastic settle",
  tilt: "Restrained rotation",
  focus: "Focus & dissolve",
});
const banks = {
  bold: [
    "zoom",
    "slide",
    "elastic",
    "stagger",
    "mask",
    "rise",
    "ripple",
    "tilt",
  ],
  cinematic: ["drift", "sway", "mask", "breathe", "rise", "focus", "tilt"],
  clean: ["rise", "slide", "mask", "stagger", "breathe", "ripple", "focus"],
};

function smoothedEnvelope(values = []) {
  let result = values.map((value) => clamp(Number(value) || 0));
  for (let pass = 0; pass < 2; pass++) {
    const source = result;
    result = source.map((_, i) => {
      let total = 0,
        count = 0;
      for (
        let j = Math.max(0, i - 2);
        j <= Math.min(source.length - 1, i + 2);
        j++
      ) {
        total += source[j];
        count++;
      }
      return total / count;
    });
  }
  return result;
}

export function compileChoreography(project) {
  const style = project.settings?.style || "clean";
  const bank = banks[style] || banks.clean;
  const envelope = smoothedEnvelope(project.analysis?.envelope);
  const recent = [];
  const phrases = project.lines.map((line, index) => {
    const duration = Math.max(0.01, line.end - line.start);
    const pace = wordSegments(line.text).length / duration;
    const samples = envelope.slice(
      Math.floor(line.start * 20),
      Math.ceil(line.end * 20),
    );
    const energy =
      samples.reduce((sum, v) => sum + v, 0) / Math.max(1, samples.length);
    // Phrase pace/energy choose a vocabulary; rotation within it prevents
    // adjacent repetition without random frame-to-frame decisions.
    const choices = pace > 3.4 || energy > 0.72 ? banks.bold : bank;
    let at = index % choices.length;
    while (recent.includes(choices[at])) at = (at + 1) % choices.length;
    const preset = choices[at];
    recent.push(preset);
    if (recent.length > 2) recent.shift();
    return {
      phraseId: line.id,
      start: line.start,
      end: line.end,
      preset,
      direction: index % 2 ? -1 : 1,
      entry: Math.min(style === "cinematic" ? 0.58 : 0.4, duration * 0.28),
      exit: Math.min(0.3, duration * 0.22),
      energy,
    };
  });
  return {
    version: 2,
    intensity:
      { subtle: 0.6, balanced: 1, energetic: 1.35 }[
        project.settings?.intensity
      ] || 1,
    phrases,
    envelope,
    onsets: (project.analysis?.onsets || [])
      .filter(Number.isFinite)
      .slice()
      .sort((a, b) => a - b),
    audioFeatureProvenance:
      "Measured 50ms RMS envelope and energy onsets; not a BPM or vocal detector",
  };
}

export function audioDrive(plan, time) {
  const at = Math.max(0, time * 20),
    index = Math.floor(at),
    blend = at - index;
  const energy =
    (plan.envelope[index] || 0) * (1 - blend) +
    (plan.envelope[index + 1] || 0) * blend;
  // Continuous onset pulse, zero velocity at both ends; never changes text timing.
  let beat = 0;
  for (const onset of plan.onsets) {
    if (onset > time) break;
    if (time - onset < 0.42)
      beat = Math.max(beat, Math.sin(((time - onset) / 0.42) * Math.PI) ** 2);
  }
  return { energy, beat };
}

export function motionState(
  phrase,
  time,
  intensity = 1,
  drive = {},
  row = 0,
  rows = 1,
) {
  const visible = time >= phrase.start && time < phrase.end;
  const duration = Math.max(0.01, phrase.end - phrase.start);
  const t = clamp(time - phrase.start, 0, duration),
    p = t / duration;
  const delay =
    phrase.preset === "stagger"
      ? Math.min(0.08, (duration * 0.18) / Math.max(1, rows - 1)) * row
      : 0;
  const enter = out((t - delay) / Math.max(0.01, phrase.entry));
  const exit = smooth((phrase.end - time) / Math.max(0.01, phrase.exit));
  const envelope = smooth(t / Math.max(0.01, phrase.entry)) * exit;
  const a = clamp(intensity, 0.3, 1.5),
    dir = phrase.direction || 1;
  const wave = Math.sin(t * 1.7),
    slow = Math.sin(t * 0.9);
  const energy = clamp(drive.energy || 0),
    beat = clamp(drive.beat || 0);
  // Every preset keeps moving during the vocal hold, including Subtle mode.
  const state = {
    visible,
    opacity: visible
      ? Math.min(smooth((t - delay) / Math.max(0.01, phrase.entry * 0.6)), exit)
      : 0,
    x: 0,
    y: -0.008 * wave * a * envelope,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    reveal: 1,
  };
  const scale = (value) => {
    state.scaleX = value;
    state.scaleY = value;
  };
  switch (phrase.preset) {
    case "rise":
      state.y += (0.075 * (1 - enter) - 0.025 * p - 0.022 * (1 - exit)) * a;
      scale(0.92 + 0.08 * enter + 0.035 * p * a);
      break;
    case "slide":
      state.x =
        dir * (0.16 * (1 - enter) + 0.018 * slow - 0.07 * (1 - exit)) * a;
      break;
    case "zoom":
      scale(
        1 -
          0.34 * (1 - enter) * a +
          0.035 * p * a +
          0.025 * beat * a * envelope,
      );
      state.rotation = dir * 0.03 * (1 - enter) * a;
      break;
    case "mask":
      state.reveal = enter;
      state.x = dir * (0.025 * (1 - enter) + 0.022 * slow * envelope) * a;
      scale(1 + 0.025 * p * a);
      break;
    case "sway":
      state.x = 0.045 * Math.sin(t * 1.35) * a * envelope;
      state.rotation = 0.035 * Math.sin(t * 1.35) * a * envelope;
      scale(0.94 + 0.06 * enter);
      break;
    case "breathe":
      scale(
        0.94 +
          0.06 * enter +
          (0.025 * Math.sin(t * 2.2) + 0.035 * energy + 0.018 * beat) *
            a *
            envelope,
      );
      break;
    case "drift":
      state.x = dir * (p - 0.5) * 0.08 * a;
      state.y += (0.045 * (1 - enter) - 0.025 * p) * a;
      scale(0.96 + 0.04 * enter + 0.025 * p * a);
      break;
    case "ripple":
      state.y +=
        (0.04 * (1 - enter) +
          0.018 * Math.sin(t * 2.4 - row * 0.75) * envelope) *
        a;
      state.x = 0.018 * Math.sin(t * 1.3 + row * 0.5) * a * envelope;
      break;
    case "stagger":
      state.x =
        (row % 2 ? -1 : 1) * (0.1 * (1 - enter) + 0.012 * slow * envelope) * a;
      state.y += 0.03 * (1 - enter) * a;
      scale(0.94 + 0.06 * enter + 0.012 * energy * a * envelope);
      break;
    case "elastic": {
      const settle = Math.sin(t * 12) * Math.exp(-t * 5) * a;
      state.scaleX =
        1 -
        0.24 * (1 - enter) * a +
        0.12 * settle +
        0.018 * wave * envelope * a;
      state.scaleY = 1 + 0.13 * (1 - enter) * a - 0.06 * settle;
      break;
    }
    case "tilt":
      state.rotation = (dir * 0.12 * (1 - enter) + 0.025 * slow * envelope) * a;
      state.x = dir * 0.025 * p * a;
      scale(0.93 + 0.07 * enter);
      break;
    case "focus":
      scale(1 + (0.18 * (1 - enter) + 0.03 * p) * a);
      state.y += (0.015 * (1 - enter) - 0.012 * slow) * a;
      break;
  }
  const audioScale = 1 + (energy * 0.012 + beat * 0.008) * a * envelope;
  state.scaleX *= audioScale;
  state.scaleY *= audioScale;
  return state;
}

export function longHoldLines(lines) {
  return lines.flatMap((line, index) =>
    line.end - line.start > Math.max(8, wordSegments(line.text).length * 1.5)
      ? [index]
      : [],
  );
}
