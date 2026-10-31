#!/usr/bin/env bash
set -euo pipefail
# A production update can recreate Caddy and discard dynamically attached networks.
while IFS= read -r network; do
  [[ "$network" =~ ^oren-pr-[1-9][0-9]*_edge$ ]] || continue
  docker network connect "$network" oren-caddy-1 2>/dev/null ||
    docker network inspect "$network" | jq -e '.[0].Containers | to_entries | any(.value.Name == "oren-caddy-1")' >/dev/null
done < <(docker network ls --filter label=oren.preview=true --format '{{.Name}}')
