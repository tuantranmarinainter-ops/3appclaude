#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Extract the supported App 3 equivalents from a Blockbench ec0b282 checkout.

Usage: python tools/extract-blockbench-keymaps.py /path/to/blockbench [--output-dir PATH]
The source checkout must be at ec0b282; output is deterministic. A Git
checkout and its relevant files are verified before extraction; for a source archive, verify its
provenance separately.
"""
import argparse, json, pathlib, re, subprocess

COMMIT = 'ec0b2827104d0799c153bfb5f867579c0c44652f'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('root', type=pathlib.Path)
parser.add_argument('--output-dir', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / 'work/material_alpha_v1_31_8/src/keymaps')
args = parser.parse_args()
root, out = args.root, args.output_dir
if (root / '.git').exists():
    actual = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != COMMIT:
        raise ValueError(f'Expected Blockbench commit {COMMIT}, got {actual}')
mapping = {
    'play_animation':'timeline.play', 'add_keyframe':'key.add',
    'previous_keyframe':'key.previous', 'next_keyframe':'key.next',
    'timeline_frame_back':'timeline.frameBack', 'timeline_frame_forth':'timeline.frameNext',
    'jump_to_timeline_start':'timeline.start', 'jump_to_timeline_end':'timeline.end',
    'move_tool':'tool.move', 'rotate_tool':'tool.rotate', 'swap_tools':'tool.swap', 'undo':'history.undo',
    'redo':'history.redo', 'delete':'key.delete', 'select_all':'key.selectAll',
    'timeline_graph_editor':'graph.toggle', 'add_marker':'timeline.marker',
    'copy':'pose.copy', 'paste':'pose.paste',
    'move_keyframe_back':'key.moveBack', 'move_keyframe_forth':'key.moveForward',
    'set_animation_end':'timeline.setEnd', 'open_model':'file.openProject',
    'camera_initial':'view.reset', 'camera_top':'view.top', 'camera_bottom':'view.bottom',
    'camera_south':'view.front', 'camera_north':'view.back', 'camera_east':'view.right',
    'camera_west':'view.left', 'toggle_camera_projection':'view.projection',
}
sources = ['js/animations/timeline.js', 'js/animations/keyframe.js', 'js/animations/animation.js', 'js/interface/main_tools.ts',
           'js/interface/shared_actions.ts', 'js/undo.js', 'js/copy_paste.js',
           'js/preview/preview.ts', 'js/io/io.js']
if (root / '.git').exists():
    relevant = sources + [f'keymaps/{name}.bbkeymap' for name in ('blender', 'maya', 'cinema4d')]
    check = subprocess.run(['git', '-C', str(root), 'diff', '--quiet', 'HEAD', '--', *relevant])
    if check.returncode != 0:
        raise ValueError('Blockbench source files have uncommitted changes or could not be checked')
special = {32:'Space', 35:'End', 36:'Home', 37:'ArrowLeft', 39:'ArrowRight', 46:'Delete', 188:',', 190:'.'}
def convert(value):
    if value is None: return []
    key = value.get('key')
    if isinstance(key, int): key = special.get(key, chr(key) if 48 <= key <= 90 else 'Numpad' + str(key - 96) if 96 <= key <= 105 else 'F' + str(key - 111) if 112 <= key <= 135 else None)
    if not isinstance(key, str): raise ValueError('Unsupported key: ' + repr(value))
    return ['+'.join([m for k,m in [('ctrl','Ctrl'),('alt','Alt'),('shift','Shift'),('meta','Meta')] if value.get(k)] + [key.upper() if len(key)==1 and key.isalpha() else key])]

defaults = {}
for path in sources:
    source = (root / path).read_text(encoding='utf-8')
    declarations = list(re.finditer(r"new\s+(?:Action|Tool|Toggle)\s*\(\s*['\"]([^'\"]+)['\"]", source))
    for i, match in enumerate(declarations):
        name = match.group(1)
        if name not in mapping: continue
        end = declarations[i+1].start() if i+1 < len(declarations) else len(source)
        bind = re.search(r'keybind\s*:\s*new\s+Keybind\s*\(\s*\{([^}]*)\}', source[match.end():end])
        if not bind: defaults[name] = None; continue
        fields = dict(re.findall(r"(key|ctrl|alt|shift|meta)\s*:\s*(true|false|\d+|'[^']*'|\"[^\"]*\")", bind.group(1)))
        defaults[name] = {k: (v == 'true' if v in ('true','false') else int(v) if v.isdigit() else v[1:-1]) for k,v in fields.items()}
missing = set(mapping) - defaults.keys()
if missing: raise ValueError('Missing upstream actions: ' + ', '.join(sorted(missing)))
presets = {'blockbench': {dest:convert(defaults[src]) for src,dest in mapping.items()}}
for name in ['blender', 'maya', 'cinema4d']:
    upstream = json.loads((root / ('keymaps/' + name + '.bbkeymap')).read_text(encoding='utf-8'))['keys']
    presets[name] = {dest:convert(upstream[src]) for src,dest in mapping.items() if src in upstream}
out.mkdir(parents=True, exist_ok=True)
for name, keys in presets.items():
    (out / ('blockbench-' + name + '.json')).write_text(json.dumps({'commit':'ec0b282','spdx':'GPL-3.0-or-later','keys':keys}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'generated.js').write_text('// SPDX-License-Identifier: GPL-3.0-or-later\n// Generated by tools/extract-blockbench-keymaps.py from Blockbench ec0b282.\nexport const extractedPresets = ' + json.dumps(presets, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
