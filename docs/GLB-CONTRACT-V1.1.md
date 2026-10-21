# GLB exchange contract v1.1.0

Version 1.1.0 adds optional extended rigs to the v1.0.0 exchange format. Units,
Y-up, unprefixed Mixamo65 core, T-pose reference, 30 FPS baked Actions, root policy,
UUIDs, SHA-256, embedded textures and skin influence rules remain unchanged.
Existing v1.0.0 manifests may omit `rig`; when present it is `mixamo65`, with no
`extraBones`. Producers with no extras continue writing the original v1.0 bytes.

An extended manifest has `version: "1.1.0"`, `rig: "mixamo65+<name>"` (a nonempty
ASCII alphanumeric suffix, with `_` or `-` allowed after its first character), and
a nonempty `extraBones` array. Each entry contains:

```json
{
  "name": "X_Head_Jaw",
  "parent": "Head",
  "rest": {
    "position": [0, -0.05, 0.03],
    "rotation": [0, 0, 0, 1],
    "scale": [1, 1, 1]
  }
}
```

Names are unique, case sensitive, and use `X_<coreAttachment>_<name>`. The attachment
is the ancestor in the Mixamo65 core; thus a tail chain can use `X_Hips_Tail1`
through `X_Hips_Tail4`, with each later segment parented to the previous extra.
The suffix uses ASCII letters, digits or underscores. Extras cannot replace core
names. `parent` must exist in the core or extras; cycles are forbidden. Array order
is unrestricted. Jaw, tail, wing, cape and weapon/prop attachments are supported
first. Minecraft20 has no extras in this version.

Rest is the local transform relative to `parent`: position in meters, quaternion
rotation in glTF XYZW order, scale as XYZ. Every component is finite. GLB skin
joints must contain exactly the core plus declared extras, with matching names,
parents and local rest TRS (tolerance 1e-6). Extras use TRS, not a matrix.

Base-rig Actions may play on an extended rig, with extras held at rest. Extended
Actions require their matching extended rig. Reverse Minecraft20 conversion drops
unmapped extras and reports their names. Data loss must remain visible in reports.

Read-only validators: `validateGlbContract` in `packages/retarget/cli/glbContract.ts`
and `validate_glb_contract` in `agent/glb_contract.py`; `validateExtraBones` /
`validate_extra_bones` validate manifest rig metadata alone. These functions raise
on invalid metadata or skin topology; existing normalization quality gates continue
to cover baking, root motion and skin weights.
