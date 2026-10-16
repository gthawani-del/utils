// Explicit language prefixes prevent the runtime's English fallback in multilingual songs.
export function transcriptionOptions(language, config) {
  const languageId = config?.lang_to_id?.[`<|${language}|>`];
  const prefix = [
    config?.decoder_start_token_id,
    languageId,
    config?.task_to_id?.transcribe,
    config?.no_timestamps_token_id,
  ];
  if (!language || !prefix.every(Number.isInteger))
    throw new Error("Choose a supported song language before transcription.");
  return {
    chunk_length_s: 28,
    stride_length_s: 5,
    return_timestamps: "word",
    language,
    task: "transcribe",
    decoder_input_ids: prefix,
  };
}
