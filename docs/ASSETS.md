# 3D Assets & Open-Source Attribution

All 3D hardware models shipped in `public/models/` for the online web playground (`https://phone3d.popcornnn.xyz`) are open-source **Creative Commons Attribution 4.0 (CC-BY 4.0)** models, processed and Draco-compressed for fast browser delivery using Blender (`scripts/process-phone-glb.py`) and a self-hosted Three.js Draco decoder in `public/draco/`.

## Bundled Hardware Models (`public/models/`)

| Asset | Used For | Source Model | Creator | License | Processed Specs | Modifications |
| --- | --- | --- | --- | --- | --- | --- |
| `public/models/iphone-17-pro.glb` | `iPhone 17 Pro`, `iPhone 17 Pro Max` | [iPhone 17 Pro](https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec) | [Ranguel](https://sketchfab.com/Ranguel) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 35,323 tris · 431 KB | Oriented screen-forward (`+Z`, `+Y` up), centered symmetrically on body bounds, scaled to unit height (`1.0`), wallpaper replaced with matte screen backing, textures downscaled (`≤512px`), aluminum & frosted glass neutralized for finish tinting, Draco-compressed. |
| `public/models/iphone-16.glb` | `iPhone 17`, `iPhone 16`, `iPhone 16 Plus` | [iPhone 16 Black](https://sketchfab.com/3d-models/iphone-16-black-91f29764b9df48759fa2195388e04468) | [Zvoni10](https://sketchfab.com/Zvoni10) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 55,529 tris · 494 KB | Oriented screen-forward (`+Z`, `+Y` up), centered symmetrically on body bounds, scaled to unit height (`1.0`), wallpaper & front decals replaced with matte backing, textures downscaled (`≤512px`), frame/back glass neutralized for finish tinting, Draco-compressed. |
| `public/models/iphone-16-pro.glb` | `iPhone 16 Pro`, `iPhone 16 Pro Max` | [iPhone 16 Pro Max](https://sketchfab.com/3d-models/iphone-16-pro-max-41a071ae12794b668502f58d1e0fd1a3) | [MajdyModels](https://sketchfab.com/MG990) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 26,904 tris · 309 KB | Oriented screen-forward (`+Z`, `+Y` up), centered symmetrically on body bounds, scaled to unit height (`1.0`), dense speaker grille decimated, wallpaper replaced with matte backing, titanium finish neutralized for finish tinting, Draco-compressed. |

## Original / Self-Hosted Components

- **Android (Adaptive) (`src/scene/AdaptiveAndroidShell.tsx`):** Original parametric Three.js mesh built directly from detected viewport aspect ratios and physical millimeter profiles (`shared/phoneGeometry.mjs`).
- **Draco Decoder (`public/draco/`):** Self-hosted `draco_decoder.js`, `draco_decoder.wasm`, and `draco_wasm_wrapper.js` from Three.js (`three/examples/jsm/libs/draco/gltf/`, Apache-2.0 / MIT).
- **Private Local Dev Reference (`public/local-assets/`):** Excluded from Git (`.gitignore`) and excluded from public Cloudflare static builds (`public/.assetsignore`, `npm run build:public`).

## Non-Affiliation Notice

iPhone is a trademark of Apple Inc. Phone 3D UI Studio is an independent open-source project and is not affiliated with, sponsored by, or endorsed by Apple Inc.
