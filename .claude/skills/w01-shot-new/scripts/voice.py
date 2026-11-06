"""CapCut voice line for a character (only CapCut voices; the user cleared them for YouTube), post-processed like Tập 15.

  python voice.py <char> "Ây ây da... đau quá!" <out.wav> [--rate -10]

Presets (user's choice 2026-11-05):
  goxua -> CapCut "Thanh Niên Tự Tin" BV075_streaming, pitch +8% (asetrate, length kept)
  hero  -> CapCut "Kenny Đại Đế" BV075_streaming_demon_dsp
Post: trim leading/trailing silence (-45 dB), loudnorm I=-16 TP=-1.5, 48 kHz mono. Add a line to the shot's CREDITS.md.
Runs VoiceStudio from S:/ChatGPT/MMO TOOL/TTS1 with its own .venv.
"""
import argparse, json, subprocess, sys, tempfile
from pathlib import Path

TTS = Path('S:/ChatGPT/MMO TOOL/TTS1')
PRESETS = {'goxua': ('BV075_streaming', 1.08), 'go': ('BV075_streaming', 1.08), 'hero': ('BV075_streaming_demon_dsp', 1.0)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('char'); ap.add_argument('text'); ap.add_argument('out')
    ap.add_argument('--rate', type=int, default=-10)
    a = ap.parse_args()
    voice, pitch = PRESETS[a.char]
    mp3 = Path(tempfile.mkdtemp()) / 'line.mp3'
    code = ("import threading,sys\nfrom capcut_engine import render_speech\n"
            f"render_speech({json.dumps(a.text)}, {json.dumps(voice)}, {a.rate}, {json.dumps(str(mp3))}, threading.Event(), lambda *x: None, lambda *x: None)\n")
    subprocess.run([str(TTS / '.venv/Scripts/python.exe'), '-c', code], cwd=TTS, check=True, env={**__import__('os').environ, 'PYTHONIOENCODING': 'utf-8'})
    sr = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', str(mp3)], capture_output=True, text=True, check=True).stdout.strip()
    # silence trim by energy (silenceremove ate words inside the line in Shot 04)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp3), '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True, check=True).stdout
    import array, math
    x = array.array('h', raw); win = 160
    loud = [i for i in range(0, len(x), win) if math.sqrt(sum(v * v for v in x[i:i + win]) / max(1, len(x[i:i + win]))) > 300]
    start, end = (loud[0] / 16000, (loud[-1] + win) / 16000) if loud else (0, len(x) / 16000)
    chain = f"atrim=start={max(0, start - 0.02):.3f}:end={end + 0.03:.3f},asetpts=N/SR/TB"
    if pitch != 1.0:
        chain += f",asetrate={sr}*{pitch},aresample=48000,atempo={1 / pitch:.6f}"
    chain += ",loudnorm=I=-16:TP=-1.5,afade=t=out:st=0:d=0"
    chain = chain.replace(",afade=t=out:st=0:d=0", "")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(mp3), '-af', chain, '-ar', '48000', '-ac', '1', a.out], check=True)
    dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', a.out], capture_output=True, text=True).stdout.strip()
    print(f'{a.out}: {dur} s, voice {voice}, pitch x{pitch}')


if __name__ == '__main__':
    sys.exit(main())
