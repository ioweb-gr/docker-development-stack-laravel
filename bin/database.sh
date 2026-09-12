#!/usr/bin/env sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
exec node "$(dirname -- "$0")/../src/cli.js" database --project-root "$project_root" "$@"
