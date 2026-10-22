# Real Effekseer 1.80.6 Core property snapshots

Captured by Claude on the Windows review machine from the official samples in
`Sample/00_Basic` of `Effekseer1.80.6Win.zip` (the samples themselves are not committed).

Each node lists `property_get` values for the conversion-relevant subtrees (`CommonValues`, `LocationValues`,
`RotationValues`, `ScalingValues`, `GenerationLocationValues`, `RendererCommonValues/AllColor|AlphaBlend|Material|
ColorTexture/RelativePath`, `DrawingValues/Type|Sprite`). Enum values are only readable on the parent path
(`property_list` omits them), so parents that return a string are included, e.g. `LocationValues/Type = "Easing"`.
Bookkeeping leaves (`DefaultValue`, `IsValueChangedFromDefault`, `IsValueAssigned`, `DynamicEquation*`, `Step`) are dropped.

Use these to build a fake Core session in unit tests so `effect_dump` reads the same paths as the real DLL.
