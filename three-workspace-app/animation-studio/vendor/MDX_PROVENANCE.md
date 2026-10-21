# Warcraft dependency

- Upstream: https://github.com/flowtsohg/mdx-m3-viewer
- Commit: 2ff0bc00c6363f425016e23d88c0fb2929d3b3cc
- Bundled: MDLX parser, BLP1 decoder, GenericObject/AnimatedObject track evaluator, createSkeletalNodes. No upstream WebGL renderer.
- gl-matrix: 3.3.0. esbuild: 0.28.2.
- Licenses: LICENSE_MDX.txt, LICENSE_GL_MATRIX.txt, LICENSE_APACHE_2.txt. The BLP JPEG decoder is derived from Mozilla and modified by upstream for BLP RGBA JPEG support. Notices are included in the standalone HTML.
- The BBSFix v0.10.1 upload was referenced for the wire format, including root parent spacing, rest mesh/weights, integer ticks, UV/normals and Blender Euler conventions. Its original validator is preserved under tests/reference solely for testing, with source attribution. The application uses an independently written JavaScript BOBJ serializer.
