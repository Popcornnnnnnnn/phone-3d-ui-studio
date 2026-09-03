# iPhone 17 black geometry reference

The repository includes an original procedural approximation as a distributable fallback. A higher-fidelity third-party GLB may be loaded from the ignored `public/local-assets/` directory for private local use; that asset is never committed or redistributed with this repository.

## Private local asset

- Source: [Apple iPhone 17 in Official Design and Colors by aliartist3d](https://www.cgtrader.com/free-3d-models/electronics/phone/apple-iphone-17-in-official-design-and-colors)
- Downloaded variant: `Apple iPhone 17 Black.glb`
- License shown at download: `Editorial License (no AI)`
- Local destination: `public/local-assets/iphone-17/iphone-17-black.glb`
- The downloaded file remains local-only. Publishing, packaging, or redistributing it requires a separate license review.
- The GLB supplies the body, cameras, lenses, buttons, port, Apple mark, materials, and embedded textures. The app retains its own independent screen surface for synthetic artwork and local video.
- When the local asset is available, the independent video surface reuses the imported `17-Screen` geometry and its full-range UVs directly. This preserves the model's continuous-curvature corner contour instead of approximating it with a circular rounded rectangle.

## Confirmed inputs

| Input | Value | Source |
|---|---:|---|
| Product width | 71.45 mm | Apple dimensional drawing |
| Product height | 149.61 mm | Apple dimensional drawing |
| Product thickness | 7.95 mm | Apple dimensional drawing and technical specifications |
| Cover-glass area | 69.45 × 147.61 mm | Apple dimensional drawing |
| Active display area | 66.57 × 144.79 mm | Apple dimensional drawing |
| Rear lens keepout diameter | 2 × 16.00 mm | Apple dimensional drawing |
| UI canvas | 402 × 874 pt; 1206 × 2622 px at @3x | Apple Human Interface Guidelines |
| Finish | Black; aluminum frame; color-infused glass back | Apple technical specifications |

Official sources:

- [iPhone 17 technical specifications](https://www.apple.com/iphone-17/specs/)
- [iPhone 17 dimensional drawing (PDF)](https://developer.apple.com/download/files/accessories/dimensional-drawings/iphone-17.pdf)
- [Apple dimensional drawings index](https://developer.apple.com/accessories/dimensional-drawings/)
- [Apple Human Interface Guidelines — Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Apple Design Resources](https://developer.apple.com/design/resources/)
- [Apple Support — iPhone 17 parts and features](https://support.apple.com/guide/iphone/iphone-17-iph15f87b8cf/26/ios/26)

## Derived or visually fitted inputs

- Scene scale is normalized to a 3-unit product height; every confirmed millimetre value uses the same conversion.
- Body and glass corner radii are visually fitted to the official orthographic drawing because the public specification does not provide a single manufacturing radius suitable for a low-poly render mesh.
- Camera-island contour, component center positions, lens stack thickness, button depth, port internals, glass tint, roughness and clearcoat are visual approximations calibrated against Apple’s black product-viewer imagery.
- The on-screen artwork is synthetic. It is not an iOS screenshot.
- The rear mark is a procedural Apple-style approximation included for this private personal demo. It does not import or redistribute Apple artwork and must not be treated as an official product asset.

## Visual calibration

- The black finish is rendered as neutral deep-charcoal aluminum around a darker, softly reflective color-infused glass back rather than a single pure-black material.
- The rail is a rounded-rectangle extrusion with a controlled bevel, while front and back glass are independent flat surfaces. This preserves the measured 7.95 mm depth without the inflated edge artifacts produced by an oversized box bevel.
- The standard iPhone 17 rear camera system is represented as a compact vertical pill at the upper-left, with two separate protective rings, dark lens glass, a flash, and microphone.
- The default Soft Paper scene uses a light neutral background so the black silhouette, thin border, lens depth, and edge highlights remain readable.

## Review contract

- `iphone-17-root` owns the model pivot at the geometric center.
- `screen-mesh` is independently named and replaceable by a future media texture.
- Positive Z is the front display; negative Z is the rear camera side.
- Front and back review views are deterministic. Studio view may add subtle idle motion.
- Portrait texture target is 1206 × 2622 pixels; landscape is 2622 × 1206 pixels. Orientation state rotates the physical model and counter-rotates the synthetic screen layout, preserving aspect ratio rather than stretching the content.
