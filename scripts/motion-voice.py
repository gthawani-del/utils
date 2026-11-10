#!/usr/bin/env python3
"""Generate a Motion Studio narration MP3 with Microsoft's online Edge voices.

Local companion only: this does not start a server or use a paid fallback.
"""

import argparse
import asyncio
import os
from pathlib import Path
import re
import sys
import tempfile


VERSION = "7.3.1"


def speaking_rate(value):
    if not re.fullmatch(r"[+-]\d{1,3}%", value):
        raise argparse.ArgumentTypeError("Use a signed percentage, for example +0% or -10%.")
    if not -50 <= int(value[:-1]) <= 100:
        raise argparse.ArgumentTypeError("Rate must be between -50% and +100%.")
    return value


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list-voices", action="store_true", help="Fetch available voice names, languages and genders.")
    parser.add_argument("--locale", help="Filter the live voice list, for example en-IN or hi-IN.")
    parser.add_argument("--text-file", type=Path, help="UTF-8 narration file; text is sent to Microsoft's online service.")
    parser.add_argument("--voice", help="Exact ShortName from --list-voices, for example en-IN-NeerjaNeural.")
    parser.add_argument("--output", type=Path, help="New .mp3 file to create. Existing files are never overwritten.")
    parser.add_argument("--rate", type=speaking_rate, default="+0%", help="Speaking rate, -50%% to +100%% (use --rate=-10%%).")
    parser.add_argument("--timeout", type=int, default=60, help="Maximum service wait in seconds, 5 to 180 (default: 60).")
    args = parser.parse_args(argv)
    if not 5 <= args.timeout <= 180:
        parser.error("--timeout must be between 5 and 180 seconds.")
    if args.list_voices:
        if args.text_file or args.voice or args.output:
            parser.error("Use --list-voices separately from narration generation.")
    elif not all((args.text_file, args.voice, args.output)):
        parser.error("Generation requires --text-file, --voice and --output.")
    elif args.locale:
        parser.error("--locale filters --list-voices only; choose an exact --voice for generation.")
    if args.voice and not re.fullmatch(r"[a-z]{2,3}-[A-Za-z0-9-]+Neural", args.voice):
        parser.error("Choose an exact Neural voice ShortName returned by --list-voices.")
    return args


async def run(args, edge_tts):
    # Respect the caller's configured proxy; never print proxy values or credentials.
    proxy = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY")
    if args.list_voices:
        voices = await asyncio.wait_for(edge_tts.list_voices(proxy=proxy), args.timeout)
        selected = [v for v in voices if not args.locale or v.get("Locale", "").casefold() == args.locale.casefold()]
        if not selected:
            raise ValueError("No voices matched that locale. Retry without --locale.")
        print("Voice\tLanguage / region\tGender")
        for voice in sorted(selected, key=lambda v: v["ShortName"]):
            print(f'{voice["ShortName"]}\t{voice.get("Locale", "")}\t{voice.get("Gender", "")}')
        return

    if not args.text_file.is_file() or args.text_file.stat().st_size > 64000:
        raise ValueError("Choose an existing UTF-8 text file smaller than 64 KB.")
    text = args.text_file.read_text(encoding="utf-8-sig").strip()
    if not text or len(text) > 12000:
        raise ValueError("Narration must contain between 1 and 12,000 characters. Split longer scripts into scenes.")
    output = args.output.expanduser()
    if output.suffix.lower() != ".mp3":
        raise ValueError("The output filename must end in .mp3.")
    if output.exists() or output.is_symlink():
        raise ValueError("Output already exists. Choose a new filename; no file was changed.")
    if not output.parent.is_dir():
        raise ValueError("The output folder does not exist. Create it first.")
    with tempfile.NamedTemporaryFile(prefix=".motion-voice-", suffix=".mp3", dir=output.parent, delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        print("Generating narration using Microsoft's online Edge service…", file=sys.stderr)
        communicate = edge_tts.Communicate(text, args.voice, rate=args.rate, proxy=proxy)
        await asyncio.wait_for(communicate.save(str(temp_path)), args.timeout)
        if temp_path.stat().st_size < 128:
            raise ValueError("The service returned no usable audio. No output file was created.")
        # Exclusive creation also protects against a file appearing during generation.
        # A hard link avoids leaving a partially copied final file on interruption.
        os.link(temp_path, output)
        print(f"Saved {output}. Listen and check pronunciation before importing into Motion Studio.")
    finally:
        temp_path.unlink(missing_ok=True)


def main(argv=None):
    args = arguments(argv)
    try:
        import edge_tts
    except ImportError:
        print("Install the local companion dependency: python -m pip install -r scripts/motion-voice-requirements.txt", file=sys.stderr)
        return 2
    if edge_tts.__version__ != VERSION:
        print(f"This companion requires edge-tts=={VERSION}. Install scripts/motion-voice-requirements.txt.", file=sys.stderr)
        return 2
    try:
        asyncio.run(run(args, edge_tts))
        return 0
    except (ValueError, UnicodeError, OSError) as error:
        # These exceptions describe local validation/file failures; do not expose
        # network exception URLs, which may include service tokens.
        if type(error).__module__ in {"builtins", "asyncio.exceptions"} and not isinstance(error, TimeoutError):
            print(f"Narration not created: {error}", file=sys.stderr)
        else:
            print("Narration not created: network or service connection failed. Check access and retry. No paid fallback was used.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Cancelled. No paid fallback was used.", file=sys.stderr)
        return 130
    except Exception:
        print("Narration not created: Microsoft Edge speech is unavailable, timed out, or rejected the voice. Check --list-voices and retry. No paid fallback was used.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
