# MDX runtime 1.28.1 provenance

- mdx-m3-viewer: 2ff0bc00c6363f425016e23d88c0fb2929d3b3cc. Runtime 1.28.0 plus DDS and animation classes; MIT, Mozilla JPEG Apache-2.0.
- war3-model: 52d7f421a5505a0434d764294057f2009ce3987b, MIT. Selected source under vendor/war3-model; parser modifications documented in docs/WARCRAFT_MDX1800_v1_28_1.md.
- Format reference only: jonathanvdc/wc3 crate0.2.0, SKIN/Light/camera layout. No Rust code copied into runtime.
- Independent test interpolator from war3-model, bundled under tests/vendor/war3_interp.mjs with license.
- gl-matrix3.3.0; esbuild0.28.2. Existing licenses remain bundled in HTML. New runtime is separate so 1.28.0 is reproducible unchanged.
