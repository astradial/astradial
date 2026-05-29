#!/bin/bash
# wg1-bootstrap.sh
#
# One-time-per-VPS setup for the customer-tunnels WireGuard interface.
# Run once on each cloud VPS to install:
#
#   1. Server WireGuard keypair at /etc/wireguard/wg1.private + .public
#   2. iptables helper at /usr/local/sbin/customer-tunnels-iptables.sh
#   3. /etc/wireguard/wg1.conf with no peers (peers added later via API)
#   4. ufw rule for UDP 51821
#   5. systemd unit wg-quick@wg1 enabled + started
#
# Properties:
#
#   • Idempotent — every step check-then-acts; safe to re-run.
#   • Three modes:
#       --check    : print current state, no changes (read-only)
#       --dry-run  : print what each step would do, no changes
#       (none)     : actually run
#   • Pre-flight checks — verifies dependencies + no conflicts before changes
#   • Strict bash — fail on first error, fail on unset vars
#   • Logging — clear PASS/SKIP/RUN/WOULD/FAIL markers, color in TTY
#   • Atomic file writes — write to tmp then rename
#   • Documented rollback — see README.md or the "ROLLBACK" comment block below
#
# Usage:
#   sudo bash scripts/setup/wg1-bootstrap.sh --check
#   sudo bash scripts/setup/wg1-bootstrap.sh --dry-run
#   sudo bash scripts/setup/wg1-bootstrap.sh
#
# Configurable via env (defaults match docs/features/customer-tunnels.md):
#   WG1_INTERFACE          (default: wg1)
#   WG1_PORT               (default: 51821)
#   WG1_INTERFACE_IP       (default: 10.20.0.1/16)
#   WG1_CONFIG_PATH        (default: /etc/wireguard/wg1.conf)
#   WG1_PRIVATE_KEY_PATH   (default: /etc/wireguard/wg1.private)
#   WG1_PUBLIC_KEY_PATH    (default: /etc/wireguard/wg1.public)
#   WG1_IPTABLES_INSTALL   (default: /usr/local/sbin/customer-tunnels-iptables.sh)
#
# ROLLBACK (manual, in order):
#   systemctl disable --now wg-quick@wg1
#   rm -f /etc/wireguard/wg1.conf /etc/wireguard/wg1.private /etc/wireguard/wg1.public
#   rm -f /usr/local/sbin/customer-tunnels-iptables.sh
#   ufw delete allow 51821/udp
#   # iptables rules are auto-removed by wg-quick PostDown when the service stops
#
# Exit codes:
#   0 = success or already-done (check/dry-run also 0 when state matches)
#   1 = usage error / unknown flag
#   2 = pre-flight check failed (missing dependency, conflict, etc.)
#   3 = bootstrap step failed
#
# See: docs/features/customer-tunnels.md → "Bootstrap procedure"

set -euo pipefail

# ─── Configuration (env-overridable, defaults match design doc) ───────────

readonly INTERFACE="${WG1_INTERFACE:-wg1}"
readonly PORT="${WG1_PORT:-51821}"
readonly INTERFACE_IP="${WG1_INTERFACE_IP:-10.20.0.1/16}"
readonly CONFIG_PATH="${WG1_CONFIG_PATH:-/etc/wireguard/wg1.conf}"
readonly PRIVATE_KEY_PATH="${WG1_PRIVATE_KEY_PATH:-/etc/wireguard/wg1.private}"
readonly PUBLIC_KEY_PATH="${WG1_PUBLIC_KEY_PATH:-/etc/wireguard/wg1.public}"
readonly IPTABLES_INSTALL="${WG1_IPTABLES_INSTALL:-/usr/local/sbin/customer-tunnels-iptables.sh}"

# Where this script lives — its companion iptables script is alongside it
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly IPTABLES_SOURCE="$SCRIPT_DIR/customer-tunnels-iptables.sh"

readonly TOTAL_STEPS=5

# ─── Mode parsing ─────────────────────────────────────────────────────────

MODE="run"
for arg in "$@"; do
  case "$arg" in
    --check)   MODE="check" ;;
    --dry-run) MODE="dry-run" ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# ─── Output helpers ───────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_DIM=""; C_BOLD=""; C_RESET=""
fi

step()   { echo; echo "${C_BOLD}${C_BLUE}[$1/$TOTAL_STEPS]${C_RESET} ${C_BOLD}$2${C_RESET}"; }
ok()     { printf "  %sPASS%s  %s\n" "$C_GREEN" "$C_RESET" "$1"; }
skip()   { printf "  %sSKIP%s  %s\n" "$C_YELLOW" "$C_RESET" "$1"; }
runmsg() { printf "  %sRUN %s  %s\n" "$C_BLUE" "$C_RESET" "$1"; }
would()  { printf "  %sWOULD%s %s\n" "$C_YELLOW" "$C_RESET" "$1"; }
# fail() preserves embedded newlines in the message (printf %s) — important
# for surfacing systemctl/journal output when a step fails verbosely.
fail()   { printf "  %sFAIL%s  %s\n" "$C_RED" "$C_RESET" "$1" >&2; exit 3; }
warn()   { printf "  %sWARN%s  %s\n" "$C_YELLOW" "$C_RESET" "$1"; }
note()   { printf "  %snote: %s%s\n" "$C_DIM" "$1" "$C_RESET"; }
header() {
  echo
  echo "${C_BOLD}========================================================================"
  echo "  $1"
  echo "========================================================================${C_RESET}"
}

# ─── Pre-flight checks ────────────────────────────────────────────────────

preflight() {
  header "Pre-flight checks — mode=$MODE"

  # Must run as root
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "${C_RED}This script must be run as root.${C_RESET}" >&2
    echo "Try: sudo bash $0 $*" >&2
    exit 2
  fi
  ok "root privileges"

  # Required binaries
  for bin in wg wg-quick systemctl iptables ufw logger install; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "${C_RED}Required binary not found: $bin${C_RESET}" >&2
      echo "On Debian/Ubuntu: apt install wireguard-tools iptables ufw" >&2
      exit 2
    fi
  done
  ok "all required binaries present (wg, wg-quick, systemctl, iptables, ufw, logger, install)"

  # Companion iptables script must be alongside this one (we install it)
  if [[ ! -f "$IPTABLES_SOURCE" ]]; then
    echo "${C_RED}Missing companion script: $IPTABLES_SOURCE${C_RESET}" >&2
    echo "This script expects customer-tunnels-iptables.sh in the same directory." >&2
    exit 2
  fi
  ok "companion iptables script found at $IPTABLES_SOURCE"

  # Internal infra wg0 should exist (sanity — confirms we're on a fully-configured cloud)
  if ! ip link show wg0 >/dev/null 2>&1; then
    warn "wg0 interface not found — this VPS may not be set up for internal infra (NUC/staging tunnels)"
    note "Bootstrap will continue, but if wg0 is supposed to be here, investigate before proceeding."
  else
    ok "wg0 internal infra interface present"
  fi

  # Conflict: port already bound?
  if ss -ulpn 2>/dev/null | awk '{print $5}' | grep -qE ":${PORT}\$"; then
    if [[ "$(wg show "$INTERFACE" listen-port 2>/dev/null)" == "$PORT" ]]; then
      ok "UDP port $PORT is bound to existing $INTERFACE (re-running bootstrap)"
    else
      echo "${C_RED}UDP port $PORT is bound by something other than $INTERFACE.${C_RESET}" >&2
      ss -ulpn | grep ":$PORT" >&2 || true
      exit 2
    fi
  else
    ok "UDP port $PORT is free"
  fi

  # Conflict: subnet already routed elsewhere?
  local subnet_net="${INTERFACE_IP%/*}"
  if ip route show | grep -E "^10\\.20\\.[0-9]+\\.[0-9]+/" | grep -v "dev $INTERFACE" >/dev/null 2>&1; then
    warn "Routes in 10.20.x exist outside $INTERFACE — verify no overlap with customer tunnel pool"
    ip route show | grep -E "^10\\.20\\." | sed 's/^/      /' || true
  else
    ok "subnet 10.20.0.0/16 (interface IP $INTERFACE_IP) free of conflicting routes"
  fi

  ok "pre-flight passed"
}

# ─── Step 1: keypair ──────────────────────────────────────────────────────

step_keypair() {
  step 1 "Server WireGuard keypair"

  if [[ -f "$PRIVATE_KEY_PATH" && -f "$PUBLIC_KEY_PATH" ]]; then
    local priv_perms
    priv_perms=$(stat -c '%a %U:%G' "$PRIVATE_KEY_PATH")
    if [[ "$priv_perms" != "600 root:root" ]]; then
      warn "private key at $PRIVATE_KEY_PATH has perms '$priv_perms' (expected '600 root:root')"
      if [[ "$MODE" == "run" ]]; then
        chmod 600 "$PRIVATE_KEY_PATH"
        chown root:root "$PRIVATE_KEY_PATH"
        runmsg "fixed permissions on $PRIVATE_KEY_PATH"
      elif [[ "$MODE" == "dry-run" ]]; then
        would "chmod 600 + chown root:root on $PRIVATE_KEY_PATH"
      fi
    fi
    skip "keypair exists at $PRIVATE_KEY_PATH and $PUBLIC_KEY_PATH"
    return 0
  fi

  if [[ "$MODE" != "run" ]]; then
    would "generate WG keypair at $PRIVATE_KEY_PATH and $PUBLIC_KEY_PATH"
    return 0
  fi

  mkdir -p "$(dirname "$PRIVATE_KEY_PATH")"
  ( umask 077
    wg genkey | tee "$PRIVATE_KEY_PATH" | wg pubkey > "$PUBLIC_KEY_PATH" )
  chmod 600 "$PRIVATE_KEY_PATH"
  chmod 644 "$PUBLIC_KEY_PATH"
  chown root:root "$PRIVATE_KEY_PATH" "$PUBLIC_KEY_PATH"
  runmsg "generated keypair at $PRIVATE_KEY_PATH and $PUBLIC_KEY_PATH"
  note "server public key: $(cat "$PUBLIC_KEY_PATH")"
}

# ─── Step 2: iptables helper ──────────────────────────────────────────────

step_iptables_script() {
  step 2 "Install iptables helper at $IPTABLES_INSTALL"

  if [[ -f "$IPTABLES_INSTALL" ]] && cmp -s "$IPTABLES_SOURCE" "$IPTABLES_INSTALL"; then
    skip "iptables helper already installed and matches source"
    return 0
  fi

  if [[ -f "$IPTABLES_INSTALL" ]]; then
    if [[ "$MODE" == "run" ]]; then
      cp -p "$IPTABLES_INSTALL" "${IPTABLES_INSTALL}.bak-$(date +%s)"
      note "backed up existing $IPTABLES_INSTALL to ${IPTABLES_INSTALL}.bak-<ts>"
    elif [[ "$MODE" == "dry-run" ]]; then
      would "back up existing $IPTABLES_INSTALL"
    fi
  fi

  if [[ "$MODE" != "run" ]]; then
    would "install $IPTABLES_SOURCE → $IPTABLES_INSTALL with mode 755 root:root"
    return 0
  fi

  install -o root -g root -m 755 "$IPTABLES_SOURCE" "$IPTABLES_INSTALL"
  runmsg "installed $IPTABLES_INSTALL"
}

# ─── Step 3: wg1.conf ─────────────────────────────────────────────────────

step_config_file() {
  step 3 "WireGuard config at $CONFIG_PATH"

  local desired_config
  desired_config=$(cat <<EOF
[Interface]
Address = $INTERFACE_IP
ListenPort = $PORT
PrivateKey = $(cat "$PRIVATE_KEY_PATH" 2>/dev/null || echo "<not yet generated>")
PostUp = $IPTABLES_INSTALL up
PostDown = $IPTABLES_INSTALL down

# Peers are added/removed automatically by AstraPBX (wireguardApplier).
# DO NOT EDIT BY HAND — see docs/features/customer-tunnels.md
EOF
)

  if [[ -f "$CONFIG_PATH" ]]; then
    if diff -q <(echo "$desired_config") "$CONFIG_PATH" >/dev/null 2>&1; then
      skip "$CONFIG_PATH already matches desired content"
      return 0
    fi
    # File exists but doesn't match. If peers are present, do NOT clobber.
    if grep -qE '^\[Peer\]' "$CONFIG_PATH"; then
      warn "$CONFIG_PATH exists and contains [Peer] blocks — refusing to overwrite"
      note "AstraPBX's wireguardApplier is responsible for managing peer entries."
      note "If bootstrap config needs an update, edit interface block manually or DELETE peers first."
      return 0
    fi
    if [[ "$MODE" == "run" ]]; then
      cp -p "$CONFIG_PATH" "${CONFIG_PATH}.bak-$(date +%s)"
      note "backed up existing $CONFIG_PATH"
    elif [[ "$MODE" == "dry-run" ]]; then
      would "back up existing $CONFIG_PATH"
    fi
  fi

  if [[ "$MODE" != "run" ]]; then
    would "write $CONFIG_PATH (mode 600 root:root) with interface block + no peers"
    return 0
  fi

  if [[ ! -f "$PRIVATE_KEY_PATH" ]]; then
    fail "private key missing at $PRIVATE_KEY_PATH (step 1 didn't run successfully)"
  fi

  local tmp
  tmp=$(mktemp "${CONFIG_PATH}.new.XXXXXX")
  echo "$desired_config" > "$tmp"
  chmod 600 "$tmp"
  chown root:root "$tmp"
  mv -f "$tmp" "$CONFIG_PATH"
  runmsg "wrote $CONFIG_PATH"
}

# ─── Step 4: ufw allow ────────────────────────────────────────────────────

step_ufw() {
  step 4 "ufw allow $PORT/udp (WireGuard customer tunnels)"

  if ufw status verbose 2>/dev/null | grep -qE "^${PORT}/udp\s+ALLOW"; then
    skip "ufw rule already present for $PORT/udp"
    return 0
  fi

  if [[ "$MODE" != "run" ]]; then
    would "ufw allow $PORT/udp comment 'WireGuard customer tunnels'"
    return 0
  fi

  if ! ufw status | grep -qE "^Status: active"; then
    warn "ufw is INACTIVE — adding rule but it won't be enforced until 'ufw enable'"
  fi

  ufw allow "$PORT/udp" comment 'WireGuard customer tunnels' >/dev/null
  runmsg "ufw rule added for $PORT/udp"
}

# ─── Step 5: systemd ──────────────────────────────────────────────────────

step_systemd() {
  step 5 "systemd: enable + start wg-quick@$INTERFACE"

  local enabled active
  enabled=$(systemctl is-enabled "wg-quick@$INTERFACE" 2>/dev/null || echo "disabled")
  active=$(systemctl is-active  "wg-quick@$INTERFACE" 2>/dev/null || echo "inactive")

  if [[ "$enabled" == "enabled" && "$active" == "active" ]]; then
    skip "wg-quick@$INTERFACE already enabled and active"
    return 0
  fi

  if [[ "$MODE" != "run" ]]; then
    [[ "$enabled" != "enabled" ]] && would "systemctl enable wg-quick@$INTERFACE"
    [[ "$active"  != "active"  ]] && would "systemctl start  wg-quick@$INTERFACE"
    return 0
  fi

  systemctl enable --now "wg-quick@$INTERFACE"
  sleep 1
  if ! systemctl is-active --quiet "wg-quick@$INTERFACE"; then
    local svc_err
    svc_err=$(systemctl status "wg-quick@$INTERFACE" --no-pager 2>&1 | tail -20 || true)
    # Use real newlines, not \n — fail() preserves them via printf
    fail "wg-quick@$INTERFACE did not become active.
Journal (last 20 lines):
$svc_err"
  fi
  runmsg "wg-quick@$INTERFACE enabled and started"
}

# ─── Verification ─────────────────────────────────────────────────────────

verify() {
  header "Verification"

  if ! ip link show "$INTERFACE" >/dev/null 2>&1; then
    if [[ "$MODE" != "run" ]]; then
      note "interface $INTERFACE not yet up (expected — we're in $MODE mode)"
      return 0
    fi
    fail "interface $INTERFACE is not up after bootstrap"
  fi

  ok "interface $INTERFACE is up"
  echo "      $(ip -brief addr show "$INTERFACE" 2>/dev/null || true)"

  if wg show "$INTERFACE" >/dev/null 2>&1; then
    local peer_count
    peer_count=$(wg show "$INTERFACE" peers 2>/dev/null | wc -l)
    ok "wg show $INTERFACE responds — $peer_count peer(s) configured"
  else
    if [[ "$MODE" == "run" ]]; then
      fail "wg show $INTERFACE did not respond"
    fi
  fi

  if iptables -L FORWARD -v -n 2>/dev/null | grep -q "$INTERFACE"; then
    ok "iptables FORWARD rules are in place for $INTERFACE"
  else
    if [[ "$MODE" == "run" ]]; then
      warn "iptables FORWARD rules not detected — PostUp may have failed"
      note "Check: journalctl -t wg1-iptables -n 50"
    fi
  fi

  local pubkey
  if [[ -f "$PUBLIC_KEY_PATH" ]]; then
    pubkey=$(cat "$PUBLIC_KEY_PATH")
    ok "server public key (paste into customer router peer config):"
    echo "      ${C_BOLD}$pubkey${C_RESET}"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────

header "Astradial customer tunnels — wg1 bootstrap"
echo "  Interface:           $INTERFACE"
echo "  Address:             $INTERFACE_IP"
echo "  ListenPort:          $PORT"
echo "  Config path:         $CONFIG_PATH"
echo "  Private key path:    $PRIVATE_KEY_PATH"
echo "  iptables helper:     $IPTABLES_INSTALL"
echo "  Mode:                $MODE"

preflight

step_keypair
step_iptables_script
step_config_file
step_ufw
step_systemd

verify

header "Bootstrap complete (mode=$MODE)"

if [[ "$MODE" == "run" ]]; then
  echo "  Next steps:"
  echo "    1. Add CLOUD_PUBLIC_IP=<this VPS public IP> to /app/.env (if not already)"
  echo "    2. Restart astrapbx to pick up the env: pm2 reload astrapbx --update-env"
  echo "    3. Create a tunnel via editor.example.com → Trunks → Network Tunnels"
  echo "    4. The wg-poller will start writing tunnel_metrics rows within 60s"
elif [[ "$MODE" == "check" ]]; then
  echo "  No changes were made. Re-run without --check to apply."
elif [[ "$MODE" == "dry-run" ]]; then
  echo "  No changes were made. Re-run without --dry-run to apply."
fi
echo
