#!/bin/bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'Usage: macos/build.sh /path/to/Phone 3D Studio.app' >&2
  exit 1
fi

source_dir="$(cd "$(dirname "$0")" && pwd)"
app_path="$1"
mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
xcrun swiftc -parse-as-library -swift-version 5 -O \
  -target arm64-apple-macosx14.0 \
  -framework AppKit -framework SwiftUI -framework WebKit -framework CoreImage \
  "$source_dir/Phone3DStudio.swift" \
  -o "$app_path/Contents/MacOS/Phone3DStudio"
cp "$source_dir/Info.plist" "$app_path/Contents/Info.plist"

# Reuse the iPhone artwork as the single source for the Mac icon.
icon_source="$source_dir/../ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
icon_work="$(mktemp -d "${TMPDIR:-/tmp}/phone3d-icon.XXXXXX")"
trap 'rm -rf "$icon_work"' EXIT
icon_set="$icon_work/Phone3DStudio.iconset"
mkdir -p "$icon_set"
for size in 16 32 128 256 512; do
  /usr/bin/sips -z "$size" "$size" "$icon_source" --out "$icon_set/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  /usr/bin/sips -z "$double_size" "$double_size" "$icon_source" --out "$icon_set/icon_${size}x${size}@2x.png" >/dev/null
done
/usr/bin/iconutil -c icns "$icon_set" -o "$app_path/Contents/Resources/Phone3DStudio.icns"
