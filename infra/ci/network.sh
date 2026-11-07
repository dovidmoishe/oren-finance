#!/usr/bin/env bash
# Root-owned rules affect only the dedicated unprivileged build identity.
set -euo pipefail
[[ $EUID == 0 ]]
ACCOUNT=oren-ci-build
ID=$(id -u "$ACCOUNT")
[[ "$ID" -ge 1001 ]]
iptables -w -N OREN_CI_EGRESS 2>/dev/null || true
iptables -w -F OREN_CI_EGRESS
# Local DNS and loopback test servers are needed. Host administrative endpoints
# and production Docker subnets are not part of a build's authority.
iptables -w -A OREN_CI_EGRESS -d 127.0.0.53/32 -p udp --dport 53 -j RETURN
iptables -w -A OREN_CI_EGRESS -d 127.0.0.53/32 -p tcp --dport 53 -j RETURN
iptables -w -A OREN_CI_EGRESS -d 127.0.0.0/8 -p tcp -m multiport --dports 22,80,443,2019,2375,2376 -j REJECT
iptables -w -A OREN_CI_EGRESS -d 127.0.0.0/8 -j RETURN
for subnet in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  iptables -w -A OREN_CI_EGRESS -d "$subnet" -j REJECT
done
iptables -w -A OREN_CI_EGRESS -j RETURN
owners=("$ID")
while IFS=: read -r account first count; do
  [[ "$account" == "$ACCOUNT" ]] || continue
  owners+=("$first-$((first+count-1))")
done < /etc/subuid
for owner in "${owners[@]}"; do
  iptables -w -C OUTPUT -m owner --uid-owner "$owner" -j OREN_CI_EGRESS 2>/dev/null ||
    iptables -w -I OUTPUT 1 -m owner --uid-owner "$owner" -j OREN_CI_EGRESS
done
ip6tables -w -N OREN_CI_EGRESS 2>/dev/null || true
ip6tables -w -F OREN_CI_EGRESS
ip6tables -w -A OREN_CI_EGRESS -d ::1/128 -p tcp -m multiport --dports 22,80,443,2019,2375,2376 -j REJECT
ip6tables -w -A OREN_CI_EGRESS -d ::1/128 -j RETURN
for subnet in fc00::/7 fe80::/10; do ip6tables -w -A OREN_CI_EGRESS -d "$subnet" -j REJECT; done
ip6tables -w -A OREN_CI_EGRESS -j RETURN
for owner in "${owners[@]}"; do
  ip6tables -w -C OUTPUT -m owner --uid-owner "$owner" -j OREN_CI_EGRESS 2>/dev/null ||
    ip6tables -w -I OUTPUT 1 -m owner --uid-owner "$owner" -j OREN_CI_EGRESS
done
