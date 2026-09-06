"""Compare verified static device content, separating size loss from H.264.

Usage: python3 scripts/source-resolution-probe.py CAPTURE_DIRECTORY NEW_OUTPUT_DIR
Requires Pillow and NumPy. Native captures may have different timestamps; the
body must be byte-identical before/after. Never claims same-frame native timing.
"""
import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms


def read_srgb(path):
    with Image.open(path) as source:
        if source.width * source.height > 8_000_000:
            raise ValueError("Image exceeds 8 million pixels")
        if source.info.get("icc_profile"):
            source = ImageCms.profileToProfile(
                source, ImageCms.ImageCmsProfile(io.BytesIO(source.info["icc_profile"])),
                ImageCms.createProfile("sRGB"), outputMode="RGB")
        elif "srgb" not in source.info:
            raise ValueError(f"No declared sRGB/ICC profile: {path}")
        return source.convert("RGB").copy()


def metric(a, b):
    if a.shape != b.shape or a.ndim != 3 or a.shape[2] != 3:
        raise ValueError("Expected same-size RGB arrays")
    delta = a.astype(np.float64) - b.astype(np.float64)
    mse = float(np.mean(delta * delta))
    h, w = a.shape[:2]
    # Match the existing probe's complete, nonoverlapping 8x8 luma blocks.
    h8, w8 = h // 8 * 8, w // 8 * 8
    if min(h8, w8) == 0:
        raise ValueError("Region too small for SSIM8x8")
    luma = np.array([0.2126, 0.7152, 0.0722])
    x = (a[:h8, :w8] @ luma).reshape(h8 // 8, 8, w8 // 8, 8)
    y = (b[:h8, :w8] @ luma).reshape(h8 // 8, 8, w8 // 8, 8)
    axes = (1, 3)
    mx, my = x.mean(axis=axes), y.mean(axis=axes)
    vx = np.maximum(0, (x * x).mean(axis=axes) - mx * mx)
    vy = np.maximum(0, (y * y).mean(axis=axes) - my * my)
    covariance = (x * y).mean(axis=axes) - mx * my
    ssim = ((2 * mx * my + 6.5025) * (2 * covariance + 58.5225)) / (
        (mx * mx + my * my + 6.5025) * (vx + vy + 58.5225))
    return {"rgbRmse": float(np.sqrt(mse)), "rgbMaxError": int(np.abs(delta).max()),
            "psnrDb": None if mse == 0 else float(10 * np.log10(255 ** 2 / mse)),
            "ssim8x8": float(ssim.mean()), "ssimCoveredSize": [w8, h8]}


def main():
    if len(sys.argv) != 3:
        raise ValueError(__doc__)
    root, output = map(Path, sys.argv[1:])
    if output.exists():
        raise ValueError("Output exists; no overwrite")
    paths = {"nativeBefore": root / "device-screen.png", "nativeAfter": root / "device-screen-after.png",
             "sckPreEncode": root / "sck-pair/pre-encode.png"}
    images = {key: read_srgb(path) for key, path in paths.items()}
    before, native, sck = (images[key] for key in paths)
    if before.size != (1206, 2622) or native.size != before.size or sck.size != (960, 2088):
        raise ValueError("Unexpected validated device dimensions")
    a, b = np.asarray(before), np.asarray(native)
    # Only status bar excluded. App title, text, icons and gradients all remain.
    if not np.array_equal(a[200:], b[200:]):
        raise ValueError("Native app content changed; comparison excluded, no retry")
    sck_array = np.asarray(sck)
    # The inspected physical SCK buffer has two near-black padding rows, while
    # the matching native bottom content is white. Do not stretch this padding
    # into app content and misreport geometric drift as compression/blur.
    if int(sck_array[-2:].max()) > 3 or float(b[-2:].mean()) < 200:
        raise ValueError("Expected inspected two-row padding is absent; review alignment")
    content_size = (960, 2086)
    sck_content = sck.crop((0, 0, *content_size))
    regions = {"body": (0, 200, 1206, 2622), "titleAndBodyText": (330, 417, 1110, 617),
               "appIcon": (120, 418, 296, 594), "paleGradient": (944, 675, 1104, 711),
               "captureText": (112, 1020, 972, 1360)}
    reconstructed = sck_content.resize(native.size, Image.Resampling.LANCZOS)
    scaled_control = native.resize(content_size, Image.Resampling.LANCZOS)
    roundtrip = scaled_control.resize(native.size, Image.Resampling.LANCZOS)
    def comparisons(image):
        values = np.asarray(image)
        return {name: {"rect": list(rect), **metric(b[y0:y1, x0:x1], values[y0:y1, x0:x1])}
                for name, rect in regions.items() for x0, y0, x1, y1 in [rect]}
    same_size_crop = (0, round(200 * 2086 / 2622), 960, 2086)
    report = {"schemaVersion": 2,
              "scope": "Native before/after body byte-identical; independently timestamped screenshots, not simultaneous photon capture. SCK input is paired with its own IDR; these metrics exclude H.264.",
              "color": "Declared sRGB or ICC normalized to sRGB",
              "nativeSize": list(native.size), "sckSize": list(sck.size), "excludedNativeTopRows": 200,
              "sckContentSize": list(content_size), "excludedSckBottomRows": 2,
              "paddingMaxRgb": int(sck_array[-2:].max()), "nativeBottomMeanRgb": float(b[-2:].mean()),
              "bodyBeforeAfterIdentical": True,
              "retainedPixelFraction": (960 * 2086) / (1206 * 2622),
              "metric": "RGB byte RMSE; complete nonoverlapping 8x8 Rec709-luma SSIM, population moments. Lanczos resize control is not the SCK scaler.",
              "files": {key: {"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for key, path in paths.items()},
              "manifest": json.loads((root / "sck-pair/manifest.json").read_text()),
              "nativeVsActualSckReconstructed": comparisons(reconstructed),
              "nativeVsLanczosSizeOnlyControl": comparisons(roundtrip),
              "sckVsLanczosAt960Body": metric(np.asarray(sck_content.crop(same_size_crop)), np.asarray(scaled_control.crop(same_size_crop)))}
    output.mkdir(parents=True)
    with (output / "metrics.json").open("x") as file:
        json.dump(report, file, indent=2, allow_nan=False)
    print(json.dumps({"bodyBeforeAfterIdentical": True, "retainedPixelFraction": report["retainedPixelFraction"],
                      "actualSckBody": report["nativeVsActualSckReconstructed"]["body"],
                      "sizeOnlyControlBody": report["nativeVsLanczosSizeOnlyControl"]["body"],
                      "sckVsControlAt960": report["sckVsLanczosAt960Body"]}, indent=2))


if __name__ == "__main__":
    main()
