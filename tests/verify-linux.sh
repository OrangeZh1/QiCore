#!/usr/bin/env bash
set -euo pipefail
export CI=1
pnpm install --frozen-lockfile --prefer-offline --child-concurrency=1 --network-concurrency=3 --fetch-retries=1
pnpm db:generate
pnpm test
bash tests/sdk-consumer.sh
bash tests/mysql.sh
export QICORE_APP_LAYER="$PWD/examples/hello/web"
pnpm exec nuxt typecheck web
pnpm build
tools_dir=$(mktemp -d)
finish() { if [[ "$tools_dir" == /tmp/tmp.* ]]; then rm -rf -- "$tools_dir"; fi; }
trap finish EXIT
echo '{"name":"qicore-browser-qa","private":true}' > "$tools_dir/package.json"
pnpm --dir "$tools_dir" add --prefer-offline --child-concurrency=1 --network-concurrency=3 --fetch-retries=1 --ignore-scripts playwright@1.64.1
export QA_PLAYWRIGHT_PACKAGE="$tools_dir/package.json"
bash tests/mysql-installer.sh --with-web
