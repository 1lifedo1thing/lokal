# Desktop releases

The public release pages keep one stable [`desktop`](https://github.com/lokal-music/desktop/releases/tag/desktop) release and, once built, one [`nightly`](https://github.com/lokal-music/desktop/releases/tag/nightly) prerelease. Each contains Windows, macOS (Apple silicon and Intel), and Linux (x64 and ARM64) downloads. Titles show the application version.

In **Actions → Release Lokal → Run workflow**, select `main`, choose **patch**, **minor**, **major**, or enter an exact version. Leave **publish** checked to publish immediately after every platform builds successfully. Uncheck it to leave a versioned draft for review. Opening or merging a PR, pushing a commit, and creating a tag do not start desktop builds.

The version advances from the published stable version and `package.json`, whichever is newer. All runners build the same pinned source commit with the selected package version; the workflow does not open a version PR or commit an automatic bump. Release notes compare with the previous stable source commit, even after old version tags are removed.

Completed artifacts are uploaded to a staging draft first. Publication verifies the platform packages and four updater manifests, then replaces the rolling release. An unsuccessful promotion restores the previous public release/tag. Cleanup runs after publication and preserves intentional drafts and their tags. Choosing draft mode leaves the existing stable release available; rerunning failed jobs reuses that run's version and source.

To publish a reviewed draft into the rolling channel without rebuilding, run `python3 scripts/desktop_releases.py promote --tag v14.3.2 --version 14.3.2` with its version. The helper reads the pinned source SHA from the draft. This also performs the rolling-tag switch and cleanup.

The installed stable Electron updater reads `latest*.yml` through GitHub's latest stable release, so a rolling tag does not replace version comparisons. Nightlies remain prereleases and do not become the stable update. Nightly builds are manual through **Build Lokal Nightly** and replace the same `nightly` page, regardless of the source ref.

For maintenance, preview cleanup with `python3 scripts/desktop_releases.py cleanup --dry-run`, then omit `--dry-run` to remove superseded managed releases and tags. `GH_TOKEN`/`gh` authentication requires repository contents write access for mutation. Custom tags are retained.

Validation: `python3 -m unittest discover -s scripts -p test_desktop_releases.py` (requires PyYAML).
