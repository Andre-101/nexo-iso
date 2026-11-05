#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec bash scripts/prepare-vps-secrets.sh "$(pwd)/.local-secrets"
