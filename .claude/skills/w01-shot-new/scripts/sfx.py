"""Original sound effects synthesized from sine/noise/filters (fixed seed, no third-party recordings: free for YouTube).

  python -I sfx.py <out_dir> bonk thud whoosh:1.2 ...     (name[:seconds]) -> <out_dir>/<name>.wav, 48 kHz mono, peak -1.5 dBFS
  python -I sfx.py --list

Recipes (Tập 15): thunder, beam, dome, slam (land + blocks), rush_blast, whoosh, takeoff, dash, swing, bonk, thud, stars, charge.
Write the files you used into the shot's CREDITS.md ("tự tổng hợp bằng sfx.py").
"""
import sys, wave
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt

RATE = 48_000
rng = np.random.default_rng(20261106)


def T(s): return np.arange(round(s * RATE)) / RATE
def noise(s, lo, hi): return sosfilt(butter(3, [lo, hi], btype='bandpass', fs=RATE, output='sos'), rng.standard_normal(round(s * RATE)))
def tone(freq, t): return np.sin(2 * np.pi * np.cumsum(np.broadcast_to(freq, t.shape)) / RATE)
def fade(x, a=0.004, r=0.06):
    x = x.copy(); a, r = round(a * RATE), round(r * RATE); x[:a] *= np.linspace(0, 1, a); x[-r:] *= np.linspace(1, 0, r); return x


def thunder(s=4.5):
    t = T(s); return fade(1.5 * noise(s, 90, 10000) * np.exp(-t * 18) + 3 * noise(s, 25, 260) * np.exp(-t * 1.1) * (.75 + .25 * np.sin(2 * np.pi * 3.1 * t)))
def beam(s=3.2):
    t = T(s); sw = np.minimum(t / 1.5, 1) ** 1.6 * np.exp(-np.maximum(t - 1.5, 0) * 1.4)
    return fade(sw * (sum(np.sin(2 * np.pi * f * t + p) * w for f, p, w in [(440, 0, 1), (660, 1, .5), (880, 2, .3), (1320, 0, .12)]) + .5 * noise(s, 1800, 9000)), r=.25)
def dome(s=4.0):
    t = T(s); hum = .45 * np.sin(2 * np.pi * 110 * t) + .12 * np.sin(2 * np.pi * 220 * t)
    on = (noise(s, 200, 6000) * np.exp(-t * 8) + tone(700 * np.exp(-t * 5) + 160, t) * np.exp(-t * 7)) * np.clip((1 - t) / .25, 0, 1)
    return hum * np.minimum(t / .3, 1) + on
def slam(s=3.0):
    t = T(s); g = 1.8 * tone(42 + 95 * np.exp(-t * 25), t) * np.exp(-t * 6) + 2 * noise(s, 45, 450) * np.exp(-t * 3.5) + noise(s, 800, 11000) * np.exp(-t * 12)
    return fade(g, r=.2)
def whoosh(s=1.1):
    t = T(s); e = np.sin(np.pi * np.minimum(t / (s * .82), 1)) ** 2; return fade(noise(s, 350, 6500) * e + .35 * tone(1150 - 650 * np.minimum(t / (s * .82), 1), t) * e, r=.1)
def takeoff(s=1.3):
    t = T(s); e = np.minimum(t / (s * .77), 1) ** 2 * np.exp(-np.maximum(t - s * .77, 0) * 12); return fade(noise(s, 250, 4000) * e + .25 * tone(220 + 380 * t, t) * e, r=.1)
def dash(s=0.9):
    t = T(s); e = np.exp(-((t - s * .39) / .16) ** 2); return fade(noise(s, 500, 7500) * e + .3 * tone(1400 - 900 * t, t) * e)
def swing(s=0.45):
    t = T(s); e = np.exp(-((t - .13) / .05) ** 2); return fade(noise(s, 1500, 11000) * e + .4 * tone(2600 - 3000 * t, t) * e, r=.03)
def bonk(s=1.4):
    t = T(s); k = 1.8 * tone(190 * np.exp(-t * 9) + 95, t) * np.exp(-t * 22) + 1.1 * noise(s, 300, 3500) * np.exp(-t * 45)
    return fade(k + sum(w * np.sin(2 * np.pi * f * t) for f, w in [(1318, .5), (1976, .3), (2637, .18)]) * np.exp(-t * 4.5), r=.15)
def thud(s=1.6):
    t = T(s); return fade(2.2 * tone(55 + 70 * np.exp(-t * 18), t) * np.exp(-t * 7) + 1.4 * noise(s, 40, 400) * np.exp(-t * 5) + .6 * noise(s, 900, 8000) * np.exp(-t * 10), r=.2)
def stars(s=2.5):
    t = T(s); x = np.zeros_like(t)
    for i, f in enumerate([2093, 2637, 3136, 2349, 2794, 3520, 2093, 3136]):
        st = .12 + i * .28; tt = np.clip(t - st, 0, None); x += (t >= st) * np.sin(2 * np.pi * f * tt) * np.exp(-tt * 7) * .5
    return fade(x * np.clip(1 - t / (s + .1), 0, 1), r=.2)
def charge(s=1.4):
    t = T(s); e = np.minimum(t / (s * .86), 1) ** 1.5 * np.exp(-np.maximum(t - s * .86, 0) * 20)
    sh = sum(w * np.sin(2 * np.pi * f * (1 + .6 * t) * t) for f, w in [(523, 1), (659, .7), (784, .5), (1046, .3)])
    return fade(e * (sh + .4 * noise(s, 2000, 9000)) + .5 * e * np.sin(2 * np.pi * 98 * t), r=.05)
def rush_blast(s=2.5):
    t = T(s); x = noise(s, 600, 8500) * np.exp(-((t - .115) / .08) ** 2) + .7 * tone(450 + 2700 * np.minimum(t / .167, 1), t) * np.exp(-((t - .12) / .075) ** 2)
    tt = T(s - 1 / 6); b = 2.5 * noise(s - 1 / 6, 45, 650) * np.exp(-tt * 4) + 1.3 * noise(s - 1 / 6, 800, 11000) * np.exp(-tt * 16) + 1.2 * tone(48 + 105 * np.exp(-tt * 20), tt) * np.exp(-tt * 5)
    i = round(RATE / 6); x[i:i + len(b)] += b[:len(x) - i]; return fade(x, r=.2)


RECIPES = {f.__name__: f for f in [thunder, beam, dome, slam, whoosh, takeoff, dash, swing, bonk, thud, stars, charge, rush_blast]}


def main():
    if sys.argv[1:2] == ['--list']:
        print(' '.join(RECIPES)); return
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    for spec in sys.argv[2:]:
        name, _, secs = spec.partition(':')
        audio = RECIPES[name](float(secs)) if secs else RECIPES[name]()
        audio = audio * (.84 / np.max(np.abs(audio)))
        pcm = np.rint(audio * 32767).astype('<i2')
        with wave.open(str(out / f'{name}.wav'), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())
        print(f'{out / (name + ".wav")}: {len(pcm) / RATE:.2f} s')


if __name__ == '__main__':
    main()
