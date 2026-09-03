# iPhone live input

This local prototype streams two inputs from an iPhone to the Mac bridge:

- ScreenCaptureKit full-display video, JPEG-compressed at up to 15 fps.
- Core Motion attitude quaternions and rotation rate at 60 Hz. Ultra mode asks
  Core Motion for 200 Hz; iOS clamps that request to the device ceiling and the
  web UI reports the measured callback rate.

Both remain in memory and are sent to the configured local WebSocket. The app
does not save a screen recording.

## Generate and build

```sh
cd ios
xcodegen generate
DEVELOPER_DIR=/Applications/Xcode-27-beta.app/Contents/Developer xcodebuild -project Phone3DUIStudio.xcodeproj \
  -scheme Phone3DUIStudio \
  -sdk iphoneos \
  CODE_SIGNING_ALLOWED=NO \
  build
```

ScreenCaptureKit is present in the iOS 27 device SDK but not the simulator SDK,
so this target must be compiled for a physical-device architecture.

## Run on a physical iPhone

1. Make sure the Mac and iPhone are on the same trusted local network.
2. Update `LiveBridgeURL` in both targets in `project.yml` if the Mac address
   shown by `npm run bridge` is not `192.168.20.61`, then regenerate.
3. Open the generated project in Xcode 27. Select your Team for the app target;
   change the bundle identifier if Xcode asks.
4. Run the app on the iPhone and accept Local Network and Motion permissions.
5. In the Mac web app select **Live iPhone** and **Connect local bridge**.
6. On iPhone tap **Choose Full Display**, choose the full iPhone display in the
   system sheet, and start sharing. You can then leave the companion app.

The app requires iOS 27 because ReplayKit broadcast upload extensions are no
longer supported there. ScreenCaptureKit runs in the host app, so no broadcast
extension is installed. The browser/bridge protocol is unchanged.
