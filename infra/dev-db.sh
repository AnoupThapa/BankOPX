#!/usr/bin/env bash
# Local/dev/CI database bootstrap. Synthetic data only (SEC-09). Passwords here are throwaway dev values, never used outside local/CI.
set -euo pipefail
PSQL=${PSQL:-"psql -h localhost -U postgres"}
$PSQL -c "create role bbjp_owner login password 'dev_owner_pw' createdb" \
      -c "create role bbjp_app login password 'dev_app_pw'" \
      -c "create database bbjp_dev owner bbjp_owner" \
      -c "create database bbjp_test owner bbjp_owner"
echo "Run migrations: MIGRATION_DATABASE_URL=postgres://bbjp_owner:dev_owner_pw@localhost:5432/bbjp_dev npm run migrate -w @bbjp/core"
