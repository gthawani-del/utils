# Motion Studio narration companion

The website imports an audio file. It does **not** call a hosted voice backend or inherit ChatGPT's native tools. This optional Python companion generates that MP3 on a team computer using Microsoft's online Edge speech service through the open-source `edge-tts` package. It needs internet access, but no API key, Azure subscription or LLM API. It never falls back to a paid provider.

The script runs locally; **speech synthesis is online**, and the narration text is sent to Microsoft. Voice availability, service access and pronunciation quality can change. This is not an Azure Speech SDK integration or a guarantee of permanent free service access. A blocked request stops with an error.

## Install

Use Python 3.10 or later, in a virtual environment. From the repository root:

```sh
python -m venv .venv-motion-voice
# macOS / Linux
.venv-motion-voice/bin/python -m pip install -r scripts/motion-voice-requirements.txt
# Windows (run this instead of the preceding command)
.venv-motion-voice\Scripts\python.exe -m pip install -r scripts/motion-voice-requirements.txt
```

Use that environment's Python for each command below (shown as `python` for readability). The companion is pinned to `edge-tts==7.3.1`. Upgrades should be tested with a short narration before changing the pin.

## Choose a language, accent and voice

```sh
python scripts/motion-voice.py --list-voices
python scripts/motion-voice.py --list-voices --locale en-IN
python scripts/motion-voice.py --list-voices --locale hi-IN
```

The locale identifies a language and region. Copy the exact voice name returned by the service. The list is live, not a hard-coded promise of available voices. This tool selects existing voices; it does not clone voices or create singing voices.

## Generate a sample first

Create `sample.txt` containing two or three sentences in UTF-8. An example command is:

```sh
python scripts/motion-voice.py --text-file sample.txt --voice en-IN-NeerjaNeural --rate=+0% --output sample.mp3
```

Listen to the sample and confirm accent, pronunciation and pace. Then run the same command with the full narration text and a new output filename. Use `--rate=-10%` for slower delivery. The accepted rate range is -50% to +100%; text is limited to 12,000 characters. The default service timeout is 60 seconds; `--timeout 120` allows a longer wait, up to 180 seconds.

Output must be a new `.mp3` file in an existing directory. Existing files are never overwritten. Failed attempts remove temporary partial audio. The process respects the configured HTTPS proxy and does not print proxy credentials.

## Import into Motion Studio

Upload the generated MP3 using Motion Studio's narration upload. Listen to the preview and adjust scene durations to fit the recording. Generating a voice does not automatically align individual words or lip-sync characters. MP3 and project export support depend on the browser's supported codecs; use the studio's support checks.

If the service is unavailable, retry later or upload an existing recording. Do not introduce Azure, paid TTS APIs or GPU rentals as fallbacks.

## Verification

On 2026-11-11, the companion fetched the live `en-IN` voice list and generated a 6.816-second MP3 using `en-IN-NeerjaNeural`. FFprobe confirmed MP3 audio at 24 kHz, mono. CLI help, input/rate validation, output protection and partial-file cleanup were also checked. This verifies the local companion in that test environment, not a hosted website integration or the quality of every language and voice.

The test environment used an HTTPS inspection proxy. Its configured trusted CA had to be added to **the isolated test virtual environment's certifi bundle** before the service connection succeeded. Environments with a similar proxy may need their administrator's trusted CA configured for Python/certifi. Do not disable TLS certificate verification.

## References

- [Official edge-tts repository and usage](https://github.com/rany2/edge-tts)
- [Pinned release 7.3.1](https://github.com/rany2/edge-tts/releases/tag/7.3.1)

This companion is separate from the static website build and opens no network listener.
