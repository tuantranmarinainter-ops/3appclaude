# Film world coordinate anchor

Film export now defaults to `local-origin` with explicit destination `[0,64,0]`.
This is a user-selected world coordinate, not a detected player position. The UI
also offers `scene-origin` to preserve authored absolute world coordinates.

The first selected actor/backdrop pivot is the source origin. A series pins one
source pivot at its initial source frame before segmentation. All actor replay
positions, backdrop replay positions, camera positions and exported VFX positions
receive exactly the same XYZ translation. One scene metre stays one block;
+Y remains up and +Z remains forward. Bone/model local coordinates, model bytes,
rotation, scale, and camera FOV remain unchanged by this operation. Export works
from a snapshot and does not update the authored project.

Destination Y is the model pivot height, not a measured terrain or foot height.
Choose it for the target world's ground and the model's pivot/floor offset.
`world-anchor.json` records the source pivot, destination, offset and coordinate
conventions; series archives retain these in `world-anchors.json`. Job provenance
also includes the resolved anchor.

The existing converted-model 180-degree facing convention is preserved. Native
codec tests establish that signed actor/camera rotation channels survive export,
including yaw through 180 degrees; they do not establish the forward direction
of real Minecraft20 or Verity meshes in a running game. Those models and the
copied Shot 01 source project were unavailable in this Linux environment. Real
Shot 01 frame 0/70/149 and in-game appearance remain acceptance work.

The synthetic native-codec regression checks keys at ticks 0/70/149, and linear
channel readback at source frames 0/70/149 at 30 fps (ticks 0, 46⅔, 99⅓).
It uses generated BOBJ text and an isolated temporary output directory; it reads
actual `.dat` bytes with the pinned `BbsCodec`, rather than relying on a manifest
round trip. Names in that fixture do not make it a real model calibration test.
