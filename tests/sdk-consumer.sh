#!/usr/bin/env bash
set -euo pipefail
consumer=$(mktemp -d)
finish() { if [[ "$consumer" == /tmp/tmp.* ]]; then rm -rf -- "$consumer"; fi; }
trap finish EXIT
root="$PWD"
pnpm pack --out "$consumer/qicore.tgz"
sdk="$consumer/node_modules/@qicore/standalone"
mkdir -p "$sdk"
tar -xzf "$consumer/qicore.tgz" --strip-components=1 -C "$sdk"
cat > "$consumer/consumer.mjs" <<'JS'
import assert from 'node:assert/strict'
import {defineApplication} from '@qicore/standalone/sdk'
const definition={key:'outside',title:'外部示例',permissions:['outside.read'],menus:[{path:'/outside',title:'外部页面',permission:'outside.read'}]}
assert.equal(defineApplication(definition),definition)
JS
cat > "$consumer/consumer.mts" <<'TS'
import {defineApplication,type AccountIdentity} from '@qicore/standalone/sdk'
const app=defineApplication({key:'outside',title:'外部示例',permissions:[],menus:[],answer:42})
const result:number=app.answer
const visibility=(user:AccountIdentity):boolean=>user.enabled
void [result,visibility]
TS
node "$consumer/consumer.mjs"
node "$root/node_modules/typescript/bin/tsc" --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext "$consumer/consumer.mts"
echo 'PASS 独立 npm 消费项目使用已打包的 SDK 运行 JavaScript 并检查 TypeScript 声明'
