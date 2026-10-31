import fs from 'node:fs/promises';
import path from 'node:path';
const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  shared = path.resolve(root, '../..'),
  vendor = path.join(shared, 'vendor/three');
const imports = {};
for (const name of ['keymap_registry', 'keymap_actions', 'keymap_catalog', 'keymap_ui', 'mouse_presets', 'shortcut_context']) {
  const source = (await fs.readFile(path.join(root, 'src', name + '.js'), 'utf8')).replace("'./keymap_actions.js'", "'@studio/keymap_actions'").replace("'./keymaps/generated.js'", "'@studio/keymaps-generated'");
  imports['@studio/' + name] = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
imports['@studio/keymaps-generated'] = 'data:text/javascript;base64,' + Buffer.from(await fs.readFile(path.join(root, 'src/keymaps/generated.js'), 'utf8')).toString('base64');
imports['@studio/layout-modes'] = 'data:text/javascript;base64,' + Buffer.from(await fs.readFile(path.join(root, 'src/layout_modes.js'), 'utf8')).toString('base64');
imports['@studio/timeline-tools'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/timeline_tools.js'), 'utf8')).toString(
    'base64',
  );
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full);
    else if (e.name.endsWith('.js')) {
      const p = path.relative(vendor, full).replaceAll('\\', '/');
      const src = (await fs.readFile(full, 'utf8')).replace(
        /((?:from\s*|import\s*)['"])([^'"]+)(['"])/g,
        (m, a, s, b) => {
          if (s === 'three') return a + '@vendor/build/three.module.js' + b;
          if (s.startsWith('.'))
            return (
              a + '@vendor/' + path.posix.normalize(path.posix.join(path.posix.dirname(p), s)) + b
            );
          return m;
        },
      );
      imports['@vendor/' + p] =
        'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
    }
  }
}
imports['@studio/keyframe-time'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/keyframe_time.js'), 'utf8')).toString(
    'base64',
  );
await walk(vendor);
imports.three = imports['@vendor/build/three.module.js'];
for (const p of Object.keys(imports).filter((p) => p.startsWith('@vendor/examples/jsm/')))
  imports['three/addons/' + p.slice('@vendor/examples/jsm/'.length)] = imports[p];
imports['@studio/pose-clipboard'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/pose_clipboard.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/extra-bones'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/extra_bones.js'), 'utf8')).toString('base64');
imports['@vendor/tween-easing'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(shared, 'vendor/tween_easing.js'), 'utf8')).toString(
    'base64',
  );
for (const [id, file] of [['smoothing-panel', 'smoothing_panel.js']])
  imports['@studio/' + id] =
    'data:text/javascript;base64,' +
    Buffer.from((await fs.readFile(path.join(root, 'src', file), 'utf8')).replace("'./shortcut_context.js'", "'@studio/shortcut_context'")).toString('base64');
imports['@studio/easing'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/easing.js'), 'utf8')).replace(
      "'../vendor/tween_easing.js'",
      "'@vendor/tween-easing'",
    ),
  ).toString('base64');
imports['@studio/easing-panel'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/easing_panel.js'), 'utf8'))
      .replace("'./easing.js'", "'@studio/easing'")
      .replace("'./shortcut_context.js'", "'@studio/shortcut_context'")
      .replace("'./motion_smoothing.js'", "'@studio/motion-smoothing'"),
  ).toString('base64');
imports['@studio/skin-shape'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/skin_shape.js'), 'utf8')).toString('base64');
imports['@studio/rig-kinematics'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/rig_kinematics.js'), 'utf8'))
      .replace("'./easing.js'", "'@studio/easing'")
      .replace("'./motion_smoothing.js'", "'@studio/motion-smoothing'"),
  ).toString('base64');
imports['@studio/motion-lab'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/motion_lab.js'), 'utf8')).toString('base64');
imports['@studio/graph-curves'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/graph_curves.js'), 'utf8'))
      .replace("'./easing.js'", "'@studio/easing'")
      .replace("'./motion_smoothing.js'", "'@studio/motion-smoothing'"),
  ).toString('base64');
imports['@studio/motion-smoothing'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/motion_smoothing.js'), 'utf8')).replace(
      "'./graph_curves.js'",
      "'@studio/graph-curves'",
    ).replace("'./shortcut_context.js'", "'@studio/shortcut_context'"),
  ).toString('base64');
imports['@studio/graph-editor'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/graph_editor.js'), 'utf8')).replace(
      "'./graph_curves.js'",
      "'@studio/graph-curves'",
    ).replace("'./shortcut_context.js'", "'@studio/shortcut_context'"),
  ).toString('base64');
imports['@studio/joint-limits'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/joint_limits.js'), 'utf8')).toString('base64');
imports['@studio/core'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/core.js'), 'utf8'))
      .replace("'./director_schema.js'", "'@studio/director-schema'")
      .replace("'./timeline_tools.js'", "'@studio/timeline-tools'")
      .replace("'./layout_modes.js'", "'@studio/layout-modes'")
      .replace("'./joint_limits.js'", "'@studio/joint-limits'")
      .replace("'./skin_shape.js'", "'@studio/skin-shape'")
      .replace("'./rig_kinematics.js'", "'@studio/rig-kinematics'")
      .replace("'./motion_lab.js'", "'@studio/motion-lab'")
      .replace("'./easing.js'", "'@studio/easing'")
      .replace("'./motion_smoothing.js'", "'@studio/motion-smoothing'")
      .replace("'./graph_curves.js'", "'@studio/graph-curves'"),
  ).toString('base64');
imports['@studio/control-rig'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/control_rig.js'), 'utf8')).replace(
      "'three'",
      "'@vendor/build/three.module.js'",
    ),
  ).toString('base64');
imports['@studio/onion-skin'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/onion_skin.js'), 'utf8'))
      .replace("'./texture_assets.js'", "'@studio/texture-assets'")
      .replace("'./compare_space.js'", "'@studio/compare-space'")
      .replace("'./core.js'", "'@studio/core'")
      .replace("'./timeline_tools.js'", "'@studio/timeline-tools'")
      .replace("'./layout_modes.js'", "'@studio/layout-modes'")
      .replace("'./bobj_loader.js'", "'@studio/bobj-loader'")
      .replace("'./fbx_loader_native.js'", "'@studio/fbx-native'"),
  ).toString('base64');
imports['@studio/viewport-display'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/viewport_display.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/ground-environment'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/ground_environment.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/silhouette-view'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/silhouette_view.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/viewport-toolbar'] =
  'data:text/javascript;base64,' +
  Buffer.from((await fs.readFile(path.join(root, 'src/viewport_toolbar.js'), 'utf8')).replace("'./shortcut_context.js'", "'@studio/shortcut_context'")).toString(
    'base64',
  );
imports['@studio/motion-panel'] =
  'data:text/javascript;base64,' +
  Buffer.from((await fs.readFile(path.join(root, 'src/motion_panel.js'), 'utf8')).replace("'./shortcut_context.js'", "'@studio/shortcut_context'")).toString('base64');
imports['@studio/animation-export'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/animation_export.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/fbx-native'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/fbx_loader_native.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/bobj-loader'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/bobj_loader.js'), 'utf8')).toString('base64');
imports['@studio/compare-space'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/compare_space.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/texture-assets'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/texture_assets.js'), 'utf8')).toString(
    'base64',
  );
imports['@studio/source-preview'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/source_preview.js'), 'utf8'))
      .replace("'./bobj_loader.js'", "'@studio/bobj-loader'")
      .replace("'./core.js'", "'@studio/core'")
      .replace("'./timeline_tools.js'", "'@studio/timeline-tools'")
      .replace("'./layout_modes.js'", "'@studio/layout-modes'"),
  ).toString('base64');
for (const [id, file] of [
  ['warcraft-loader', 'warcraft_loader.js'],
  ['league-loader', 'league_loader.js'],
  ['bobj-export', 'bobj_export.js'],
  ['warcraft-reforged', 'warcraft_reforged.js'],
])
  imports['@studio/' + id] =
    'data:text/javascript;base64,' +
    Buffer.from(
      (await fs.readFile(path.join(root, 'src', file), 'utf8'))
        .replace("'./texture_assets.js'", "'@studio/texture-assets'")
        .replace("'./warcraft_reforged.js'", "'@studio/warcraft-reforged'")
        .replace("'./warcraft_loader.js'", "'@studio/warcraft-loader'"),
    ).toString('base64');
imports['@vendor/mdx-runtime'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    await fs.readFile(path.join(shared, 'vendor/mdx_runtime_v1_28_1.js'), 'utf8'),
  ).toString('base64');
for (const file of ['director_schema', 'animation_director', 'director_panel', 'studio_bridge']) {
  let code = await fs.readFile(path.join(root, 'src', file + '.js'), 'utf8');
  for (const [a, b] of [
    ['./core.js', '@studio/core'],
    ['./director_schema.js', '@studio/director-schema'],
  ])
    code = code.replaceAll("'" + a + "'", "'" + b + "'");
  imports['@studio/' + file.replaceAll('_', '-')] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
imports['@studio/scene-studio'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/scene_studio.js'), 'utf8')).toString('base64');
for (const file of ['scene_evaluator', 'scene_package', 'scene_panel']) {
  let code = await fs.readFile(path.join(root, 'src', file + '.js'), 'utf8');
  for (const [source, id] of [
    ['core', 'core'],
    ['scene_studio', 'scene-studio'],
    ['scene_evaluator', 'scene-evaluator'],
    ['texture_assets', 'texture-assets'],
    ['bobj_export', 'bobj-export'],
    ['animation_export', 'animation-export'],
  ])
    code = code.replaceAll("'./" + source + ".js'", "'@studio/" + id + "'");
  imports['@studio/' + file.replaceAll('_', '-')] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
imports['@studio/shot-package'] =
  'data:text/javascript;base64,' +
  Buffer.from(await fs.readFile(path.join(root, 'src/shot_package.js'), 'utf8')).toString('base64');
imports['@studio/shot-export'] =
  'data:text/javascript;base64,' +
  Buffer.from(
    (await fs.readFile(path.join(root, 'src/shot_export.js'), 'utf8'))
      .replace("'./core.js'", "'@studio/core'")
      .replace("'./timeline_tools.js'", "'@studio/timeline-tools'")
      .replace("'./layout_modes.js'", "'@studio/layout-modes'")
      .replace("'./shot_package.js'", "'@studio/shot-package'"),
  ).toString('base64');
for (const file of ['shot_reverse', 'minecraft20_postprocess', 'minecraft20_export']) {
  let code = await fs.readFile(path.join(root, 'src', file + '.js'), 'utf8');
  for (const [source, id] of [
    ['shot_reverse', 'shot-reverse'],
    ['minecraft20_postprocess', 'minecraft20-postprocess'],
    ['bobj_export', 'bobj-export'],
    ['shot_export', 'shot-export'],
  ])
    code = code.replaceAll("'./" + source + ".js'", "'@studio/" + id + "'");
  imports['@studio/' + file.replaceAll('_', '-')] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}
let html = await fs.readFile(path.join(root, 'src/index.html'), 'utf8');
const app = (
  (await fs.readFile(path.join(root, 'src/app.js'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(root, 'src/workspace_ui.js'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(root, 'src/quick_animation.js'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(root, 'src/dual_editor.js'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(root, 'src/director_controller.js'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(root, 'src/scene_controller.js'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(root, 'src/shot_controller.js'), 'utf8'))
)
  .replace("'./keyframe_time.js'", "'@studio/keyframe-time'")
  .replace("'./pose_clipboard.js'", "'@studio/pose-clipboard'")
  .replace("'./minecraft20_export.js'", "'@studio/minecraft20-export'")
  .replace("'./extra_bones.js'", "'@studio/extra-bones'")
  .replace("'./shot_export.js'", "'@studio/shot-export'")
  .replace("'./shot_package.js'", "'@studio/shot-package'")
  .replace("'./animation_director.js'", "'@studio/animation-director'")
  .replace("'./director_panel.js'", "'@studio/director-panel'")
  .replace("'./studio_bridge.js'", "'@studio/studio-bridge'")
  .replace("'./league_loader.js'", "'@studio/league-loader'")
  .replace("'./warcraft_loader.js'", "'@studio/warcraft-loader'")
  .replace("'./bobj_export.js'", "'@studio/bobj-export'")
  .replace("'./animation_export.js'", "'@studio/animation-export'")
  .replace("'./source_preview.js'", "'@studio/source-preview'")
  .replace("'./texture_assets.js'", "'@studio/texture-assets'")
  .replace("'./compare_space.js'", "'@studio/compare-space'")
  .replace("'./core.js'", "'@studio/core'")
  .replace("'./timeline_tools.js'", "'@studio/timeline-tools'")
      .replace("'./layout_modes.js'", "'@studio/layout-modes'")
  .replace("'./bobj_loader.js'", "'@studio/bobj-loader'")
  .replace("'./fbx_loader_native.js'", "'@studio/fbx-native'")
  .replace("'./control_rig.js'", "'@studio/control-rig'")
  .replace("'./onion_skin.js'", "'@studio/onion-skin'")
  .replace("'./viewport-display.js'", "'@studio/viewport-display'")
  .replace("'./viewport_display.js'", "'@studio/viewport-display'")
  .replace("'./silhouette_view.js'", "'@studio/silhouette-view'")
  .replace("'./viewport_toolbar.js'", "'@studio/viewport-toolbar'")
  .replace("'./skin_shape.js'", "'@studio/skin-shape'")
  .replace("'./motion_panel.js'", "'@studio/motion-panel'")
  .replace("'./easing_panel.js'", "'@studio/easing-panel'")
  .replace("'./smoothing_panel.js'", "'@studio/smoothing-panel'")
  .replace("'./graph_editor.js'", "'@studio/graph-editor'")
  .replace("'./keymap_registry.js'", "'@studio/keymap_registry'")
  .replace("'./keymap_catalog.js'", "'@studio/keymap_catalog'")
  .replace("'./keymap_ui.js'", "'@studio/keymap_ui'")
  .replace("'./mouse_presets.js'", "'@studio/mouse_presets'")
  .replace("'./shortcut_context.js'", "'@studio/shortcut_context'")
  .replace("'./ground_environment.js'", "'@studio/ground-environment'")
  .replace("'./scene_studio.js'", "'@studio/scene-studio'")
  .replace("'./scene_evaluator.js'", "'@studio/scene-evaluator'")
  .replace("'./scene_package.js'", "'@studio/scene-package'")
  .replace("'./scene_panel.js'", "'@studio/scene-panel'");
html = html
  .replace(
    '/*STYLE*/',
    (await fs.readFile(path.join(root, 'src/style.css'), 'utf8')) +
      '\n' +
      (await fs.readFile(path.join(root, 'src/workspace_ui.css'), 'utf8')) + '\n' + (await fs.readFile(path.join(root, 'src/layout_modes.css'), 'utf8')),
  )
  .replace(
    '<!--IMPORTMAP-->',
    '<script type="importmap">' + JSON.stringify({ imports }) + '</script>',
  )
  .replace(
    '/*SAMPLE*/',
    (
      await fs.readFile(path.resolve(shared, '../builtin-assets/animation-studio/sample.fbx'))
    ).toString('base64'),
  )
  .replace('/*APP*/', app.replaceAll('</script', '<\\/script'));
const mdxLicense =
  (await fs.readFile(path.join(shared, 'vendor/LICENSE_MDX.txt'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(shared, 'vendor/LICENSE_GL_MATRIX.txt'), 'utf8'));
const jpegNotice =
  'BLP JPEG decoder: Copyright 2017 Mozilla Foundation. Apache-2.0. The upstream mdx-m3-viewer version adapts RGBA JPEG support and modern building.\n' +
  (await fs.readFile(path.join(shared, 'vendor/LICENSE_APACHE_2.txt'), 'utf8'));
const license =
  (await fs.readFile(path.join(shared, 'LICENSE'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(shared, 'NOTICE'), 'utf8')) +
  '\n' +
  (await fs.readFile(path.join(shared, 'vendor/war3-model/LICENSE'), 'utf8')) +
  '\n' +
  jpegNotice +
  '\n' +
  mdxLicense +
  '\n' +
  (await fs.readFile(path.join(shared, 'vendor/LICENSE_THREE.txt'), 'utf8')) +
  '\nTween.js Easing v25.0.0\n' +
  (await fs.readFile(path.join(shared, 'vendor/LICENSE_TWEEN.txt'), 'utf8'));
html = html.replace(
  '</head>',
  '<!-- Bundled Three.js license\n' + license.replaceAll('-->', '-- >') + ' -->\n</head>',
);
html = html.trimEnd() + '\n';
await fs.mkdir(path.join(shared, 'outputs'), { recursive: true });
await fs.writeFile(path.join(shared, 'outputs/Animation_Studio_v1_33_0.html'), html);
console.log(
  'Built standalone HTML:',
  html.length,
  'chars; vendor modules:',
  Object.keys(imports).length,
);
