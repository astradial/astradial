#!/bin/bash
# customer-tunnels-iptables.sh
#
# Called by wg-quick at interface up/down via PostUp/PostDown directives in
# /etc/wireguard/wg1.conf. Installs/removes iptables rules that:
#
#   1. DROP customer→internal-infra traffic (wg1 ↔ wg0 blocked)
#   2. DROP customer→customer traffic (wg1 ↔ wg1 blocked)
#   3. ACCEPT only SIP signaling (UDP 5060, 5080) and RTP media (UDP 10000–20000)
#      from wg1 — everything else from wg1 is dropped at INPUT
#
# Idempotent: uses `iptables -C` to check-before-add and `|| true` on
# remove to tolerate already-clean state. Safe to run repeatedly.
#
# Logging: every action goes to syslog via `logger`, tagged "wg1-iptables".
# Operators can trace via: journalctl -t wg1-iptables -f
#
# Usage (typically not invoked directly — wg-quick calls it):
#   /usr/local/sbin/customer-tunnels-iptables.sh up    # install rules
#   /usr/local/sbin/customer-tunnels-iptables.sh down  # remove rules
#
# Exit codes:
#   0 = success (or already-in-desired-state)
#   2 = usage error
#   3 = iptables command not found
#
# Design references: docs/features/customer-tunnels.md (security model section)

set -uo pipefail
# NOTE: we deliberately do NOT use `set -e` here. Individual rule operations
# may legitimately fail (e.g., during `down`, a rule may already be removed).
# We handle each command's exit code inline.

readonly CUSTOMER_IFACE="${WG1_INTERFACE:-wg1}"
readonly INFRA_IFACE="${WG0_INTERFACE:-wg0}"
readonly TAG="wg1-iptables"

log() { logger -t "$TAG" -- "$@"; echo "[$TAG] $*"; }
err() { logger -t "$TAG" -p user.err -- "$@"; echo "[$TAG] ERROR: $*" >&2; }

# Verify iptables is available.
if ! command -v iptables >/dev/null 2>&1; then
  err "iptables not found on PATH — cannot proceed"
  exit 3
fi

# ─── Rule definitions ─────────────────────────────────────────────────────
# Each rule is (chain, full-spec-without-action) — for FORWARD/INPUT chains.
# We add `-j DROP` or `-j ACCEPT` separately when executing.

# FORWARD rules — DROP cross-interface traffic
declare -a FORWARD_DROP_RULES=(
  "-i $CUSTOMER_IFACE -o $INFRA_IFACE"   # customer → infra
  "-i $INFRA_IFACE -o $CUSTOMER_IFACE"   # infra → customer (responses)
  "-i $CUSTOMER_IFACE -o $CUSTOMER_IFACE" # customer → customer
)

# INPUT rules — ACCEPT only SIP/RTP from wg1
declare -a INPUT_ACCEPT_RULES=(
  "-i $CUSTOMER_IFACE -p udp --dport 5060"
  "-i $CUSTOMER_IFACE -p udp --dport 5080"
  "-i $CUSTOMER_IFACE -p udp --dport 10000:20000"
)

# INPUT catch-all DROP — everything else from wg1 is dropped.
# Important: this must be the LAST INPUT rule we add (and FIRST we remove)
# so the ACCEPT rules above take priority.
readonly INPUT_DROP_CATCHALL="-i $CUSTOMER_IFACE"

# ─── Helpers ──────────────────────────────────────────────────────────────

# rule_present <chain> <rule-spec> <action>
# Returns 0 if rule exists, 1 if not. Wraps `iptables -C`.
rule_present() {
  local chain="$1"; shift
  iptables -C "$chain" $@ >/dev/null 2>&1
}

# add_rule <chain> <rule-spec...> <-j ACTION>
# Idempotently add a rule. Logs SKIP if already present, ADD if added.
add_rule() {
  local chain="$1"; shift
  # shellcheck disable=SC2068
  if rule_present "$chain" $@; then
    log "SKIP: $chain $* (already present)"
    return 0
  fi
  # shellcheck disable=SC2068
  if iptables -A "$chain" $@; then
    log "ADD: $chain $*"
    return 0
  fi
  err "FAIL: iptables -A $chain $* — exit $?"
  return 1
}

# del_rule <chain> <rule-spec...>
# Idempotently remove. Logs SKIP if absent, REMOVE if removed.
del_rule() {
  local chain="$1"; shift
  # shellcheck disable=SC2068
  if ! rule_present "$chain" $@; then
    log "SKIP: $chain $* (already absent)"
    return 0
  fi
  # shellcheck disable=SC2068
  if iptables -D "$chain" $@; then
    log "REMOVE: $chain $*"
    return 0
  fi
  err "WARN: iptables -D $chain $* — exit $? (continuing)"
  return 0  # tolerate failure in `down` path
}

# ─── Main: up / down ──────────────────────────────────────────────────────

up() {
  log "Applying iptables rules for $CUSTOMER_IFACE (infra=$INFRA_IFACE)"

  # 1. FORWARD drops (block customer ↔ infra, customer ↔ customer)
  for rule in "${FORWARD_DROP_RULES[@]}"; do
    add_rule FORWARD $rule -j DROP || return 1
  done

  # 2. INPUT accepts for SIP/RTP
  for rule in "${INPUT_ACCEPT_RULES[@]}"; do
    add_rule INPUT $rule -j ACCEPT || return 1
  done

  # 3. INPUT catch-all DROP (must come AFTER the ACCEPTs so they take priority)
  add_rule INPUT $INPUT_DROP_CATCHALL -j DROP || return 1

  log "up: complete"
}

down() {
  log "Removing iptables rules for $CUSTOMER_IFACE"

  # Remove in reverse order — catch-all DROP first so ACCEPTs don't briefly
  # have nothing under them
  del_rule INPUT $INPUT_DROP_CATCHALL -j DROP

  for rule in "${INPUT_ACCEPT_RULES[@]}"; do
    del_rule INPUT $rule -j ACCEPT
  done

  for rule in "${FORWARD_DROP_RULES[@]}"; do
    del_rule FORWARD $rule -j DROP
  done

  log "down: complete"
}

# ─── Entry point ──────────────────────────────────────────────────────────

case "${1:-}" in
  up)   up ;;
  down) down ;;
  *)
    err "Usage: $0 {up|down}"
    exit 2
    ;;
esac
