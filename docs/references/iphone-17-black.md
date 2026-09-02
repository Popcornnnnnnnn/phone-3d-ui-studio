# iPhone 17 black geometry reference

This model is an original procedural approximation for UI demonstration. Apple source material is used as measurement and visual reference only; no Apple PDF, bezel asset, photograph, logo, or texture is redistributed in this repository.

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
- Camera-plate contour, component center positions, lens stack thickness, button depth, port internals, glass tint, roughness and clearcoat are visual approximations.
- The on-screen artwork is synthetic. It is not an iOS screenshot.
- The Apple logo is intentionally omitted. Adding branded marks or redistributing Apple product-bezel assets requires a separate rights review.

## Review contract

- `iphone-17-root` owns the model pivot at the geometric center.
- `screen-mesh` is independently named and replaceable by a future media texture.
- Positive Z is the front display; negative Z is the rear camera side.
- Front and back review views are deterministic. Studio view may add subtle idle motion.
- Portrait texture target is 1206 × 2622 pixels; landscape is 2622 × 1206 pixels. Orientation state rotates the physical model and counter-rotates the synthetic screen layout, preserving aspect ratio rather than stretching the content.
