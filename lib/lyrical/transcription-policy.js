// Keep the former 500 MB+ "small" model out of browser transcription, including
// restored drafts. These are multilingual models, not the English-only variants.
export const TRANSCRIPTION_PROFILES = Object.freeze({
  tiny: Object.freeze({ model: "onnx-community/whisper-tiny_timestamped" }),
  base: Object.freeze({ model: "onnx-community/whisper-base_timestamped" }),
});

export function limitedTranscriptionDevice(device = {}) {
  return Boolean(
    device.mobile ||
    /Android|iPhone|iPad|iPod/i.test(device.userAgent || "") ||
    (/Mac/i.test(device.platform || "") && device.maxTouchPoints > 1) ||
    (Number.isFinite(device.deviceMemory) && device.deviceMemory <= 4),
  );
}

export function voskLanguage(language) {
  return language === "en" || language === "hi";
}

export function transcriptionQuality(requested, device = {}, language = "") {
  if (requested === "vosk" && voskLanguage(language)) return "vosk";
  return requested === "base" && !limitedTranscriptionDevice(device)
    ? "base" : "tiny";
}

export function transcriptionDevice() {
  const nav = globalThis.navigator || {};
  return {
    mobile: nav.userAgentData?.mobile,
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    deviceMemory: nav.deviceMemory,
  };
}
