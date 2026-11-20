// Immutable test inputs for archived SaaS upgrade paths. No Git history or customer artifacts are needed.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
const pinned=JSON.parse(gunzipSync(readFileSync(new URL('./source-history.json.gz',import.meta.url))))
export function historicalBytes(path,hash) {
  const data=pinned[hash] ? Buffer.from(pinned[hash],'base64') : readFileSync(new URL('../../../../'+path,import.meta.url))
  assert.equal(createHash('sha256').update(data).digest('hex'),hash,path)
  return data
}
// Git 7bb193bfc2a2d8e2786d01b049de4646f1e064b9, the previously distributed 0.1.6 runtime.
export const source016={
  "apps/api/src/lifecycle/update-service.ts": "023080e63697aaca00b9da77e73d30b5959701ab6df17ed7af0afb92f963cf3d",
  "apps/api/src/applications/native-catalog.ts": "13ecf4a3beaaa3f24636ce54e27161d786c0bc1c641a7a545fc2f8032475b1b8",
  "apps/api/src/lifecycle/updater-client.ts": "ce39348caa07043b1440d57b32a7cf8a865927a128a4ff8b6811c94caf4a054e"
}
