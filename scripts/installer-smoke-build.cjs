// Compile the real production installer configuration with a harmless payload.
// A distinct app identity keeps this isolated from actual Lokal installations.
const fs = require('node:fs/promises')
const path = require('node:path')
const { build, Platform, Arch } = require('electron-builder')
const root = path.resolve(__dirname, '..')
async function main() {
  const fixture = path.join(process.env.RUNNER_TEMP, 'lokal-installer-fixture')
  await fs.mkdir(path.join(fixture, 'resources'), { recursive: true })
  await fs.writeFile(path.join(fixture, 'LokalInstallerSmoke.exe'), 'Packaging fixture; not an application.')
  const { build: config } = require('../package.json')
  await build({
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    prepackaged: fixture, publish: 'never',
    config: {
      ...config, appId: 'com.lokal.installer-smoke', productName: 'LokalInstallerSmoke',
      directories: { ...config.directories, output: path.join(root, 'installer-test-output') },
      win: { ...config.win, target: ['nsis'], signAndEditExecutable: false },
      nsis: { ...config.nsis, runAfterFinish: false },
    },
  })
  const files = await fs.readdir(path.join(root, 'installer-test-output'))
  if (!files.some(file => file.endsWith('.exe') && !file.includes('__uninstaller'))) throw new Error('NSIS did not produce an installer')
}
main().catch(error => { console.error(error); process.exit(1) })
