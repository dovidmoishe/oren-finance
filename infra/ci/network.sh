#!/usr/bin/env bash
# Root-owned rules affect only the two dedicated build identities.
set -euo pipefail
[[ $EUID == 0 ]]
for binary in iptables ip6tables; do
  "$binary" -w -N OREN_CI_EGRESS 2>/dev/null || true
  "$binary" -w -F OREN_CI_EGRESS
done
iptables -w -A OREN_CI_EGRESS -d 127.0.0.53/32 -p udp --dport 53 -j RETURN
iptables -w -A OREN_CI_EGRESS -d 127.0.0.53/32 -p tcp --dport 53 -j RETURN
iptables -w -A OREN_CI_EGRESS -d 127.0.0.0/8 -p tcp -m multiport --dports 22,80,443,2019,2375,2376 -j REJECT
iptables -w -A OREN_CI_EGRESS -d 127.0.0.0/8 -j RETURN
for subnet in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  iptables -w -A OREN_CI_EGRESS -d "$subnet" -j REJECT
done
iptables -w -A OREN_CI_EGRESS -j RETURN
ip6tables -w -A OREN_CI_EGRESS -d ::1/128 -p tcp -m multiport --dports 22,80,443,2019,2375,2376 -j REJECT
ip6tables -w -A OREN_CI_EGRESS -d ::1/128 -j RETURN
for subnet in fc00::/7 fe80::/10; do ip6tables -w -A OREN_CI_EGRESS -d "$subnet" -j REJECT; done
ip6tables -w -A OREN_CI_EGRESS -j RETURN
owners=()
for account in oren-ci-build oren-ci-release; do
  id=$(id -u "$account")
  [[ "$id" -ge 1001 ]]
  owners+=("$id")
  while IFS=: read -r name first count; do
    [[ "$name" == "$account" ]] || continue
    owners+=("$first-$((first+count-1))")
  done < /etc/subuid
done
for owner in "${owners[@]}"; do
  for binary in iptables ip6tables; do
    "$binary" -w -C OUTPUT -m owner --uid-owner "$owner" -j OREN_CI_EGRESS 2>/dev/null ||
      "$binary" -w -I OUTPUT 1 -m owner --uid-owner "$owner" -j OREN_CI_EGRESS
  done
done
