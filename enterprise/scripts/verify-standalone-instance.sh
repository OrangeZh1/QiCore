#!/usr/bin/env bash
# End-to-end source installation with disposable Linux MySQL and Redis. Never uses an existing instance.
set -euo pipefail
umask 077
root=$(pwd)
scratch=$(mktemp -d)
children=()
finish(){
  for ((i=${#children[@]}-1;i>=0;i--)); do kill "${children[$i]}" 2>/dev/null || true; wait "${children[$i]}" 2>/dev/null || true; done
  [[ "$scratch" == /tmp/tmp.* ]] && rm -rf -- "$scratch"
}
trap finish EXIT
free_port(){ node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
export API_PORT=$(free_port) API_HOST=127.0.0.1
export NITRO_PORT=$(free_port) NITRO_HOST=127.0.0.1
redis_port=$(free_port)
[[ "$API_PORT" != "$NITRO_PORT" && "$API_PORT" != "$redis_port" && "$NITRO_PORT" != "$redis_port" ]]
export DATABASE_URL="mysql://root@localhost/qc_fixture_enterprise?socket=$scratch/mysql.sock" REDIS_URL="redis://127.0.0.1:$redis_port"
export ADMIN_ORIGIN="http://127.0.0.1:$NITRO_PORT" PUBLIC_ADMIN_ORIGIN="http://127.0.0.1:$NITRO_PORT" NUXT_API_INTERNAL_BASE="http://127.0.0.1:$API_PORT/api/v1"
export QA_API_ORIGIN="http://127.0.0.1:$API_PORT" QA_ADMIN_ORIGIN="$ADMIN_ORIGIN" QA_ORIGIN="$ADMIN_ORIGIN" QA_DISPOSABLE=1
export STANDALONE_STATE_ROOT="$scratch/installation" STANDALONE_ADMIN_USERNAME=fixture-owner STANDALONE_ADMIN_PASSWORD_FILE="$scratch/pass"
export QA_OWNER_CREDENTIALS="$scratch/credentials.json" QA_ADMIN_LOGIN="$STANDALONE_ADMIN_USERNAME"
export ADMIN_STATE_PATH="$scratch/admin" STORAGE_PATH="$scratch/files" STORAGE_STATE_PATH="$scratch/storage" BACKUP_PATH="$scratch/backups" BACKUP_KEY_PATH="$scratch/keys"
export NODE_ENV=production
export QA_ADMIN_PASSWORD=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")
node -e "const fs=require('fs');fs.writeFileSync(process.env.STANDALONE_ADMIN_PASSWORD_FILE,process.env.QA_ADMIN_PASSWORD);fs.writeFileSync(process.env.QA_OWNER_CREDENTIALS,JSON.stringify({username:process.env.QA_ADMIN_LOGIN,password:process.env.QA_ADMIN_PASSWORD}))"
mysqld --no-defaults --initialize-insecure --datadir="$scratch/mysql" --log-error="$scratch/mysql-init.log"
mysqld --no-defaults --secure-file-priv=NULL --datadir="$scratch/mysql" --socket="$scratch/mysql.sock" --skip-networking --mysqlx=OFF --pid-file="$scratch/mysql.pid" --innodb-buffer-pool-size=64M --log-error="$scratch/mysql.log" &
children+=($!)
for i in {1..60};do mysqladmin --no-defaults --socket="$scratch/mysql.sock" -uroot ping --silent 2>/dev/null && break; kill -0 "${children[0]}";sleep 1; done
mysql --no-defaults --socket="$scratch/mysql.sock" -uroot -e 'CREATE DATABASE qc_fixture_enterprise'
redis-server --port "$redis_port" --bind 127.0.0.1 --save "" --appendonly no --dir "$scratch" >"$scratch/redis.log" 2>&1 &
children+=($!)
node scripts/install-standalone.mjs
node scripts/install-standalone.mjs
node apps/api/dist/main.js >"$scratch/api.log" 2>&1 &
api_pid=$!
children+=("$api_pid")
node apps/admin/.output/server/index.mjs >"$scratch/web.log" 2>&1 &
web_pid=$!
children+=("$web_pid")
for i in {1..80};do
  if curl -fsS --max-time 2 "$QA_API_ORIGIN/health" >/dev/null 2>&1 && curl -fsS --max-time 4 "$QA_ORIGIN/admin/login" >/dev/null 2>&1;then break;fi
  if ! kill -0 "$api_pid" "$web_pid";then tail -n 10 "$scratch/api.log" "$scratch/web.log";exit 1;fi
  sleep 1
done
node apps/api/test/standalone-benefits-http.check.mjs
node apps/api/test/standalone-maintenance-http.check.mjs
node apps/admin/test/enterprise-preview.check.mjs
node apps/admin/test/enterprise-module-screens.mjs
