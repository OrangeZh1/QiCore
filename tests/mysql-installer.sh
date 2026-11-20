#!/usr/bin/env bash
set -euo pipefail
scratch=$(mktemp -d)
pid=''
finish() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" || true; fi
  if [[ "$scratch" == /tmp/tmp.* ]]; then rm -rf -- "$scratch"; fi
}
trap finish EXIT
mysqld --no-defaults --initialize-insecure --datadir="$scratch/data" --log-error="$scratch/init.log"
mysqld --no-defaults --secure-file-priv=NULL --datadir="$scratch/data" --socket="$scratch/db.sock" --skip-networking --mysqlx=OFF --pid-file="$scratch/pid" --innodb-buffer-pool-size=64M --log-error="$scratch/db.log" &
pid=$!
for i in {1..90}; do
  if mysqladmin --no-defaults --socket="$scratch/db.sock" -uroot ping --silent 2>/dev/null; then break; fi
  kill -0 "$pid"; sleep 1
done
mysql --no-defaults --socket="$scratch/db.sock" -uroot -e 'CREATE DATABASE qc_fixture_install; CREATE DATABASE qc_fixture_cli; CREATE DATABASE qc_fixture_foreign; CREATE TABLE qc_fixture_foreign.protected_data (id INT PRIMARY KEY);'
export DATABASE_URL="mysql://root@localhost/qc_fixture_install?socket=$scratch/db.sock"
export INSTALLER_TEST_ROOT="$scratch/runtime"
node tests/installer.integration.mjs
if [[ "${1:-}" == --with-web ]]; then
  mysql --no-defaults --socket="$scratch/db.sock" -uroot -e 'CREATE DATABASE qc_fixture_web'
  export DATABASE_URL="mysql://root@localhost/qc_fixture_web?socket=$scratch/db.sock"
  node tests/example.web.mjs
fi
