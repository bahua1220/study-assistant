// Offline dependency/native-source regression, not a device exploitation test.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const manifest = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
for (const name of ['@capacitor/android', '@capacitor/core', '@capacitor/cli']) {
  assert.equal(manifest.dependencies[name], '6.2.2', `${name} must be pinned to the reviewed patch`)
  assert.equal(lock.packages[`node_modules/${name}`].version, '6.2.2')
  assert.equal(JSON.parse(read(`node_modules/${name}/package.json`)).version, '6.2.2')
}

const javaRoot = 'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/'
const bridge = read(javaRoot + 'Bridge.java')
const localServer = read(javaRoot + 'WebViewLocalServer.java')
const navigation = bridge.slice(bridge.indexOf('public boolean launchIntent(Uri url)'))
assert.match(navigation, /path\s*!=\s*null\s*&&\s*path\.startsWith\(CAPACITOR_HTTP_INTERCEPTOR_START\)/)
assert.match(navigation, /path\.startsWith\(CAPACITOR_HTTP_INTERCEPTOR_START\)\)\s*\{\s*return true;/)
const block = navigation.indexOf('path.startsWith(CAPACITOR_HTTP_INTERCEPTOR_START)')
const plugins = navigation.indexOf('for (Map.Entry<String, PluginHandle>')
assert.ok(block >= 0 && plugins > block, 'block proxy documents before plugins can allow them')
assert.match(localServer, /getPluginConfiguration\("CapacitorHttp"\)\.getBoolean\("enabled", false\)/)
assert.match(localServer, /if\s*\(!httpEnabled\s*\|\|\s*isDocumentRequest\(request\)\)\s*\{\s*return null;/)
assert.match(localServer, /request\.isForMainFrame\(\)/)

console.log('PASS: manifest, lock and installed Capacitor packages pinned to 6.2.2')
console.log('PASS: native proxy navigation blocked before plugins; proxy disabled by default; document requests rejected')
console.log('NOTE: these checks verify installed native source; actual device WebView behavior still needs device testing')
