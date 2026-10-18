#!/usr/bin/env python3
# Transcribes a voice note on this machine (faster-whisper on CPU) and prints the text. The language is detected.
# Usage: <venv>/bin/python -I transcribe.py note.ogg      Model: $ASKQ_STT_MODEL (tiny, base, small, medium; default small)
# Audio is decoded with ffmpeg (16 kHz mono) rather than PyAV, which clashes with some faster-whisper versions.
import os
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", sys.argv[1], "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                     check=True, capture_output=True).stdout
audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0

model = WhisperModel(os.environ.get("ASKQ_STT_MODEL", "small"), device="cpu", compute_type="int8", cpu_threads=min(4, os.cpu_count() or 1))
segments, info = model.transcribe(audio, beam_size=5, vad_filter=True)
print(" ".join(s.text.strip() for s in segments).strip())
print(f"language={info.language} p={info.language_probability:.2f}", file=sys.stderr)
