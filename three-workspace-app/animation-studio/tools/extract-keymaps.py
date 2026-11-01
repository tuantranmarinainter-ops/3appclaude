# SPDX-License-Identifier: GPL-3.0-or-later
"""Extract pinned Blockbench keybind data without executing upstream JavaScript.
Usage: python tools/extract-keymaps.py <Blockbench ec0b282 checkout>
"""
import json,re,sys,hashlib
from pathlib import Path
COMMIT='ec0b2827104d0799c153bfb5f867579c0c44652f'
MAPPING={
 'play_animation':'timeline.play','add_keyframe':'key.add',
 'timeline_frame_back':'timeline.frameBack','timeline_frame_forth':'timeline.frameNext',
 'jump_to_timeline_start':'timeline.start','jump_to_timeline_end':'timeline.end',
 'move_keyframe_back':'key.moveBack','move_keyframe_forth':'key.moveNext',
 'set_animation_end':'timeline.setEnd','add_marker':'timeline.marker',
 'timeline_graph_editor':'timeline.graph','move_tool':'tool.translate','rotate_tool':'tool.rotate',
 'undo':'history.undo','redo':'history.redo','delete':'key.delete','select_all':'key.selectAll',
 'invert_selection':'key.invert','rename':'file.rename','toggle_sidebars':'view.sidebars',
 'open_model':'file.open','fullscreen':'view.fullscreen','swap_tools':'tool.swap',
 'camera_initial':'view.initial','camera_bottom':'view.bottom','camera_south':'view.south',
 'camera_east':'view.east','camera_north':'view.north','camera_west':'view.west','camera_top':'view.top',
 'toggle_camera_projection':'view.projection','screenshot_model':'view.screenshot'}
NUMBERS={8:'Backspace',9:'Tab',13:'Enter',27:'Escape',32:'Space',35:'End',36:'Home',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',46:'Delete',188:',',190:'.'}
def chord(data):
 key=data.get('key',-1)
 if isinstance(key,str):key=key.upper() if len(key)==1 else key
 elif 96<=key<=105:key='Numpad'+str(key-96)
 elif 112<=key<=123:key='F'+str(key-111)
 elif 48<=key<=90:key=chr(key)
 else:key=NUMBERS.get(key)
 if not key:return None
 return '+'.join([name for prop,name in [('ctrl','Mod'),('alt','Alt'),('shift','Shift')] if data.get(prop) is True]+[key])
def extract(root,out):
 bindings={};origins={}
 for file in sorted((root/'js').rglob('*')):
  if file.suffix not in ['.js','.ts']:continue
  text=file.read_text(encoding='utf-8')
  starts=list(re.finditer(r"new\s+(?:Action|Tool|KeybindItem|Toggle)\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*\{",text))
  for i,m in enumerate(starts):
   block=text[m.end():starts[i+1].start() if i+1<len(starts) else len(text)]
   found=re.search(r'keybind\s*:\s*new Keybind\s*\(\s*\{([^}]+)\}',block)
   if not found:continue
   raw={}
   for prop,value in re.findall(r"(key|ctrl|alt|shift|meta)\s*:\s*('[^']*'|\"[^\"]*\"|-?\d+|true|false|null)",found.group(1)):
    raw[prop]=value[1:-1] if value.startswith(('"',"'")) else json.loads(value)
   if chord(raw):bindings[m.group(1)]=raw;origins[m.group(1)]=str(file.relative_to(root))
 presets={};provenance={}
 for name,filename in [('blockbench',None),('blender','blender.bbkeymap'),('maya','maya.bbkeymap'),('cinema4d','cinema4d.bbkeymap')]:
  data=dict(bindings)
  if filename:data.update(json.loads((root/'keymaps'/filename).read_text())['keys'])
  keys={MAPPING[id]:[chord(raw)] for id,raw in data.items() if id in MAPPING and chord(raw)}
  presets[name]={'keys':keys,'mouse':{id:data.get(id) for id in ['preview_rotate','preview_drag','preview_zoom']}}
  provenance[name]={'mapped':{id:{'app3':MAPPING[id],'source':origins.get(id),'binding':raw} for id,raw in data.items() if id in MAPPING and chord(raw)},'unmapped':sorted(id for id in data if id not in MAPPING),'mouse':{id:data.get(id) for id in ['preview_rotate','preview_drag','preview_zoom']}}
 expected={'timeline.play':'Space','key.add':'Q','timeline.frameBack':',','timeline.frameNext':'.','tool.translate':'V','tool.rotate':'R','history.redo':'Mod+Y'}
 for id,key in expected.items():assert presets['blockbench']['keys'].get(id)==[key],(id,presets['blockbench']['keys'].get(id))
 out.mkdir(parents=True,exist_ok=True)
 (out/'presets.js').write_text('// SPDX-License-Identifier: GPL-3.0-or-later\n// Generated from Blockbench '+COMMIT+'; see PROVENANCE.json. Do not edit by hand.\nexport const PRESETS = '+json.dumps(presets,ensure_ascii=False,indent=2)+';\n')
 (out/'PROVENANCE.json').write_text(json.dumps({'upstream':'https://github.com/JannisX11/blockbench','commit':COMMIT,'SPDX':'GPL-3.0-or-later','method':'Static Action/Tool/KeybindItem and Keybind extraction; .bbkeymap overrides. No upstream code executed.','sourceSha256':{str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(root.rglob('*')) if f.is_file() and ((str(f.relative_to(root)).startswith('js/') and f.suffix in ['.js','.ts']) or str(f.relative_to(root)).startswith('keymaps/'))},'omissions':'UV/mesh/paint, pivot tool (no editable pivot in App3), copy/cut/paste/duplicate and project close have no equivalent in this App3 version; future packages may register them.','presets':provenance},ensure_ascii=False,indent=2)+'\n')
 print('Extracted',len(bindings),'defaults;',sum(len(p['keys']) for p in presets.values()),'mapped preset bindings')
if __name__=='__main__':extract(Path(sys.argv[1]),Path(__file__).resolve().parents[1]/'work/material_alpha_v1_31_8/src/keymaps')
