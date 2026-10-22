# EffectIR v1 for App 4 VFX

EffectIR is the JSON boundary between Effekseer Core extraction (`effect_dump`) and the pure-Python BBS converter. It describes source facts, not a claim that a source feature is supported by BBS.

```json
{
  "schemaVersion": 1,
  "name": "looping-aura",
  "fps": 60,
  "nodes": [
    {
      "id": "stable-id-from-session",
      "path": "node/id/stable-id-from-session",
      "parentId": null,
      "name": "AuraSprite",
      "renderType": "sprite",
      "blend": "add",
      "texture": "textures/vfx/aura.png",
      "generation": {"maxGeneration": 60, "generationTime": 3, "generationTimeOffset": 0, "infinite": true},
      "life": {"min": 24, "max": 36},
      "location": {"type": "pva", "shape": "sphere", "position": [0, 0, 0], "direction": [0, 1, 0], "velocity": [0, 0.2, 0], "acceleration": [0, -0.1, 0]},
      "size": [0.4, 0.4],
      "color": [0.4, 0.7, 1.0, 1.0],
      "unsupportedFeatures": []
    }
  ]
}
```

`schemaVersion` is an integer. `fps` is the source Effekseer frame rate; V2 currently emits a time conversion report for any finite positive value, with fixtures using 60 fps. `nodes` are in stable traversal order. `id` is stable for the live EffectSession; `path` is a stable node reference. Parent group nodes may use `renderType: "none"` and have no drawable scheme. Supported fields are `renderType`, `blend`, `texture`, `generation`, `life`, `location`, `size`, `color`, `lighting`, `flipbook`, and `unsupportedFeatures`. Raw Core properties may be included under `properties` for forward compatibility.

The converter reports every unsupported or approximate property per node. `BLOCKED` nodes are omitted only with explicit `--allow-partial`; the report remains present in either mode. Time is converted as `seconds = sourceFrames / fps`, then rounded to the nearest 1/20 second. This is a structural conversion contract and does not certify visual similarity or BBS FS runtime behavior.
