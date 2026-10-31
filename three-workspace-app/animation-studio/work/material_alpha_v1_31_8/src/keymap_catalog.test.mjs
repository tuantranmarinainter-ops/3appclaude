import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createKeymapRegistry, normalizeKey } from './keymap_registry.js';
import { keymapActions, keymapPresets } from './keymap_catalog.js';

test('các tổ hợp App 3 không mất do trùng trong phạm vi', () => {
  const registry = createKeymapRegistry(keymapActions, keymapPresets);
  for (const action of keymapActions) assert.deepEqual(registry.getBindings(action.id), action.bindings.map(normalizeKey), action.id);
  assert.equal(registry.resolve({key:'a', ctrlKey:true}, 'timeline'), 'key.selectAll');
  assert.equal(registry.resolve({key:'a', ctrlKey:true}, 'graph'), 'graph.selectAll');
});

test('preset trích từ nguồn giữ khác biệt Blender và Maya', () => {
  assert.deepEqual(keymapPresets.blockbench['key.add'], ['Q']);
  assert.deepEqual(keymapPresets.blender['key.add'], ['I']);
  assert.deepEqual(keymapPresets.maya['tool.move'], ['W']);
  assert.deepEqual(keymapPresets.blender['key.previous'], []);
  assert.deepEqual(keymapPresets.cinema4d['key.next'], ['Ctrl+G']);
  assert.deepEqual(keymapPresets.blockbench['timeline.marker'], ['Ctrl+M']);
  assert.deepEqual(keymapPresets.blockbench['timeline.setEnd'], ['Ctrl+End']);
  assert.deepEqual(keymapPresets.blockbench['key.moveBack'], ['ArrowLeft']);
  assert.deepEqual(keymapPresets.blockbench['tool.swap'], ['Space']);
  assert.deepEqual(keymapPresets.blockbench['file.openProject'], ['Ctrl+O']);
  assert.deepEqual(keymapPresets.blockbench['view.front'], ['Numpad4']);
  assert.deepEqual(keymapPresets.blockbench['view.projection'], ['Numpad5']);
  assert.deepEqual(keymapPresets.blockbench['view.left'], ['Numpad9']);
});

test('ưu tiên preset đổi xung đột và giữ gán tay khi đổi ưu tiên', () => {
  const registry = createKeymapRegistry(keymapActions, keymapPresets);
  registry.applyPreset('blockbench');
  assert.equal(registry.resolve('Q', 'global'), 'view.reset');
  registry.setPriority('preset');
  assert.equal(registry.resolve('Q', 'global'), 'key.add');
  assert.equal(registry.resolve('F3', 'global'), 'graph.toggle');
  assert.equal(registry.resolve('Space', 'viewport'), 'tool.swap');
  assert.equal(registry.resolve('Space', 'timeline'), 'timeline.play');
  assert.equal(registry.setBindings('view.focus', ['Alt+E']).ok, true);
  registry.setPriority('app3');
  assert.deepEqual(registry.getBindings('view.focus'), ['Alt+E']);
});

test('extractor giữ key trống và tạo dữ liệu có thể tái tạo từ nguồn', async () => {
  const { mkdtemp, mkdir, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'app3-keymap-extract-'));
  const here = dirname(fileURLToPath(import.meta.url));
  const script = join(here, '../../../tools/extract-blockbench-keymaps.py');
  try {
    const sources = ['js/animations/timeline.js', 'js/animations/keyframe.js', 'js/animations/animation.js', 'js/interface/main_tools.ts', 'js/interface/shared_actions.ts', 'js/undo.js', 'js/copy_paste.js', 'js/preview/preview.ts', 'js/io/io.js'];
    const ids = ['play_animation', 'add_keyframe', 'previous_keyframe', 'next_keyframe', 'timeline_frame_back', 'timeline_frame_forth', 'jump_to_timeline_start', 'jump_to_timeline_end', 'move_tool', 'rotate_tool', 'swap_tools', 'undo', 'redo', 'delete', 'select_all', 'timeline_graph_editor', 'add_marker', 'copy', 'paste', 'move_keyframe_back', 'move_keyframe_forth', 'set_animation_end', 'open_model', 'camera_initial', 'camera_top', 'camera_bottom', 'camera_south', 'camera_north', 'camera_east', 'camera_west', 'toggle_camera_projection'];
    for (const path of sources) {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, path === sources[0] ? ids.map(id => `new Action('${id}', {keybind: new Keybind({key: 65})});`).join('\n') : '');
    }
    await mkdir(join(root, 'keymaps'));
    for (const name of ['blender', 'maya', 'cinema4d']) await writeFile(join(root, 'keymaps', `${name}.bbkeymap`), JSON.stringify({keys: {play_animation: null, add_keyframe: {key: 73, ctrl: true}}}));
    const out = join(root, 'output');
    const run = () => spawnSync('python3', [script, root, '--output-dir', out], {encoding: 'utf8'});
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    const first = await readFile(join(out, 'generated.js'), 'utf8');
    const preset = JSON.parse(await readFile(join(out, 'blockbench-blender.json'), 'utf8'));
    assert.equal(preset.commit, 'ec0b282');
    assert.deepEqual(preset.keys['timeline.play'], []);
    assert.deepEqual(preset.keys['key.add'], ['Ctrl+I']);
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(out, 'generated.js'), 'utf8'), first);
  } finally { await rm(root, {recursive: true, force: true}); }
});
