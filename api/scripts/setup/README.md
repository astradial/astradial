# scripts/setup

One-time-per-VPS infrastructure setup scripts. Not run automatically by CI.
Operator runs them manually on each cloud VPS.

## `wg1-bootstrap.sh` — customer tunnels WireGuard setup

Prepares a cloud VPS to host customer WireGuard tunnels. Installs the wg1
interface, iptables isolation rules, ufw allow rule, and systemd unit.

### Quick start

```bash
sudo bash scripts/setup/wg1-bootstrap.sh --check     # see current state, NO changes
sudo bash scripts/setup/wg1-bootstrap.sh --dry-run   # preview what would change, NO changes
sudo bash scripts/setup/wg1-bootstrap.sh             # actually run it
```

The script is **idempotent** — safe to re-run any number of times. Already-done
steps are skipped.

### What it does (5 steps)

1. **Generates a server WG keypair** at `/etc/wireguard/wg1.private` (mode 600)
   and `/etc/wireguard/wg1.public` (mode 644)
2. **Installs `customer-tunnels-iptables.sh`** to `/usr/local/sbin/` — the helper
   that adds firewall rules when wg1 comes up
3. **Writes `/etc/wireguard/wg1.conf`** with the `[Interface]` block. No `[Peer]`
   blocks — those are added later by AstraPBX (`wireguardApplier`) when
   operators create tunnels via the API
4. **Opens UDP 51821 in ufw**
5. **Enables and starts `wg-quick@wg1`** systemd unit

### Pre-flight checks (script aborts if any fail)

- Running as root
- `wg`, `wg-quick`, `systemctl`, `iptables`, `ufw`, `logger`, `install` all on PATH
- Companion `customer-tunnels-iptables.sh` exists in the same directory
- UDP 51821 is free (or already bound by this same interface)
- No conflicting routes in `10.20.0.0/16`

Warnings (don't abort, but printed):

- `wg0` not present (cloud may not be fully set up for internal infra)
- `ufw` inactive (rule added but won't be enforced)
- Existing routes in 10.20.x outside wg1 (verify no overlap with customer pool)

### After running

The script prints the server's WG public key. Then:

1. Set `CLOUD_PUBLIC_IP=<this VPS public IP>` in `/app/.env` if not
   already set
2. Restart astrapbx so it picks up the env: `pm2 reload astrapbx --update-env`
3. Create a customer tunnel via `editor.example.com` → org → Trunks →
   Network Tunnels → + Add Tunnel
4. The `wg-poller` (in astrapbx) will start writing `tunnel_metrics` rows within 60s

### Verification (post-run)

```bash
# Service status
systemctl status wg-quick@wg1 --no-pager

# Interface present
ip -brief addr show wg1

# wg responds (initially no peers — that's normal)
wg show wg1

# iptables rules in place
iptables -L FORWARD -v -n | grep wg1
iptables -L INPUT   -v -n | grep wg1

# ufw rule present
ufw status verbose | grep 51821

# Listening on UDP 51821
ss -ulpn | grep 51821

# astrapbx wg-poller logs change from "wg show failed" to snapshot writes
pm2 logs astrapbx --lines 50 | grep -E "wg-poller|tunnel_metric"
```

### Rollback (in order)

```bash
# Stop and disable the service
systemctl disable --now wg-quick@wg1

# Remove config + keys
rm -f /etc/wireguard/wg1.conf
rm -f /etc/wireguard/wg1.private
rm -f /etc/wireguard/wg1.public

# Remove iptables helper
rm -f /usr/local/sbin/customer-tunnels-iptables.sh

# Remove ufw rule
ufw delete allow 51821/udp

# iptables FORWARD/INPUT rules for wg1 are auto-removed by PostDown when
# the service stops. If anything lingers:
iptables -L FORWARD --line-numbers | grep wg1
iptables -L INPUT   --line-numbers | grep wg1
# (delete by line number if needed)
```

Backups of any pre-existing files are kept as `<file>.bak-<timestamp>` in the
same directory.

### Configurable via env vars

```bash
WG1_INTERFACE=wg1                                       # default
WG1_PORT=51821                                          # default
WG1_INTERFACE_IP=10.20.0.1/16                           # default
WG1_CONFIG_PATH=/etc/wireguard/wg1.conf                 # default
WG1_PRIVATE_KEY_PATH=/etc/wireguard/wg1.private         # default
WG1_PUBLIC_KEY_PATH=/etc/wireguard/wg1.public           # default
WG1_IPTABLES_INSTALL=/usr/local/sbin/customer-tunnels-iptables.sh  # default
```

Override on the command line:

```bash
sudo WG1_PORT=51822 bash scripts/setup/wg1-bootstrap.sh
```

---

## `customer-tunnels-iptables.sh` — installed by bootstrap

The iptables helper that the bootstrap script copies to
`/usr/local/sbin/customer-tunnels-iptables.sh`. Not run directly — invoked by
`wg-quick` via `PostUp`/`PostDown` in `wg1.conf`.

### What it does

When wg1 comes **up**:
- DROP `wg1 → wg0` traffic (customers can't reach internal infra)
- DROP `wg0 → wg1` traffic (responses also blocked)
- DROP `wg1 → wg1` traffic (customers can't reach each other)
- ACCEPT `wg1 → INPUT` for UDP 5060, 5080, and 10000–20000 (SIP + RTP)
- DROP everything else from `wg1` at INPUT (customers can't reach SSH, etc.)

When wg1 goes **down**: removes all the above (idempotent — tolerates missing rules).

### Logging

Every action logged to syslog under tag `wg1-iptables`. Trace:

```bash
journalctl -t wg1-iptables -f
```

### Hand-test

```bash
sudo /usr/local/sbin/customer-tunnels-iptables.sh up
sudo /usr/local/sbin/customer-tunnels-iptables.sh down
```

Re-running is safe (idempotent — uses `iptables -C` to check before `-A`/`-D`).

---

## Design references

- `docs/features/customer-tunnels.md` — full feature design + security model
- `docs/customers/v7-network-resilience.md` — the customer scenario that drove this feature
- `docs/architecture/network-security.md` — overall network topology
