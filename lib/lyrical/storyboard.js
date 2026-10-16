import { chooseDirection, LIMITS } from "./project.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const TRANSITIONS = Object.freeze({
  auto: "Auto · follows the song",
  dissolve: "Soft dissolve",
  cut: "Clean cut",
  slide: "Gentle slide",
  fade: "Fade through black",
});
export const VISUAL_THEMES = Object.freeze({
  reflective: {
    name: "Quiet reflections", palette: "Muted blue · warm amber",
    description: "Soft light, open landscapes and small personal details. Leave breathing room around the words.",
    searches: ["misty landscape", "rain window", "empty road"],
  },
  connection: {
    name: "Warm connections", palette: "Golden light · soft earth tones",
    description: "Intimate details, shared places and warm natural light. Keep the people and setting consistent.",
    searches: ["golden hour", "hands together", "sunset silhouette"],
  },
  resolve: {
    name: "After dark", palette: "Deep charcoal · amber highlights",
    description: "Night streets, solitary silhouettes and symbolic details. Use one recurring visual motif for returning lines.",
    searches: ["city night", "solitary silhouette", "chess board"],
  },
  celebration: {
    name: "Colour in motion", palette: "Vivid colour · warm highlights",
    description: "Expressive gestures, open spaces and lively light. Mix wide scenes with bold details without crowding the lyrics.",
    searches: ["festival lights", "dancing silhouette", "colourful city"],
  },
  journey: {
    name: "Open horizons", palette: "Natural green · clear sky",
    description: "A sense of travel through wide landscapes, paths and close-up textures. Keep colour and lighting consistent.",
    searches: ["mountain path", "open road", "forest sunlight"],
  },
});

export function visualPlan(project) {
  const direction = project.direction || chooseDirection(project.lines || [], project.analysis);
  const text = (project.lines || []).map((line) => line.text).join(" ").normalize("NFKC").toLowerCase();
  // These are suggestions, not a claim of multilingual semantic/genre recognition.
  const cue = /betray|revenge|game over|खामोशी|ख़ामोशी|हिसाब|चाल|धोखा/u.test(text) ? "resolve"
    : /\blove\b|together|प्यार|मोहब्बत|प्रेम|amour|amor/u.test(text) ? "connection"
      : /celebrat|\bdance\b|party|जश्न|नाच|fiesta/u.test(text) ? "celebration" : null;
  const requested = project.settings?.visualTheme;
  const theme = VISUAL_THEMES[requested] ? requested : cue || (direction.style === "cinematic" ? "reflective" : direction.style === "bold" ? "celebration" : "journey");
  const pacing = ["slow", "balanced", "energetic"].includes(project.settings?.scenePacing)
    ? project.settings.scenePacing : direction.style === "cinematic" ? "slow" : direction.style === "bold" ? "energetic" : "balanced";
  const seconds = { slow: 18, balanced: 12, energetic: 8 }[pacing];
  const duration = Math.max(0.1, Number(project.duration) || 0.1);
  const count = clamp(Math.round(duration / seconds), duration < 8 ? 1 : 2, LIMITS.images);
  return {
    ...VISUAL_THEMES[theme], theme, pacing, count,
    basis: VISUAL_THEMES[requested] ? "Your chosen visual theme" : cue ? "Suggested from lyric cues and phrasing" : "Suggested from lyric pace and audio energy",
  };
}

const normalized = (text) => String(text || "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim();
const cache = new WeakMap();
export function invalidateStoryboard(project) { cache.delete(project); }
export function storyboardFor(project, imageCount = 0) {
  const key = [imageCount, project.duration, project.settings?.scenePacing, project.settings?.visualTheme, project.direction?.style].join(":");
  let saved = cache.get(project);
  if (!saved || saved.key !== key || saved.lines !== project.lines) {
    saved = { key, lines: project.lines, scenes: compileStoryboard(project, imageCount) };
    cache.set(project, saved);
  }
  return saved.scenes;
}
export function compileStoryboard(project, imageCount = 0) {
  const duration = Math.max(0.1, Number(project.duration) || 0.1);
  const lines = project.lines || [];
  const plan = visualPlan(project);
  const count = Math.max(imageCount, plan.count);
  const minimum = Math.min(3, duration / count * 0.5);
  const boundaries = [0];
  for (let i = 1; i < count; i++) {
    const ideal = duration * i / count;
    const radius = Math.min(2.5, duration / count * 0.25);
    const candidates = lines.map((line) => line.start).filter((time) => Math.abs(time - ideal) <= radius);
    const nearest = candidates.sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0] ?? ideal;
    boundaries.push(clamp(nearest, boundaries.at(-1) + minimum, duration - (count - i) * minimum));
  }
  boundaries.push(duration);
  const repeats = new Map();
  for (const line of lines) {
    const key = normalized(line.text);
    if (key.length > 3) repeats.set(key, (repeats.get(key) || 0) + 1);
  }
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const excerpt = lines.find((line) => line.start >= start && line.start < end) || lines.find((line) => line.end > start && line.start < end);
    const returning = (repeats.get(normalized(excerpt?.text)) || 0) > 1;
    return {
      index, start, end, imageIndex: imageCount ? index % imageCount : -1,
      label: index === 0 ? "Opening" : index === count - 1 ? "Closing" : returning ? "Returning phrase" : index % 2 ? "Story moment" : "A closer detail",
      excerpt: excerpt?.text || "Instrumental · let the image breathe",
      search: plan.searches[index % plan.searches.length],
    };
  });
}

export function storyboardSceneAt(scenes, time) {
  return scenes.find((scene) => time < scene.end) || scenes.at(-1) || null;
}

export function sceneTransition(project, scene) {
  const requested = project.settings?.transition;
  let type = TRANSITIONS[requested] ? requested : "auto";
  if (type === "auto") {
    const envelope = project.analysis?.envelope || [];
    const at = Math.round(scene.start / 0.05);
    const energy = envelope.slice(Math.max(0, at - 5), at + 6).reduce((a, b) => a + b, 0) / 11;
    const onset = (project.analysis?.onsets || []).some((time) => Math.abs(time - scene.start) < 0.22);
    type = energy > 0.55 && onset ? "cut" : "dissolve";
  }
  const duration = type === "cut" ? 0 : Math.min(
    { slow: 1.1, normal: 0.65, quick: 0.3 }[project.settings?.transitionSpeed] || 0.65,
    (scene.end - scene.start) * 0.3,
  );
  return { type, duration };
}

// At most two decoded images: outgoing/current during a transition,
// current/next afterwards. The renderer and loader share this exact schedule.
export function sceneImageIndices(project, scenes, time) {
  const scene = storyboardSceneAt(scenes, time);
  if (!scene || scene.imageIndex < 0) return [];
  const transition = sceneTransition(project, scene);
  const neighbour = scene.index > 0 && time < scene.start + transition.duration
    ? scenes[scene.index - 1] : scenes[scene.index + 1];
  return [...new Set([scene.imageIndex, neighbour?.imageIndex].filter((index) => index >= 0))];
}

export function previewWindow(scenes, duration) {
  const boundary = scenes[Math.min(1, scenes.length - 1)]?.start || 0;
  const start = Math.max(0, Math.min(duration - 15, boundary - 3));
  return { start, end: Math.min(duration, start + 15) };
}
