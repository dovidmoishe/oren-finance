#!/usr/bin/env bash
# Bootstrap rollback provenance from the actually running production containers,
# never from an editable registry tag or GitHub release description.
set -euo pipefail
[[ $EUID == 0 ]]
owner=$(sed -n 's/^GHCR_OWNER=//p' /opt/oren/.release.env)
sha=$(sed -n 's/^IMAGE_TAG=//p' /opt/oren/.release.env)
[[ "$owner" =~ ^[a-z0-9-]+$ && "$sha" =~ ^[a-f0-9]{40}$ ]]
reported=$(curl --fail --silent --show-error https://api.oren.finance/api/environment | jq -er '.commitSha')
[[ "$reported" == "$sha" ]]
images=()
for service in api app; do
  id=$(docker inspect --format '{{.Image}}' "oren-$service-1")
  reference=$(docker image inspect "$id" --format '{{json .RepoDigests}}' | jq -er --arg p "ghcr.io/$owner/oren-$service@" '[.[] | select(startswith($p))][0]')
  [[ "$reference" =~ @sha256:[a-f0-9]{64}$ ]]
  images+=("$reference")
done
install -d -o deploy -g deploy -m 750 /opt/oren/releases
record=$(mktemp "/opt/oren/releases/.$sha.XXXXXX")
trap 'rm -f -- "$record"' EXIT
printf 'OREN_API_IMAGE=%s\nOREN_APP_IMAGE=%s\n' "${images[0]}" "${images[1]}" > "$record"
if [[ -f "/opt/oren/releases/$sha.env" ]]; then
  cmp "$record" "/opt/oren/releases/$sha.env"
else
  chown deploy:deploy "$record"
  chmod 640 "$record"
  mv "$record" "/opt/oren/releases/$sha.env"
fi
printf 'Verified current production rollback record: %s\n' "$sha"
