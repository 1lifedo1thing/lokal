# Desktop installer design

Design reference: https://lokal-music.github.io/mobile/

The website's near-black canvas (#080b0c), mint (#adf6d5), pale lime
(#d9f5a1), serif accent and record grooves carry into installation. Assets
are bundled and generated offline; setup never loads the website or fonts.

## Windows

The native NSIS setup opens on a custom welcome screen: record artwork on
the left, “Your music. Your world.” on the right. Windows text remains live
and accessible. Continue through the standard current-user/all-users choice,
installation folder, real installation progress, and a completion screen with
an optional “Open Lokal” checkbox. Uninstall explains that music and library
data are retained.

The existing app ID, elevation, shortcuts, file associations, updater and
uninstaller remain owned by electron-builder. Silent installs and updater runs
skip the welcome page. The native title bar, keyboard navigation, focus and
system buttons are retained.

## macOS

A matching 660 × 440 Finder window puts the app and Applications side by
side, with a mint arrow and concise drag-to-install instructions. Launch
instructions sit below the icons. The DMG is still the platform-standard
drag installation, with the existing ZIP updater artifact.

## Linux and Microsoft Store

AppImage remains portable; DEB and MSIX use their system installation UI.
No web-based wrapper or extra setup runtime is introduced.

## Build and validation

`npm run gen:icons` also generates installer assets; `npm run gen:installer`
can regenerate them alone. SVG masters live in `build/installer`. Generated
24-bit NSIS BMPs and the DMG PNG live under its ignored `generated` folder.

`npm run test:installer` validates BMP row ordering/padding and image layout.
The installer workflow compiles the real NSIS include using a harmless payload
and a distinct smoke-test app ID, then tests silent installation, replacement
and uninstallation on Windows. This verifies packaging and unattended update
compatibility without installing Lokal or launching the fixture.
