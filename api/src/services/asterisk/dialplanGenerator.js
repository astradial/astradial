const { Organization, User, Queue, QueueMember, DidNumber, RoutingRule, Ivr, IvrMenu, OutboundRoute, SipTrunk } = require('../../models');

class DialplanGenerator {
  constructor() {
    this.dialplanContent = new Map(); // contextName -> dialplan content
    this.recordingDir = process.env.ASTERISK_RECORDING_DIR || '/var/spool/asterisk/monitor';
  }

  async ensureRecordingDirectoryExists() {
    const fs = require('fs').promises;
    try {
      await fs.access(this.recordingDir);
      console.log(`✅ Recording directory exists: ${this.recordingDir}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          await fs.mkdir(this.recordingDir, { recursive: true, mode: 0o755 });
          console.log(`✅ Created recording directory: ${this.recordingDir}`);
        } catch (mkdirError) {
          console.warn(`⚠️  Could not create recording directory ${this.recordingDir}:`, mkdirError.message);
          console.warn(`⚠️  Recordings may fail. Please create directory manually or set ASTERISK_RECORDING_DIR`);
        }
      } else {
        console.warn(`⚠️  Cannot access recording directory ${this.recordingDir}:`, error.message);
      }
    }
  }

  async generateDialplansForOrganization(orgId) {
    try {
      console.log(`🎯 Generating dialplans for organization: ${orgId}`);

      const org = await Organization.findByPk(orgId, {
        include: [
          { model: User, as: 'users' },
          {
            model: Queue,
            as: 'queues',
            include: [{
              model: QueueMember,
              as: 'members',
              include: [{ model: User, as: 'user' }]
            }]
          },
          { model: DidNumber, as: 'dids' },
          { model: RoutingRule, as: 'routingRules' },
          {
            model: Ivr,
            as: 'ivrs',
            include: [{ model: IvrMenu, as: 'menuOptions' }]
          },
          {
            model: OutboundRoute,
            as: 'outboundRoutes',
            include: [{ model: SipTrunk, as: 'trunk' }]
          }
        ]
      });

      if (!org) {
        throw new Error(`Organization ${orgId} not found`);
      }

      // Load compliance settings for consent mode
      try {
        const { sequelize } = require('../../models');
        const [compRow] = await sequelize.query(
          'SELECT recording_consent FROM org_compliance WHERE org_id = ?',
          { replacements: [orgId], type: sequelize.QueryTypes.SELECT }
        );
        org._consentMode = compRow?.recording_consent || 'announcement';
        console.log(`📋 Consent mode for ${org.name}: ${org._consentMode}`);
      } catch { org._consentMode = 'announcement'; }

      const dialplans = {
        contexts: {},
        extensions: {},
        includes: {}
      };

      // Generate internal context (extensions)
      dialplans.contexts[`${org.context_prefix}_internal`] =
        this.generateInternalContext(org);

      // Generate incoming context (DID routing)
      dialplans.contexts[`${org.context_prefix}_incoming`] =
        this.generateIncomingContext(org);

      // Generate incoming subroutine context (DID handling logic)
      dialplans.contexts[`${org.context_prefix}_incoming_sub`] =
        this.generateIncomingSubContext(org);

      // Generate outbound context (external calling)
      dialplans.contexts[`${org.context_prefix}_outbound`] =
        this.generateOutboundContext(org);

      // Generate queue context
      dialplans.contexts[`${org.context_prefix}_queue`] =
        this.generateQueueContext(org);

      // Single per-org helper context for ALL queue members. The
      // queues.conf `member =>` line points at
      // `Local/qm<member_id>@<prefix>_qmem/n`. Critically, this name
      // MUST fit within Asterisk's 80-char AST_CHANNEL_NAME limit;
      // the previous per-queue scheme used context names like
      // `<prefix>_queue_<32-hex queue_id>_members` which together
      // with `Local/qm<32-hex>...` exceeded 80 and got TRUNCATED at
      // runtime, producing "No such extension/context" errors and
      // calls that never connected to any member.
      //
      // Char budget check:
      //   Local/  (6) + qm<32>  (34) + @  (1) +
      //   <prefix:13>_qmem (18) + /n (2) = 61 chars  ✓ under 80.
      //
      // Extension names are member.id (32-hex), globally unique by
      // UUID, so members from different queues never collide even
      // though they share one context.
      dialplans.contexts[`${org.context_prefix}_qmem`] =
        this.generateQueueMemberContext(org);

      // Generate IVR context
      dialplans.contexts[`${org.context_prefix}_ivr`] =
        this.generateIvrContext(org);

      // Generate hangup handler context
      dialplans.contexts[`${org.context_prefix}_hangup`] =
        this.generateHangupHandlerContext(org);

      console.log(`✅ Generated dialplans for organization: ${org.name}`);
      return dialplans;

    } catch (error) {
      console.error('❌ Error generating dialplans:', error);
      throw error;
    }
  }

  generateInternalContext(org) {
    const context = `${org.context_prefix}_internal`;
    let dialplan = `[${context}]\n`;

    // Add context includes. Order matters: Asterisk searches includes in
    // declaration order, and `_outbound` contains the catch-all `_X.`
    // pattern which greedily matches any digit sequence — including IVR
    // extensions like 7002 and queue numbers. If `_outbound` is included
    // first, `_X.` wins over the exact `7002` in `_ivr` and the call goes
    // out to PSTN instead of the IVR. Put exact-match contexts (_ivr,
    // _queue) FIRST and the wildcard context LAST so specific matches win.
    dialplan += `include => ${org.context_prefix}_ivr\n`;
    dialplan += `include => ${org.context_prefix}_queue\n`;
    dialplan += `include => ${org.context_prefix}_outbound\n\n`;

    // Build a usersById map once so generateUserExtension can resolve
    // failover_destination_user_id → endpoint without re-scanning the
    // array per user. Constant-time lookup.
    const usersById = new Map((org.users || []).map((u) => [u.id, u]));

    // Generate extension dialplan for each user. We now emit dialplan
    // entries for INACTIVE users too — but only if they have a failover
    // destination that's currently active. This gives the operator the
    // expected behavior: "if Reception is off-duty, calls to Reception
    // ring the night manager instead." Without this, calls to an
    // inactive user's extension would hit the unknown-extension fallback.
    //
    // Inactive users WITHOUT a usable failover are still skipped (current
    // behavior preserved — calls hit "extension not found").
    org.users.forEach((user) => {
      if (user.status === 'active') {
        dialplan += this.generateUserExtension(user, org, usersById);
        return;
      }
      // Inactive + has failover + failover is active → emit a redirect-only
      // dialplan entry that goes straight to the failover endpoint.
      const failoverUser = user.failover_destination_user_id
        ? usersById.get(user.failover_destination_user_id)
        : null;
      if (failoverUser && failoverUser.status === 'active') {
        dialplan += this.generateUserExtension(user, org, usersById);
      }
    });

    // Add special extensions
    dialplan += this.generateSpecialExtensions(org);

    // Add transfer patterns
    dialplan += this.generateTransferPatterns(org);

    return dialplan;
  }

  generateUserExtension(user, org, usersById = new Map()) {
    const endpoint = user.asterisk_endpoint;
    let extension = `; Extension ${user.extension} - ${user.full_name}\n`;

    // Resolve the failover target ONCE up here. The target can be
    // either another SIP user (failover_destination_user_id) or an
    // external phone number (failover_phone_number) — never both;
    // the API enforces mutual exclusion. Single-hop semantic: we
    // never emit a failover-of-failover branch.
    //
    // User-target eligibility (existing rules):
    //   - failover_destination_user_id is set, AND
    //   - the failover user EXISTS in this org's user list (defensive
    //     against stale FK rows), AND
    //   - the failover user is status='active', AND
    //   - the failover user has a non-empty asterisk_endpoint
    //
    // Phone-target eligibility:
    //   - failover_phone_number is set AND parses to ≥10 digits, AND
    //   - the org has at least one outbound route with a trunk we can
    //     route through (otherwise the Dial would fail at runtime).
    //
    // **Failover ONLY fires on UNREACHABLE primary** (DEVSTATE not
    // NOT_INUSE and not BUSY). It does NOT fire on:
    //   - BUSY     — user is on a call or actively declined → busy tone
    //   - NOANSWER — phone rang but no pickup → announce, no failover
    // (per operator request 2026-05-13; was previously firing on all
    // three.) The labels below reflect this — the old `offline` label
    // is renamed `unreachable` to make the semantics obvious in the
    // generated Asterisk dialplan when an admin reads it.
    let failoverDial = null;       // The Asterisk Dial() string we emit
    let failoverLabel = null;       // Human-readable target for NoOp/comment
    const failoverUser = user.failover_destination_user_id
      ? usersById.get(user.failover_destination_user_id)
      : null;
    if (failoverUser
        && failoverUser.id !== user.id          // self-loop defense (API also forbids)
        && failoverUser.status === 'active'
        && failoverUser.asterisk_endpoint) {
      failoverDial = `PJSIP/${failoverUser.asterisk_endpoint}`;
      failoverLabel = `ext ${failoverUser.extension}`;
    } else if (user.failover_phone_number) {
      const digits = String(user.failover_phone_number).replace(/[^0-9]/g, '');
      if (digits.length >= 10) {
        // Take the trailing 10 digits — matches how `ring_target='phone'`
        // normalizes numbers below. The outbound route + trunk are
        // resolved the same way.
        const phone10 = digits.slice(-10);
        const outRoute = org.outboundRoutes?.[0];
        const trunk = outRoute?.trunk;
        const trunkEp = (trunk && trunk.asterisk_peer_name) || (org.context_prefix + 'trunk');
        failoverDial = `PJSIP/${phone10}@${trunkEp}`;
        failoverLabel = `phone +91${phone10}`;
      }
    }
    const hasUsableFailover = !!failoverDial;
    const failoverTimeout = Number.isInteger(user.failover_timeout_seconds)
      ? user.failover_timeout_seconds
      : 20;

    // ─── Inactive user with failover: redirect-only dialplan ────────
    // This user is off-duty. Instead of generating their full ring +
    // recording + DEVSTATE logic, emit a minimal entry that goes
    // straight to the failover destination. Other branches
    // (busy/unreachable) are unreachable here since we never Dial
    // the primary.
    if (user.status === 'inactive' && hasUsableFailover) {
      extension += `exten => ${user.extension},1,NoOp(${user.extension} inactive — routing to failover ${failoverLabel})\n`;
      extension += `exten => ${user.extension},n,Set(ORG_ID=${org.id})\n`;
      extension += `exten => ${user.extension},n,Set(USER_ID=${user.id})\n`;
      extension += `exten => ${user.extension},n,Set(CDR(accountcode)=${org.id})\n`;
      extension += `exten => ${user.extension},n,Dial(${failoverDial},${failoverTimeout},tT)\n`;
      // Same fall-through trick as the active-user unreachable branch:
      // when the failover answered, Asterisk tears down the caller
      // channel after the bridge ends, so we never reach the announce.
      // We only reach these lines when the failover FAILED — in which
      // case the caller deserves to hear "not available", not dead
      // air. We use the inactive user's extension for SayDigits
      // because that's the number the caller actually dialed.
      extension += `exten => ${user.extension},n,Playback(the-person-at-exten)\n`;
      extension += `exten => ${user.extension},n,SayDigits(${user.extension})\n`;
      extension += `exten => ${user.extension},n,Playback(is-not-available)\n`;
      extension += `exten => ${user.extension},n,Hangup()\n\n`;
      return extension;
    }

    extension += `exten => ${user.extension},1,NoOp(Calling ${user.full_name})\n`;
    extension += `exten => ${user.extension},n,Set(CALLERID(name)=\${CALLERID(name)})\n`;
    extension += `exten => ${user.extension},n,Set(ORG_ID=${org.id})\n`;
    extension += `exten => ${user.extension},n,Set(USER_ID=${user.id})\n`;
    extension += `exten => ${user.extension},n,Set(CDR(accountcode)=${org.id})\n`;
    extension += `exten => ${user.extension},n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;

    // Call recording: defaults ON when org-level recording is enabled.
    // Per-user `call_recording = false` opts out; anything else records.
    const orgRecordingEnabled = org.settings?.recording_enabled !== false;
    const userRecording = user.call_recording !== false && orgRecordingEnabled;
    if (userRecording) {
      extension += `exten => ${user.extension},n,Set(MIXMONITOR_FILENAME=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${CALLERID(num)}-${user.extension}.wav)\n`;
      extension += `exten => ${user.extension},n,Set(CDR(recordingfile)=\${MIXMONITOR_FILENAME})\n`;
      extension += `exten => ${user.extension},n,MixMonitor(/var/spool/asterisk/monitor/\${MIXMONITOR_FILENAME})\n`;
    }

    // Route based on ring_target
    if (user.ring_target === "phone" && user.phone_number) {
      // Phone routing — dial via trunk directly with caller ID
      const outRoute = org.outboundRoutes?.[0]; const trunk = outRoute?.trunk;
      const trunkEp = (trunk && trunk.asterisk_peer_name) || (org.context_prefix + "trunk");
      let phoneNum = user.phone_number.replace(/[^0-9]/g, ""); if (phoneNum.length > 10) phoneNum = phoneNum.slice(-10);
      // Outbound caller ID priority: per-user outbound_did > org default DID > first assigned DID
      const orgDefaultDid = org.dids && org.dids.find(d => d.is_default);
      const userCid = user.outbound_did || (orgDefaultDid && orgDefaultDid.number) || (org.dids && org.dids[0] && org.dids[0].number) || null;
      if (userCid) {
        extension += `exten => ${user.extension},n,Set(CALLERID(num)=${userCid})\n`;
      }
      extension += `exten => ${user.extension},n,Dial(PJSIP/${phoneNum}@${trunkEp},30,tT)\n`;
      // Gate against falling through to (unreachable) — without this
      // Goto, NOANSWER / BUSY / CHANUNAVAIL on the mobile callout
      // would emit the failover Dial, violating the "unreachable-only"
      // rule for ring_target='phone' users. The helper text in the
      // editor explicitly promises failover doesn't fire on busy /
      // no-pickup, so we honour that here too. (Caught by QA + UAT
      // review of PR #158.)
      extension += `exten => ${user.extension},n,Goto(end)\n`;




    } else if (user.routing_type === 'ai_agent' && user.routing_destination) {
      // AI agent routing — enter Stasis with WSS URL
      extension += `exten => ${user.extension},n,Stasis(${org.stasis_app || 'pbx_api'},ai_agent,${user.routing_destination})\n`;
      extension += `exten => ${user.extension},n,Goto(end)\n`;
    } else {
      // SIP routing — check device state and dial.
      //
      // Primary ring time is always 30s now — failover no longer fires
      // on DIALSTATUS=NOANSWER (the "rang out, no pickup" case), so
      // there's no reason to shorten the primary's ring window.
      // Failover only fires when DEVSTATE says the device is
      // UNREACHABLE (not registered / network down / CHANUNAVAIL).

      extension += `exten => ${user.extension},n,Set(DEVSTATE=\${DEVICE_STATE(PJSIP/${endpoint})})\n`;
      // CRITICAL: GotoIf must wrap its condition in `$[...]` for actual
      // string equality. Without it, Asterisk evaluates the post-
      // substitution string for TRUTHINESS — any non-empty string is
      // true — so `${DEVSTATE}=NOT_INUSE` always took the TRUE branch
      // regardless of actual device state. That made the failover path
      // dead code for years: a phone offline / unregistered always
      // fell through to the (available) Dial which returned CHANUNAVAIL,
      // skipped failover, and announced "the person at extension N is
      // not available" — never rolling to the configured failover.
      // Same root cause as the 2026-05-15 Thangavelu queue bug.
      extension += `exten => ${user.extension},n,GotoIf($[\${DEVSTATE}=NOT_INUSE]?available:check_busy)\n`;
      extension += `exten => ${user.extension},n(check_busy),GotoIf($[\${DEVSTATE}=BUSY]?busy:unreachable)\n`;

      extension += `exten => ${user.extension},n(available),Dial(PJSIP/${endpoint},30,tT)\n`;
      // NOANSWER no longer fails over — caller hears the "not available"
      // announce directly. BUSY (declined or already-on-call) → busy tone.
      extension += `exten => ${user.extension},n,GotoIf($[\${DIALSTATUS}=NOANSWER]?announce:end)\n`;
      extension += `exten => ${user.extension},n,GotoIf($[\${DIALSTATUS}=BUSY]?busy:end)\n`;
      extension += `exten => ${user.extension},n,Goto(end)\n`;
    }

    // ─── Unreachable handling — THE ONLY failover trigger ──────────
    // DEVSTATE says the device is not registered / network is down /
    // returns CHANUNAVAIL. If a failover destination is configured we
    // try it FIRST; on success Asterisk tears down the caller after
    // the bridge ends so dialplan execution stops naturally. On
    // failure we fall through to the "not available" announce.
    // (Important: no `g` option on Dial so post-answer fallthrough is
    // disabled.)
    if (hasUsableFailover) {
      extension += `exten => ${user.extension},n(unreachable),NoOp(Primary unreachable - failover to ${failoverLabel})\n`;
      extension += `exten => ${user.extension},n,Dial(${failoverDial},${failoverTimeout},tT)\n`;
      // No GotoIf — fall through to the announce, which is at the
      // `announce` label below.
    } else {
      extension += `exten => ${user.extension},n(unreachable),NoOp(Primary unreachable - no failover configured)\n`;
    }

    // ─── Announce: "the person at extension N is not available" ────
    // Reached from:
    //   - the (unreachable) branch above (after a failover attempt or
    //     directly when no failover is configured), OR
    //   - DIALSTATUS=NOANSWER on the primary Dial (no failover even
    //     if configured, per the new "unreachable-only" semantics).
    extension += `exten => ${user.extension},n(announce),Playback(the-person-at-exten)\n`;
    extension += `exten => ${user.extension},n,SayDigits(${user.extension})\n`;
    extension += `exten => ${user.extension},n,Playback(is-not-available)\n`;
    extension += `exten => ${user.extension},n,Hangup()\n`;

    // ─── Busy handling ─────────────────────────────────────────────
    // BUSY = user is on another call OR actively declined the
    // incoming call. Operator's explicit ask (2026-05-13): "if user
    // busy, declined call and already on call it should not route to
    // failover destination — only route if unreachable." So this is
    // a hard busy tone regardless of failover configuration.
    extension += `exten => ${user.extension},n(busy),Busy(20)\n`;
    extension += `exten => ${user.extension},n,Hangup()\n`;

    // End
    extension += `exten => ${user.extension},n(end),Hangup()\n\n`;

    return extension;
  }

  generateIncomingContext(org) {
    const context = `${org.context_prefix}_incoming`;
    let dialplan = `[${context}]\n`;

    // Generate DID routing (main patterns)
    org.dids.forEach(did => {
      if (did.status === 'active') {
        dialplan += this.generateDidRouting(did, org);
      }
    });

    // Add routing rules
    org.routingRules.forEach(rule => {
      if (rule.active) {
        dialplan += this.generateRoutingRule(rule, org);
      }
    });

    // Catch-all for unmatched DIDs
    dialplan += `; Catch-all for unmatched numbers\n`;
    dialplan += `exten => _X.,1,NoOp(Unmatched DID: \${EXTEN})\n`;
    dialplan += `exten => _X.,n,Set(ORG_ID=${org.id})\n`;
    dialplan += `exten => _X.,n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;
    dialplan += `exten => _X.,n,Playback(number-not-in-service)\n`;
    dialplan += `exten => _X.,n,Hangup()\n\n`;

    return dialplan;
  }

  generateIncomingSubContext(org) {
    const context = `${org.context_prefix}_incoming_sub`;
    let dialplan = `[${context}]\n`;

    // Generate subroutine context for DID handling
    org.dids.forEach(did => {
      if (did.status === 'active') {
        dialplan += this.generateDidSubroutine(did, org);
      }
    });

    return dialplan;
  }

  generateDidRouting(did, org) {
    const cleanNumber = did.number.replace(/[^0-9]/g, '');
    const subroutineName = `did_${cleanNumber}`;
    let routing = `; DID ${did.number} - ${did.description}\n`;

    // Multiple patterns to catch the DID from different sources
    // Pattern 1: Direct number match (e.g., 15550123456)
    routing += `exten => ${cleanNumber},1,Gosub(${org.context_prefix}_incoming_sub,${subroutineName},1(${did.id},${did.number}))\n`;

    // Pattern 2: Number with + prefix
    routing += `exten => +${cleanNumber},1,Gosub(${org.context_prefix}_incoming_sub,${subroutineName},1(${did.id},${did.number}))\n`;

    // Pattern 3: With country code 91 (NUC/Tata sends this)
    routing += `exten => 91${cleanNumber},1,Gosub(${org.context_prefix}_incoming_sub,${subroutineName},1(${did.id},${did.number}))\n`;

    // Pattern 4: With +91 prefix

    // Pattern 5 & 6: Without leading 0 — NUC sends +91{number without 0 prefix}
    const numWithout0 = cleanNumber.replace(/^0+/, "");
    if (numWithout0 !== cleanNumber) {
      routing += `exten => 91${numWithout0},1,Gosub(${org.context_prefix}_incoming_sub,${subroutineName},1(${did.id},${did.number}))\n`;
      routing += `exten => +91${numWithout0},1,Gosub(${org.context_prefix}_incoming_sub,${subroutineName},1(${did.id},${did.number}))\n`;
    }
    routing += `exten => +91${cleanNumber},1,Gosub(${org.context_prefix}_incoming_sub,${subroutineName},1(${did.id},${did.number}))\n`;

    routing += `exten => ${cleanNumber},n,Hangup()\n`;
    routing += `exten => +${cleanNumber},n,Hangup()\n\n`;

    return routing;
  }

  generateDidSubroutine(did, org) {
    const cleanNumber = did.number.replace(/[^0-9]/g, '');
    const subroutineName = `did_${cleanNumber}`;
    const concurrentCallLimit = org.limits?.concurrent_calls || 10;

    let subroutine = `; Subroutine for DID ${did.number}\n`;
    subroutine += `exten => ${subroutineName},1,NoOp(Incoming call to ${did.number})\n`;
    subroutine += `exten => ${subroutineName},n,Set(ORG_ID=${org.id})\n`;
    subroutine += `exten => ${subroutineName},n,Set(CDR(accountcode)=${org.id})\n`;
    subroutine += `exten => ${subroutineName},n,Set(DID_NUMBER=\${ARG2})\n`;
    subroutine += `exten => ${subroutineName},n,Set(DID_ID=\${ARG1})\n`;

    // Check concurrent call limit
    subroutine += `exten => ${subroutineName},n,Set(GROUP()=${org.id}_calls)\n`;
    subroutine += `exten => ${subroutineName},n,Set(CURRENT_CALLS=\${GROUP_COUNT(${org.id}_calls)})\n`;
    subroutine += `exten => ${subroutineName},n,GotoIf($[\${CURRENT_CALLS} > ${concurrentCallLimit}]?limit_reached)\n`;

    subroutine += `exten => ${subroutineName},n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;

    // Call recording — consent mode determines how/when MixMonitor starts.
    // Recording defaults ON when org-level recording is enabled. Per-DID
    // `recording_enabled = false` opts out; anything else records.
    const orgRecordingEnabled = org.settings?.recording_enabled !== false;
    const consentMode = org._consentMode || 'announcement';
    const didRecording = did.recording_enabled !== false && orgRecordingEnabled;
    if (didRecording) {
      const mixCmd = `Set(MIXMONITOR_FILENAME=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${CALLERID(num)}-${cleanNumber}.wav)`;
      const setCdr = `Set(CDR(recordingfile)=\${MIXMONITOR_FILENAME})`;
      const startMix = `MixMonitor(/var/spool/asterisk/monitor/\${MIXMONITOR_FILENAME})`;

      if (consentMode === 'external_consent') {
        // External consent (form/app/check-in) — no in-call announcement, just record
        subroutine += `exten => ${subroutineName},n,${mixCmd}\n`;
        subroutine += `exten => ${subroutineName},n,${setCdr}\n`;
        subroutine += `exten => ${subroutineName},n,${startMix}\n`;

      } else if (consentMode === 'explicit_opt_in') {
        // Explicit opt-in — caller must press 1 to consent, otherwise no recording
        subroutine += `exten => ${subroutineName},n,Answer()\n`;
        subroutine += `exten => ${subroutineName},n,Playback(this-call-may-be-recorded)\n`;
        subroutine += `exten => ${subroutineName},n,Playback(press-1-to-consent)\n`;
        subroutine += `exten => ${subroutineName},n,Read(CONSENT,,1,,1,5)\n`;
        subroutine += `exten => ${subroutineName},n,GotoIf($[\${CONSENT}!=1]?skip_recording_${cleanNumber})\n`;
        subroutine += `exten => ${subroutineName},n,${mixCmd}\n`;
        subroutine += `exten => ${subroutineName},n,${setCdr}\n`;
        subroutine += `exten => ${subroutineName},n,${startMix}\n`;
        subroutine += `exten => ${subroutineName},n(skip_recording_${cleanNumber}),NoOp(Recording consent: \${CONSENT})\n`;

      } else if (consentMode === 'opt_out') {
        // Opt-out — recording on by default, caller presses 2 to stop
        subroutine += `exten => ${subroutineName},n,Answer()\n`;
        subroutine += `exten => ${subroutineName},n,Playback(this-call-may-be-recorded)\n`;
        subroutine += `exten => ${subroutineName},n,Playback(press-2-to-opt-out)\n`;
        subroutine += `exten => ${subroutineName},n,Read(OPTOUT,,1,,1,3)\n`;
        subroutine += `exten => ${subroutineName},n,GotoIf($[\${OPTOUT}=2]?skip_recording_${cleanNumber})\n`;
        subroutine += `exten => ${subroutineName},n,${mixCmd}\n`;
        subroutine += `exten => ${subroutineName},n,${setCdr}\n`;
        subroutine += `exten => ${subroutineName},n,${startMix}\n`;
        subroutine += `exten => ${subroutineName},n(skip_recording_${cleanNumber}),NoOp(Opt-out: \${OPTOUT})\n`;

      } else {
        // Announcement (default) — play notice then record automatically
        subroutine += `exten => ${subroutineName},n,Answer()\n`;
        subroutine += `exten => ${subroutineName},n,Playback(this-call-may-be-recorded)\n`;
        subroutine += `exten => ${subroutineName},n,${mixCmd}\n`;
        subroutine += `exten => ${subroutineName},n,${setCdr}\n`;
        subroutine += `exten => ${subroutineName},n,${startMix}\n`;
      }
    }

    // Route based on routing type
    switch (did.routing_type) {
      case 'extension':
        subroutine += `exten => ${subroutineName},n,Goto(${org.context_prefix}_internal,${did.routing_destination},1)\n`;
        break;

      case 'queue':
        // Find the queue number from the queue ID
        const queue = org.queues.find(q => q.id === did.routing_destination || q.number === did.routing_destination);
        if (!queue) {
          console.error(`❌ Queue ${did.routing_destination} not found for DID ${did.number}`);
          subroutine += `exten => ${subroutineName},n,Playback(number-not-in-service)\n`;
          subroutine += `exten => ${subroutineName},n,Hangup()\n`;
        } else {
          subroutine += `exten => ${subroutineName},n,Goto(${org.context_prefix}_queue,${queue.number},1)\n`;
        }
        break;

      case 'ivr':
        // Find the IVR extension from the IVR ID
        const ivr = org.ivrs.find(i => i.id === did.routing_destination);
        if (!ivr) {
          console.error(`❌ IVR ${did.routing_destination} not found for DID ${did.number}`);
          subroutine += `exten => ${subroutineName},n,Playback(number-not-in-service)\n`;
          subroutine += `exten => ${subroutineName},n,Hangup()\n`;
        } else {
          subroutine += `exten => ${subroutineName},n,Goto(${org.context_prefix}_ivr,${ivr.extension},1)\n`;
        }
        break;

      case 'ai_agent':
        subroutine += `exten => ${subroutineName},n,Stasis(pbx_api,ai_agent,${did.routing_destination})\n`;
        break;

      case 'external':
        subroutine += `exten => ${subroutineName},n,Dial(SIP/${did.routing_destination})\n`;
        break;

      default:
        subroutine += `exten => ${subroutineName},n,Playback(number-not-in-service)\n`;
        subroutine += `exten => ${subroutineName},n,Hangup()\n`;
    }

    subroutine += `exten => ${subroutineName},n,Return()\n`;

    // Concurrent call limit reached handler
    subroutine += `exten => ${subroutineName},n(limit_reached),NoOp(Concurrent call limit reached: \${CURRENT_CALLS}/\${concurrentCallLimit})\n`;
    subroutine += `exten => ${subroutineName},n,Playback(all-circuits-busy-now)\n`;
    subroutine += `exten => ${subroutineName},n,Playback(pls-try-call-later)\n`;
    subroutine += `exten => ${subroutineName},n,Hangup()\n\n`;

    return subroutine;
  }

  generateOutboundContext(org) {
    const context = `${org.context_prefix}_outbound`;
    const concurrentCallLimit = org.limits?.concurrent_calls || 10;
    let dialplan = `[${context}]\n`;

    // Get active outbound routes sorted by priority
    const routes = (org.outboundRoutes || [])
      .filter(r => r.status === 'active')
      .sort((a, b) => a.priority - b.priority);

    if (routes.length === 0) {
      dialplan += `; No outbound routes configured\n`;
      dialplan += `exten => _X.,1,NoOp(No outbound routes available)\n`;
      dialplan += `exten => _X.,n,Playback(cannot-complete-as-dialed)\n`;
      dialplan += `exten => _X.,n,Hangup()\n\n`;
      return dialplan;
    }

    // Strip leading `+` — many softphones (Zoiper, Bria, etc.) prepend it
    // to E.164 international numbers, and none of the configured
    // `_X.`-style patterns match a literal `+`. Without this, dialling
    // `+919876543210` produced "extension not found in context
    // ..._internal". Re-enters the same context with the + removed so
    // the normal outbound patterns catch it.
    dialplan += `; Normalize E.164 leading '+'\n`;
    dialplan += `exten => _+X.,1,NoOp(Stripping leading + from \${EXTEN})\n`;
    dialplan += `exten => _+X.,n,Goto(\${EXTEN:1},1)\n\n`;

    // Strip leading `91` country code for 12-digit Indian numbers.
    //
    // Why: Tata's outbound termination expects the bare 10-digit subscriber
    // number. Customers' softphones often dial 12 digits because:
    //   - Zoiper renders incoming CallerID with the 91 prefix (E.164-style),
    //     and tap-to-call back uses that exact string;
    //   - users paste WhatsApp/contact-list numbers that include the country
    //     code.
    // Today both formats reach Asterisk, but only the 10-digit one connects
    // through Tata. Normalizing here makes both inputs equivalent. ALL
    // current customer trunks share the Tata upstream (10.10.10.2:5060 via
    // NUC); if a future trunk needs the country code preserved, gate this
    // rule on a per-trunk flag.
    //
    // Pattern is intentionally narrow — `_91XXXXXXXXXX` only matches a
    // 12-digit number starting with literal `91`, so it cannot swallow
    // legitimate longer international destinations or the 4-digit extension
    // dials handled in `_internal`. Goto re-enters with the `91` stripped
    // so the normal `_X.` route patterns match.
    dialplan += `; Normalize Indian country code '91' (Tata trunk expects 10-digit)\n`;
    dialplan += `exten => _91XXXXXXXXXX,1,NoOp(Stripping 91 country code from \${EXTEN})\n`;
    dialplan += `exten => _91XXXXXXXXXX,n,Goto(\${EXTEN:2},1)\n\n`;

    // Generate dialplan for each route
    routes.forEach(route => {
      if (!route.trunk) {
        console.error(`❌ Route ${route.name} (ID: ${route.id}): trunk not loaded. trunk_id=${route.trunk_id}`);
        dialplan += `; ERROR: Route ${route.name} - Trunk not found (trunk_id: ${route.trunk_id})\n`;
        dialplan += `exten => ${route.dial_pattern},1,NoOp(ERROR: Trunk not configured for route ${route.name})\n`;
        dialplan += `exten => ${route.dial_pattern},n,Playback(cannot-complete-as-dialed)\n`;
        dialplan += `exten => ${route.dial_pattern},n,Hangup()\n\n`;
        return;
      }

      if (!route.trunk.asterisk_peer_name) {
        console.error(`❌ Route ${route.name}: trunk ${route.trunk.name || route.trunk.id} missing asterisk_peer_name`);
        dialplan += `; ERROR: Route ${route.name} - Trunk missing PJSIP peer name\n`;
        dialplan += `exten => ${route.dial_pattern},1,NoOp(ERROR: Trunk ${route.trunk.name} not configured properly)\n`;
        dialplan += `exten => ${route.dial_pattern},n,Playback(cannot-complete-as-dialed)\n`;
        dialplan += `exten => ${route.dial_pattern},n,Hangup()\n\n`;
        return;
      }

      dialplan += `; Route: ${route.name} (${route.route_type}) - Priority ${route.priority}\n`;
      dialplan += `; Trunk: ${route.trunk.name} (${route.trunk.asterisk_peer_name})\n`;
      dialplan += `exten => ${route.dial_pattern},1,NoOp(Outbound call via ${route.name})\n`;
      dialplan += `exten => ${route.dial_pattern},n,Set(__ORG_ID=${org.id})\n`;
      dialplan += `exten => ${route.dial_pattern},n,Set(__ROUTE_ID=${route.id})\n`;
      dialplan += `exten => ${route.dial_pattern},n,Set(CDR(accountcode)=${org.id})\n`;

      // Check concurrent call limit for outbound calls
      dialplan += `exten => ${route.dial_pattern},n,Set(GROUP()=${org.id}_calls)\n`;
      dialplan += `exten => ${route.dial_pattern},n,Set(CURRENT_CALLS=\${GROUP_COUNT(${org.id}_calls)})\n`;
      dialplan += `exten => ${route.dial_pattern},n,GotoIf($[\${CURRENT_CALLS} > ${concurrentCallLimit}]?limit_reached)\n`;

      dialplan += `exten => ${route.dial_pattern},n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;

      // Outbound caller ID priority (generator-level fallback):
      //   per-route caller_id_override > org default DID (is_default=true)
      //     > first assigned DID > no Set (softphone-sent CID)
      // A future Subroutine will re-validate at runtime so an explicit
      // Originate(CALLERID=...) from the API path still wins; this fallback
      // only kicks in when the softphone-sent CID is useless (e.g. ext num).
      const explicitCid = (typeof route.caller_id_override === 'string' && route.caller_id_override.trim()) || null;
      const orgDefaultDidRoute = org.dids && org.dids.find(d => d.is_default);
      const fallbackCid = explicitCid
        || (orgDefaultDidRoute && orgDefaultDidRoute.number)
        || (org.dids && org.dids[0] && org.dids[0].number)
        || null;
      if (fallbackCid) {
        const cleanCid = String(fallbackCid).replace(/^\+/, '');
        dialplan += `exten => ${route.dial_pattern},n,Set(CALLERID(num)=${cleanCid})\n`;
      }
      const explicitCidName = (typeof route.caller_id_name_override === 'string' && route.caller_id_name_override.trim()) || null;
      const fallbackCidName = explicitCidName || org.name || null;
      if (fallbackCidName) {
        dialplan += `exten => ${route.dial_pattern},n,Set(CALLERID(name)=${fallbackCidName})\n`;
      }

      // Recording: defaults ON when org-level recording is enabled.
      // Per-route `recording_enabled = false` opts out; anything else records.
      const orgRecordingEnabled = org.settings?.recording_enabled !== false;
      const routeRecording = route.recording_enabled !== false && orgRecordingEnabled;
      if (routeRecording) {
        dialplan += `exten => ${route.dial_pattern},n,Set(MIXMONITOR_FILENAME=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${CALLERID(num)}-\${EXTEN}.wav)\n`;
        dialplan += `exten => ${route.dial_pattern},n,Set(CDR(recordingfile)=\${MIXMONITOR_FILENAME})\n`;
        dialplan += `exten => ${route.dial_pattern},n,MixMonitor(/var/spool/asterisk/monitor/\${MIXMONITOR_FILENAME})\n`;
      }

      // Number manipulation
      let dialNumber = '${EXTEN}';

      // Strip digits from the beginning
      if (route.strip_digits > 0) {
        dialplan += `exten => ${route.dial_pattern},n,Set(DIALNUM=\${EXTEN:${route.strip_digits}})\n`;
        dialNumber = '${DIALNUM}';
      }

      // Determine which prefix to use: prepend_digits takes precedence over dial_prefix
      const prefixToUse = route.prepend_digits || route.dial_prefix;

      // Prepend digits/prefix after stripping
      if (prefixToUse) {
        if (route.strip_digits > 0) {
          dialplan += `exten => ${route.dial_pattern},n,Set(DIALNUM=${prefixToUse}\${DIALNUM})\n`;
        } else {
          dialplan += `exten => ${route.dial_pattern},n,Set(DIALNUM=${prefixToUse}\${EXTEN})\n`;
        }
        dialNumber = '${DIALNUM}';
      }

      // Use PJSIP endpoint name
      const trunkEndpoint = route.trunk.asterisk_peer_name;
      dialplan += `exten => ${route.dial_pattern},n,Dial(PJSIP/${dialNumber}@${trunkEndpoint},60)\n`;
      dialplan += `exten => ${route.dial_pattern},n,Hangup()\n`;

      // Concurrent call limit reached handler for this pattern
      dialplan += `exten => ${route.dial_pattern},n(limit_reached),NoOp(Concurrent call limit reached: \${CURRENT_CALLS}/${concurrentCallLimit})\n`;
      dialplan += `exten => ${route.dial_pattern},n,Playback(all-circuits-busy-now)\n`;
      dialplan += `exten => ${route.dial_pattern},n,Playback(pls-try-call-later)\n`;
      dialplan += `exten => ${route.dial_pattern},n,Hangup()\n\n`;
    });

    return dialplan;
  }

  generateQueueContext(org) {
    const context = `${org.context_prefix}_queue`;
    let dialplan = `[${context}]\n`;

    org.queues.forEach(queue => {
      if (queue.status === 'active') {
        dialplan += this.generateQueueExtension(queue, org);
      }
    });

    return dialplan;
  }

  // Single per-ORG helper context with one extension per active queue
  // member across all the org's queues. Names had to be SHORT enough
  // that `Local/qm<member_id>@<context>/n` fits Asterisk's 80-char
  // AST_CHANNEL_NAME limit — the previous per-queue scheme produced
  // ~103-char interfaces that got truncated to ~80 at runtime,
  // resolving to a nonexistent context and failing every ring with
  // "No such extension/context" → "Couldn't call".
  //
  // Extensions are named `qm<member_id_no_hyphens>` (34 chars total).
  // member.id is a UUID so cross-queue collisions in this shared
  // context are impossible.
  generateQueueMemberContext(org) {
    const context = `${org.context_prefix}_qmem`;
    let dialplan = `[${context}]\n`;
    dialplan += `; Queue member dial helpers for all queues in this org.\n`;
    dialplan += `; Each extension dials one member with its own ring_timeout_seconds.\n`;

    // Resolve trunk endpoint once — same pattern as user extension for
    // ring_target='phone' (line 233): prefer the org's first outbound
    // route's trunk peer name, fall back to a deterministic default.
    const outRoute = org.outboundRoutes?.[0];
    const trunk = outRoute?.trunk;
    const trunkEp = (trunk && trunk.asterisk_peer_name) || (org.context_prefix + 'trunk');

    // Per-leg recording follows the same gating as the regular internal
    // context (line ~281): record when org-level recording is enabled
    // AND the queue's recording_enabled is not explicitly false. Without
    // this, queue-member legs would stop being recorded and PR #165's
    // dedup/stitch logic would have no per-leg wavs to assemble.
    const orgRecordingEnabled = org.settings?.recording_enabled !== false;

    // Collect members from every active queue; tag each with its queue
    // name and recording flag so the per-leg MixMonitor decision lines
    // up with the queue the call entered through.
    const allMembers = [];
    for (const queue of org.queues || []) {
      if (queue.status !== 'active') continue;
      const queueRecording = queue.recording_enabled !== false && orgRecordingEnabled;
      for (const m of (queue.members || [])) {
        if (m.user && m.user.status === 'active') {
          allMembers.push({ member: m, queue, queueRecording });
        }
      }
    }
    if (allMembers.length === 0) {
      dialplan += `; No active members across any queue\n\n`;
      return dialplan;
    }
    // Sort by penalty ascending then member id for deterministic output.
    allMembers.sort((a, b) =>
      ((a.member.penalty || 0) - (b.member.penalty || 0)) || a.member.id.localeCompare(b.member.id)
    );

    allMembers.forEach(({ member, queue, queueRecording }) => {
      const user = member.user;
      const extName = `qm${member.id.replace(/-/g, '')}`;
      const safeName = (user.full_name || user.username || 'Unknown').replace(/[",]/g, ' ');
      const ringTime = member.ring_timeout_seconds || 20;

      dialplan += `; Queue "${queue.name}" (${queue.number}) member ${safeName} (${member.id}) ring=${ringTime}s\n`;
      dialplan += `exten => ${extName},1,NoOp(Queue ${queue.name} member: ${safeName} ring ${ringTime}s)\n`;

      // Channel metadata so hangup handlers, CDR, and recording stitch
      // logic see the right org/user identity on each ring leg.
      dialplan += `exten => ${extName},n,Set(__ORG_ID=${org.id})\n`;
      dialplan += `exten => ${extName},n,Set(__USER_ID=${user.id})\n`;
      dialplan += `exten => ${extName},n,Set(CDR(accountcode)=${org.id})\n`;
      dialplan += `exten => ${extName},n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;

      // Per-leg recording. Filename uses the user's extension so it
      // matches the existing internal-context recording filename
      // pattern that PR #165 already understands and stitches.
      if (queueRecording) {
        dialplan += `exten => ${extName},n,Set(MIXMONITOR_FILENAME=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${CALLERID(num)}-${user.extension}.wav)\n`;
        dialplan += `exten => ${extName},n,Set(CDR(recordingfile)=\${MIXMONITOR_FILENAME})\n`;
        dialplan += `exten => ${extName},n,MixMonitor(/var/spool/asterisk/monitor/\${MIXMONITOR_FILENAME})\n`;
      }

      if (user.routing_type === 'ai_agent' && user.routing_destination) {
        // AI-agent member: hand the call to the bot framework via
        // Stasis instead of dialing a SIP endpoint. Mirrors the
        // internal-context AI-agent branch (line ~313). Without this,
        // queue calls to AI users would Dial a non-existent PJSIP
        // endpoint and never reach the bot. ring_timeout doesn't apply
        // — Stasis() doesn't time out like Dial() does — but we keep
        // the helper-context shape uniform for the queue.timeout MAX
        // calculation.
        dialplan += `exten => ${extName},n,Stasis(${org.stasis_app || 'pbx_api'},ai_agent,${user.routing_destination})\n`;
        dialplan += `exten => ${extName},n,Hangup()\n`;
      } else if (user.ring_target === 'phone' && user.phone_number) {
        // Phone target: dial out via trunk, trim to last 10 digits to
        // match the normalization used elsewhere in the dialplan.
        //
        // CRITICAL: set CallerID to one of this org's owned DIDs BEFORE
        // the Dial. Without this, the From header on the INVITE to Tata
        // inherits from the parent channel (the inbound external caller's
        // number, e.g. 919876543210). Tata's SBC won't accept a From
        // that isn't one of the trunk's registered DIDs — it substitutes
        // with the trunk's GLOBAL default DID, which on prod is
        // `+918065978001` (a staging-routed DID with org_id=NULL).
        // Reproduced 2026-05-16: a call to Om Chambers' DID 918065978006
        // rang Hariph's mobile, but the mobile showed `918065978001` as
        // the caller — making it look like a cross-org leak.
        //
        // Priority matches `generateUserExtension` (line ~301): per-user
        // outbound_did > org default DID > org's first DID. `org.dids`
        // is already scoped to this org's assignments, so it can't pick
        // up another org's DID by accident.
        const digits = String(user.phone_number).replace(/[^0-9]/g, '');
        const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
        const orgDefaultDid = org.dids && org.dids.find(d => d.is_default);
        const memberCid = user.outbound_did
          || (orgDefaultDid && orgDefaultDid.number)
          || (org.dids && org.dids[0] && org.dids[0].number)
          || null;
        if (memberCid) {
          dialplan += `exten => ${extName},n,Set(CALLERID(num)=${memberCid})\n`;
        }
        // Dial the member's phone via the org trunk. NO ride-out wait
        // here — Asterisk's app_queue natively advances to the next
        // member as soon as Dial returns non-ANSWERED. A previous
        // attempt (#204) padded the helper to the full ring timeout
        // on decline, but that made the user-experience worse: a
        // decline still waited the full ring window before next member
        // got rung. Reverted 2026-05-16 on hospital feedback.
        dialplan += `exten => ${extName},n,Dial(PJSIP/${phone10}@${trunkEp},${ringTime},tT)\n`;
        dialplan += `exten => ${extName},n,Hangup()\n`;
      } else if (user.asterisk_endpoint) {
        // Softphone target: dial PJSIP endpoint directly. Same — no
        // ride-out padding; queue advances on natural Dial exit.
        dialplan += `exten => ${extName},n,Dial(PJSIP/${user.asterisk_endpoint},${ringTime},tT)\n`;
        dialplan += `exten => ${extName},n,Hangup()\n`;
      } else {
        dialplan += `; (skipped: no dial target — user has no endpoint or phone)\n`;
        dialplan += `exten => ${extName},n,Hangup()\n`;
        return;
      }
    });

    dialplan += `\n`;
    return dialplan;
  }

  generateIvrContext(org) {
    const context = `${org.context_prefix}_ivr`;
    let dialplan = `[${context}]\n`;

    if (!org.ivrs || org.ivrs.length === 0) {
      dialplan += `; No IVR menus configured\n\n`;
      return dialplan;
    }

    org.ivrs.forEach(ivr => {
      if (ivr.status === 'active') {
        dialplan += this.generateIvrExtension(ivr, org);
      }
    });

    return dialplan;
  }

  generateIvrExtension(ivr, org) {
    let extension = `; IVR ${ivr.extension} - ${ivr.name}\n`;
    extension += `exten => ${ivr.extension},1,NoOp(IVR Menu: ${ivr.name})\n`;
    extension += `exten => ${ivr.extension},n,Set(__ORG_ID=${org.id})\n`;
    extension += `exten => ${ivr.extension},n,Set(__IVR_ID=${ivr.id})\n`;
    extension += `exten => ${ivr.extension},n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;
    extension += `exten => ${ivr.extension},n,Set(IVR_RETRIES=0)\n`;

    // Play greeting prompt. TTS writes .wav files under
    // /var/lib/asterisk/sounds/greetings/<prompt>.wav, so we need the
    // `greetings/` subdir prefix — bare filename leaves Background() looking
    // only in /var/lib/asterisk/sounds/<lang>/ and silently failing.
    if (ivr.greeting_prompt) {
      extension += `exten => ${ivr.extension},n(start),Background(greetings/${ivr.greeting_prompt})\n`;
    } else {
      extension += `exten => ${ivr.extension},n(start),Background(welcome)\n`;
    }

    // Wait for digit input. `??` (not `||`) so timeout=0 is respected
    // — Asterisk's WaitExten(0) = wait forever, which is a valid setting.
    const waitTimeout = ivr.timeout ?? 10;
    const maxRetries = ivr.max_retries ?? 3;
    extension += `exten => ${ivr.extension},n,WaitExten(${waitTimeout})\n`;

    // Timeout handling. `\${IVR_RETRIES}` is escaped so the $ is written
    // literally into the .conf — Asterisk expands it at runtime via its
    // own variable substitution. If we let JS interpolate these, they'd
    // come out as `undefined` and blow up every IVR publish.
    //
    // Operator-facing model: `Max retries` = how many TIMES the greeting
    // is played before the IVR gives up and runs `timeout_action`. The
    // action only fires AFTER max_retries timeouts in a row. Older
    // versions of this generator short-circuited action=queue/extension/
    // hangup to fire on the FIRST timeout, which made the Max retries
    // field a no-op for those actions and confused operators (2026-05-16:
    // Thangavelu IVR set to "queue after 2 retries" went to queue on the
    // 1st timeout). Unified semantics now: ALL actions wait until
    // max_retries is exhausted, then do the configured terminal step.
    //
    //   IVR_RETRIES starts at 0 (set in the start block). On each
    //   timeout, increment; if IVR_RETRIES < maxRetries, jump back to
    //   the (start) label to replay the greeting. Otherwise fall
    //   through to the terminal action below.
    //
    // Setting max_retries=1 preserves the old "fire on first timeout"
    // behavior for operators who want immediate routing.
    const timeoutAction = ivr.timeout_action || 'retry';
    extension += `exten => t,1,NoOp(IVR Timeout — action=${timeoutAction})\n`;
    extension += `exten => t,n,Set(IVR_RETRIES=\$[\${IVR_RETRIES} + 1])\n`;
    extension += `exten => t,n,GotoIf(\$[\${IVR_RETRIES} < ${maxRetries}]?${ivr.extension},start)\n`;
    // Terminal action — runs only after max_retries timeouts.
    if (timeoutAction === 'queue' && ivr.timeout_destination) {
      extension += `exten => t,n,Goto(${org.context_prefix}_queue,${ivr.timeout_destination},1)\n`;
    } else if (timeoutAction === 'extension' && ivr.timeout_destination) {
      extension += `exten => t,n,Goto(${org.context_prefix}_internal,${ivr.timeout_destination},1)\n`;
    } else {
      // 'retry' / 'hangup' / fallback (action=queue|extension with no
      // destination set): play the optional timeout prompt then hangup.
      if (ivr.timeout_prompt) {
        extension += `exten => t,n,Playback(${ivr.timeout_prompt})\n`;
      } else {
        extension += `exten => t,n,Playback(pm-invalid-option)\n`;
      }
      extension += `exten => t,n,Hangup()\n`;
    }
    extension += `\n`;

    // Invalid input handling — same escaping reason as above.
    extension += `exten => i,1,NoOp(Invalid Input)\n`;
    extension += `exten => i,n,Set(IVR_RETRIES=\$[\${IVR_RETRIES} + 1])\n`;
    extension += `exten => i,n,GotoIf(\$[\${IVR_RETRIES} < ${maxRetries}]?retry:maxretries)\n`;
    extension += `exten => i,n(retry),`;
    if (ivr.invalid_prompt) {
      extension += `Playback(${ivr.invalid_prompt})\n`;
    } else {
      extension += `Playback(invalid)\n`;
    }
    extension += `exten => i,n,Goto(${ivr.extension},start)\n`;
    extension += `exten => i,n(maxretries),Playback(goodbye)\n`;
    extension += `exten => i,n,Hangup()\n\n`;

    // Generate menu options (will be added next)
    extension += this.generateIvrMenuOptions(ivr, org);

    return extension;
  }

  generateIvrMenuOptions(ivr, org) {
    let options = `; IVR Menu Options for ${ivr.name}\n`;

    if (!ivr.menuOptions || ivr.menuOptions.length === 0) {
      options += `; No menu options configured\n\n`;
      return options;
    }

    ivr.menuOptions.forEach(option => {
      options += `exten => ${option.digit},1,NoOp(IVR Option ${option.digit}: ${option.description || option.action_type})\n`;

      switch (option.action_type) {
        case 'extension':
          if (option.action_destination) {
            options += `exten => ${option.digit},n,Goto(${org.context_prefix}_internal,${option.action_destination},1)\n`;
          } else {
            options += `exten => ${option.digit},n,Playback(number-not-in-service)\n`;
            options += `exten => ${option.digit},n,Hangup()\n`;
          }
          break;

        case 'queue':
          if (option.action_destination) {
            const queue = org.queues?.find(q => q.id === option.action_destination);
            if (queue) {
              options += `exten => ${option.digit},n,Goto(${org.context_prefix}_queue,${queue.number},1)\n`;
            } else {
              options += `exten => ${option.digit},n,Playback(number-not-in-service)\n`;
              options += `exten => ${option.digit},n,Hangup()\n`;
            }
          }
          break;

        case 'ivr':
          if (option.action_destination) {
            const targetIvr = org.ivrs?.find(i => i.id === option.action_destination);
            if (targetIvr) {
              options += `exten => ${option.digit},n,Goto(${org.context_prefix}_ivr,${targetIvr.extension},1)\n`;
            } else {
              options += `exten => ${option.digit},n,Playback(number-not-in-service)\n`;
              options += `exten => ${option.digit},n,Hangup()\n`;
            }
          }
          break;

        case 'voicemail':
          if (option.action_destination) {
            options += `exten => ${option.digit},n,VoiceMail(${option.action_destination}@${org.context_prefix}vm)\n`;
          } else {
            options += `exten => ${option.digit},n,VoiceMailMain(@${org.context_prefix}vm)\n`;
          }
          options += `exten => ${option.digit},n,Hangup()\n`;
          break;

        case 'callback':
          options += `exten => ${option.digit},n,Playback(callback-activated)\n`;
          options += `exten => ${option.digit},n,Set(CALLBACK_NUMBER=\${CALLERID(num)})\n`;
          options += `exten => ${option.digit},n,Hangup()\n`;
          break;

        case 'ai_agent':
          // action_destination is a user UUID whose routing_type='ai_agent';
          // that user's extension exists in the internal context with a
          // Stasis() hand-off to the bot framework. Go there.
          if (option.action_destination) {
            const aiUser = org.users?.find(u => u.id === option.action_destination && u.routing_type === 'ai_agent');
            if (aiUser) {
              options += `exten => ${option.digit},n,Goto(${org.context_prefix}_internal,${aiUser.extension},1)\n`;
            } else {
              options += `exten => ${option.digit},n,Playback(number-not-in-service)\n`;
              options += `exten => ${option.digit},n,Hangup()\n`;
            }
          }
          break;

        case 'hangup':
          options += `exten => ${option.digit},n,Playback(goodbye)\n`;
          options += `exten => ${option.digit},n,Hangup()\n`;
          break;

        default:
          options += `exten => ${option.digit},n,Playback(number-not-in-service)\n`;
          options += `exten => ${option.digit},n,Hangup()\n`;
      }

      options += `\n`;
    });

    // Enable direct dial if configured
    if (ivr.enable_direct_dial) {
      options += `; Direct Extension Dialing\n`;
      options += `exten => _XXXX,1,NoOp(Direct dial extension \${EXTEN})\n`;
      options += `exten => _XXXX,n,Goto(${org.context_prefix}_internal,\${EXTEN},1)\n\n`;
    }

    return options;
  }

  generateQueueExtension(queue, org) {
    let extension = `; Queue ${queue.number} - ${queue.name}\n`;
    extension += `exten => ${queue.number},1,NoOp(Entering queue ${queue.name})\n`;
    extension += `exten => ${queue.number},n,Set(__ORG_ID=${org.id})\n`;
    extension += `exten => ${queue.number},n,Set(__QUEUE_ID=${queue.id})\n`;
    extension += `exten => ${queue.number},n,Set(CDR(accountcode)=${org.id})\n`;
    extension += `exten => ${queue.number},n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;

    // Set music on hold
    extension += `exten => ${queue.number},n,Set(CHANNEL(musicclass)=${queue.music_on_hold})\n`;

    // Always answer the channel before Queue() runs — without it the caller
    // stays in early-media and Queue() can't play MOH or hold prompts. Wait
    // 0.5s lets the answer settle before audio plays.
    extension += `exten => ${queue.number},n,Answer()\n`;
    extension += `exten => ${queue.number},n,Wait(0.5)\n`;

    // Play greeting if one is configured
    if (queue.greeting_id) {
      extension += `exten => ${queue.number},n,Playback(/var/lib/asterisk/sounds/greetings/greeting_${queue.greeting_id})\n`;
    }

    // Call recording: defaults ON when org-level recording is enabled.
    // Per-queue `recording_enabled = false` opts out; anything else records.
    const orgRecordingEnabledQ = org.settings?.recording_enabled !== false;
    const queueRecording = queue.recording_enabled !== false && orgRecordingEnabledQ;
    if (queueRecording) {
      extension += `exten => ${queue.number},n,Set(MIXMONITOR_FILENAME=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${CALLERID(num)}-queue-${queue.number}.wav)\n`;
      extension += `exten => ${queue.number},n,Set(CDR(recordingfile)=\${MIXMONITOR_FILENAME})\n`;
      extension += `exten => ${queue.number},n,MixMonitor(/var/spool/asterisk/monitor/\${MIXMONITOR_FILENAME})\n`;
    }

    // Queue announcement
    if (queue.announce_holdtime) {
      extension += `exten => ${queue.number},n,Playback(queue-periodic-announce)\n`;
    }

    // Queue() options:
    //   c — return to dialplan when the callee (member) hangs up. Without
    //       this, member-drop would silently end the call.
    //   t — allow the called party to transfer the caller (kept for legacy
    //       feature use — supervisors transferring between queues).
    // 5th arg is the OVERALL max-wait timeout for this queue session
    // (caller patience cap). When this expires, QUEUESTATUS=TIMEOUT and
    // we route the caller to the configured timeout destination below.
    const queueOptions = 'ct';
    extension += `exten => ${queue.number},n,Queue(${queue.asterisk_queue_name},${queueOptions},,,${queue.max_wait_time || 45})\n`;

    // Store queue metadata in CDR (available after Queue() returns)
    extension += `exten => ${queue.number},n,Set(CDR(queue_name)=${queue.name})\n`;
    extension += `exten => ${queue.number},n,Set(CDR(queue_wait_time)=\${QUEUEHOLDTIME})\n`;
    extension += `exten => ${queue.number},n,Set(CDR(answered_agent)=\${MEMBERINTERFACE})\n`;

    // Post-Queue() routing.
    //
    // Critical: `GotoIf(${QUEUESTATUS}=TIMEOUT?...)` (without `$[...]`)
    // does NOT do string comparison — Asterisk evaluates the post-
    // substitution string as a generic truthiness check, and ANY non-
    // empty string is true. That meant a previous version of this
    // generator routed every Queue() exit (including ANSWERED and
    // CONTINUE) to the timeout destination, causing the 2026-05-15
    // Thangavelu Hospital incident where every answered call ended
    // by dialing the timeout destination after the member hung up.
    // Wrap conditions in `$[...]` so Asterisk evaluates them as proper
    // string equality (`$[STR1=STR2]` returns 1 or 0).
    //
    // QUEUESTATUS values:
    //   TIMEOUT — caller exceeded max-wait without anyone answering.
    //             Route to operator-configured timeout destination.
    //   ANSWERED — a member picked up. Whether the call was a long
    //             conversation or the member dropped quickly, the
    //             caller's leg may still be alive. Just hang up
    //             gracefully — do not retry, do not playback.
    //   CONTINUE — caller pressed a digit to exit the queue. Hang up
    //             without playback.
    //   JOINEMPTY/LEAVEEMPTY/JOINUNAVAIL/FULL — no members available.
    //             Play "all-agents-busy" then hang up.
    //
    // If the caller hangs up while in queue, the channel is destroyed
    // and Asterisk does not execute this post-Queue() block — only the
    // h-extension hangup handler fires.
    extension += `exten => ${queue.number},n,GotoIf($[\${QUEUESTATUS}=TIMEOUT]?timeout)\n`;
    extension += `exten => ${queue.number},n,GotoIf($[\${QUEUESTATUS}=ANSWERED]?normal_end)\n`;
    extension += `exten => ${queue.number},n,GotoIf($[\${QUEUESTATUS}=CONTINUE]?normal_end)\n`;
    // Fall-through reaches here only for JOINEMPTY/LEAVEEMPTY/JOINUNAVAIL/FULL.
    // Jump to the (unavail) label below so the caller hears "all
    // agents are busy" before the call ends. The label MUST exist —
    // a Goto with no target produces an Asterisk runtime warning and
    // drops the call.
    extension += `exten => ${queue.number},n,Goto(unavail)\n`;
    // normal_end label — graceful hangup for ANSWERED/CONTINUE.
    extension += `exten => ${queue.number},n(normal_end),Hangup()\n`;

    // TIMEOUT branch — caller exceeded max-wait. Route to configured
    // destination, or play a "no agents available" prompt if none.
    if (queue.timeout_destination) {
      if (queue.timeout_destination_type === "queue") {
        extension += `exten => ${queue.number},n(timeout),Goto(${org.context_prefix}_queue,${queue.timeout_destination},1)\n`;
      } else if (queue.timeout_destination_type === "phone") {
        const trk2 = (org.outboundRoutes && org.outboundRoutes[0] && org.outboundRoutes[0].trunk) || {};
        const trunkEp2 = trk2.asterisk_peer_name || (org.context_prefix + "trunk");
        let destNum = queue.timeout_destination.replace(/[^0-9]/g, "");
        if (destNum.length > 10) destNum = destNum.slice(-10);
        extension += `exten => ${queue.number},n(timeout),Dial(PJSIP/${destNum}@${trunkEp2},30,tT)\n`;
        extension += `exten => ${queue.number},n,Hangup()\n`;
      } else {
        extension += `exten => ${queue.number},n(timeout),Goto(${org.context_prefix}_internal,${queue.timeout_destination},1)\n`;
      }
    } else {
      extension += `exten => ${queue.number},n(timeout),Playback(queue-no-agents-available)\n`;
      extension += `exten => ${queue.number},n,Hangup()\n`;
    }

    // unavail label — JOINEMPTY/LEAVEEMPTY/JOINUNAVAIL/FULL queue states.
    // Caller is still alive but the queue could not engage any member.
    extension += `exten => ${queue.number},n(unavail),Playback(all-agents-busy)\n`;
    extension += `exten => ${queue.number},n,Hangup()\n`;
    extension += `\n`;

    return extension;
  }

  generateHangupHandlerContext(org) {
    const context = `${org.context_prefix}_hangup`;
    let handler = `[${context}]\n`;
    handler += `; Hangup handler — store org_id, hangup info, and call metadata\n`;
    handler += `exten => h,1,NoOp(Hangup: ORG=\${ORG_ID} CAUSE=\${HANGUPCAUSE} SOURCE=\${CHANNEL(hangupsource)})\n`;
    handler += `exten => h,n,Set(CDR(organization_id)=\${ORG_ID})\n`;
    handler += `exten => h,n,Set(CDR(userfield)=\${HANGUPCAUSE}|\${CHANNEL(hangupsource)})\n`;
    handler += `exten => h,n,Set(CDR(hangup_reason)=\${HANGUPCAUSE})\n`;
    handler += `exten => h,n,Return()\n\n`;

    return handler;
  }

  generateSpecialExtensions(org) {
    let special = `; Special extensions and helper functions\n`;

    // === TESTING & DIAGNOSTICS ===
    // Echo test
    special += `; Echo Test\n`;
    special += `exten => *43,1,NoOp(Echo Test)\n`;
    special += `exten => *43,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *43,n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;
    special += `exten => *43,n,Playback(demo-echotest)\n`;
    special += `exten => *43,n,Echo()\n`;
    special += `exten => *43,n,Hangup()\n\n`;

    // Audio quality test (milliwatt tone)
    special += `; Audio Quality Test (1004hz tone)\n`;
    special += `exten => *87,1,NoOp(Audio Quality Test)\n`;
    special += `exten => *87,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *87,n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;
    special += `exten => *87,n,Playback(demo-moreinfo)\n`;
    special += `exten => *87,n,Milliwatt()\n`;
    special += `exten => *87,n,Hangup()\n\n`;

    // Connection test
    special += `; Connection Test\n`;
    special += `exten => *99,1,NoOp(Connection Test)\n`;
    special += `exten => *99,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *99,n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;
    special += `exten => *99,n,Playback(demo-abouttotry)\n`;
    special += `exten => *99,n,Wait(2)\n`;
    special += `exten => *99,n,Playback(connection)\n`;
    special += `exten => *99,n,Playback(is-successful)\n`;
    special += `exten => *99,n,Hangup()\n\n`;

    // === TIME & DATE FUNCTIONS ===
    // Say current time
    special += `; Say Current Time\n`;
    special += `exten => *60,1,NoOp(Current Time)\n`;
    special += `exten => *60,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *60,n,Playback(the-time-is)\n`;
    special += `exten => *60,n,SayUnixTime(\${EPOCH},,HM)\n`;
    special += `exten => *60,n,Hangup()\n\n`;

    // Say current date
    special += `; Say Current Date\n`;
    special += `exten => *61,1,NoOp(Current Date)\n`;
    special += `exten => *61,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *61,n,Playback(today-is)\n`;
    special += `exten => *61,n,SayUnixTime(\${EPOCH},,ABdY)\n`;
    special += `exten => *61,n,Hangup()\n\n`;

    // Say current time and date
    special += `; Say Current Time and Date\n`;
    special += `exten => *62,1,NoOp(Current Time and Date)\n`;
    special += `exten => *62,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *62,n,Playback(todays-date-is)\n`;
    special += `exten => *62,n,SayUnixTime(\${EPOCH},,ABdY)\n`;
    special += `exten => *62,n,Wait(1)\n`;
    special += `exten => *62,n,Playback(the-time-is)\n`;
    special += `exten => *62,n,SayUnixTime(\${EPOCH},,HM)\n`;
    special += `exten => *62,n,Hangup()\n\n`;

    // === INFORMATION SERVICES ===
    // Say extension number
    special += `; Say My Extension Number\n`;
    special += `exten => *65,1,NoOp(Say My Extension)\n`;
    special += `exten => *65,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *65,n,Playback(your-extension-is)\n`;
    special += `exten => *65,n,SayDigits(\${CALLERID(num)})\n`;
    special += `exten => *65,n,Hangup()\n\n`;

    // Directory lookup
    special += `; Company Directory\n`;
    special += `exten => 411,1,NoOp(Company Directory)\n`;
    special += `exten => 411,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => 411,n,Directory(${org.context_prefix}vm)\n`;
    special += `exten => 411,n,Hangup()\n\n`;

    // System status
    special += `; System Status\n`;
    special += `exten => *44,1,NoOp(System Status)\n`;
    special += `exten => *44,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *44,n,Playback(system)\n`;
    special += `exten => *44,n,Playback(is-operational)\n`;
    special += `exten => *44,n,Playback(thank-you)\n`;
    special += `exten => *44,n,Hangup()\n\n`;

    // === VOICEMAIL & MESSAGING ===
    // Voicemail access
    special += `; Voicemail Access\n`;
    special += `exten => *97,1,NoOp(Voicemail Access)\n`;
    special += `exten => *97,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *97,n,VoiceMailMain(@${org.context_prefix}vm)\n`;
    special += `exten => *97,n,Hangup()\n\n`;

    // Check voicemail
    special += `; Check Voicemail\n`;
    special += `exten => *98,1,NoOp(Check Voicemail)\n`;
    special += `exten => *98,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *98,n,VoiceMailMain(\${CALLERID(num)}@${org.context_prefix}vm)\n`;
    special += `exten => *98,n,Hangup()\n\n`;

    // === CONFERENCE & COLLABORATION ===
    // Conference rooms
    special += `; Conference Rooms\n`;
    special += `exten => _8XXX,1,NoOp(Conference Room \${EXTEN:1})\n`;
    special += `exten => _8XXX,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => _8XXX,n,Playback(conf-enteringno)\n`;
    special += `exten => _8XXX,n,SayNumber(\${EXTEN:1})\n`;
    special += `exten => _8XXX,n,ConfBridge(${org.context_prefix}\${EXTEN:1})\n`;
    special += `exten => _8XXX,n,Hangup()\n\n`;

    // Meet me conference
    special += `; Meet Me Conference\n`;
    special += `exten => _9XXX,1,NoOp(Meet Me Conference \${EXTEN:1})\n`;
    special += `exten => _9XXX,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => _9XXX,n,MeetMe(\${EXTEN:1}|dM)\n`;
    special += `exten => _9XXX,n,Hangup()\n\n`;

    // === CALL MANAGEMENT ===
    // Call parking
    special += `; Call Parking\n`;
    special += `exten => 700,1,NoOp(Call Parking)\n`;
    special += `exten => 700,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => 700,n,Park()\n`;
    special += `exten => 700,n,Hangup()\n\n`;

    // Pickup groups
    special += `; Directed Call Pickup\n`;
    special += `exten => *8,1,NoOp(Directed Call Pickup)\n`;
    special += `exten => *8,n,Pickup(\${EXTEN:2}@PICKUPMARK)\n`;
    special += `exten => *8,n,Hangup()\n\n`;

    // Group call pickup
    special += `; Group Call Pickup\n`;
    special += `exten => **,1,NoOp(Group Call Pickup)\n`;
    special += `exten => **,n,PickupChan(PJSIP)\n`;
    special += `exten => **,n,Hangup()\n\n`;

    // === FEATURE CODES ===
    // Do Not Disturb toggle
    special += `; Do Not Disturb Toggle\n`;
    special += `exten => *78,1,NoOp(DND Enable)\n`;
    special += `exten => *78,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *78,n,Set(DB(DND/\${CALLERID(num)})=YES)\n`;
    special += `exten => *78,n,Playback(do-not-disturb)\n`;
    special += `exten => *78,n,Playback(activated)\n`;
    special += `exten => *78,n,Hangup()\n\n`;

    special += `exten => *79,1,NoOp(DND Disable)\n`;
    special += `exten => *79,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *79,n,DBdel(DND/\${CALLERID(num)})\n`;
    special += `exten => *79,n,Playback(do-not-disturb)\n`;
    special += `exten => *79,n,Playback(de-activated)\n`;
    special += `exten => *79,n,Hangup()\n\n`;

    // Call forwarding
    special += `; Call Forward Always - Set\n`;
    special += `exten => _*72.,1,NoOp(Call Forward Set to \${EXTEN:3})\n`;
    special += `exten => _*72.,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => _*72.,n,Set(DB(CF/\${CALLERID(num)})=\${EXTEN:3})\n`;
    special += `exten => _*72.,n,Playback(call-fwd-on)\n`;
    special += `exten => _*72.,n,SayDigits(\${EXTEN:3})\n`;
    special += `exten => _*72.,n,Hangup()\n\n`;

    special += `exten => *73,1,NoOp(Call Forward Cancel)\n`;
    special += `exten => *73,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *73,n,DBdel(CF/\${CALLERID(num)})\n`;
    special += `exten => *73,n,Playback(call-fwd-off)\n`;
    special += `exten => *73,n,Hangup()\n\n`;

    // === SPEED DIAL ===
    // Speed dial programming
    special += `; Speed Dial Programming\n`;
    special += `exten => _*74[0-9].,1,NoOp(Speed Dial \${EXTEN:3:1} Set to \${EXTEN:4})\n`;
    special += `exten => _*74[0-9].,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => _*74[0-9].,n,Set(DB(SPEEDIAL/\${CALLERID(num)}/\${EXTEN:3:1})=\${EXTEN:4})\n`;
    special += `exten => _*74[0-9].,n,Playback(speed-dial)\n`;
    special += `exten => _*74[0-9].,n,SayNumber(\${EXTEN:3:1})\n`;
    special += `exten => _*74[0-9].,n,Playback(is-set-to)\n`;
    special += `exten => _*74[0-9].,n,SayDigits(\${EXTEN:4})\n`;
    special += `exten => _*74[0-9].,n,Hangup()\n\n`;

    // Speed dial usage
    special += `; Speed Dial Usage\n`;
    special += `exten => _*75[0-9],1,NoOp(Speed Dial \${EXTEN:3:1})\n`;
    special += `exten => _*75[0-9],n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => _*75[0-9],n,Set(SPEED_NUMBER=\${DB(SPEEDIAL/\${CALLERID(num)}/\${EXTEN:3:1})})\n`;
    special += `exten => _*75[0-9],n,GotoIf(\${LEN(\${SPEED_NUMBER})}?dial:notset)\n`;
    special += `exten => _*75[0-9],n(dial),Dial(Local/\${SPEED_NUMBER}@${org.context_prefix}_internal)\n`;
    special += `exten => _*75[0-9],n,Hangup()\n`;
    special += `exten => _*75[0-9],n(notset),Playback(speed-dial)\n`;
    special += `exten => _*75[0-9],n,SayNumber(\${EXTEN:3:1})\n`;
    special += `exten => _*75[0-9],n,Playback(not-yet-set)\n`;
    special += `exten => _*75[0-9],n,Hangup()\n\n`;

    // === RECORDING & MONITORING ===
    // Start/stop call recording (changed from *1 to *3 to avoid conflict with transfer patterns)
    special += `; Toggle Call Recording\n`;
    special += `exten => *3,1,NoOp(Toggle Recording)\n`;
    special += `exten => *3,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *3,n,MixMonitor(\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${CALLERID(num)}-manual.wav)\n`;
    special += `exten => *3,n,Playback(beep)\n`;
    special += `exten => *3,n,Return()\n\n`;

    // Music on hold test
    special += `; Music on Hold Test\n`;
    special += `exten => *50,1,NoOp(Music on Hold Test)\n`;
    special += `exten => *50,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *50,n,Playback(demo-moreinfo)\n`;
    special += `exten => *50,n,MusicOnHold()\n`;
    special += `exten => *50,n,Hangup()\n\n`;

    // === PAGING & INTERCOM ===
    // All-call paging
    special += `; All-Call Paging\n`;
    special += `exten => *70,1,NoOp(All-Call Paging)\n`;
    special += `exten => *70,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => *70,n,Page(Local/\${DB_KEYS(device/state)}@${org.context_prefix}_internal&)\n`;
    special += `exten => *70,n,Hangup()\n\n`;

    // Intercom
    special += `; Intercom\n`;
    special += `exten => _*0XXX,1,NoOp(Intercom to \${EXTEN:2})\n`;
    special += `exten => _*0XXX,n,Set(__ORG_ID=${org.id})\n`;
    special += `exten => _*0XXX,n,Page(PJSIP/\${EXTEN:2})\n`;
    special += `exten => _*0XXX,n,Hangup()\n\n`;

    return special;
  }

  generateTransferPatterns(org) {
    let transfer = `; Transfer patterns\n`;

    // Blind transfer to extension
    transfer += `exten => _*1XXX,1,NoOp(Blind Transfer to \${EXTEN:2})\n`;
    transfer += `exten => _*1XXX,n,Set(__ORG_ID=${org.id})\n`;
    transfer += `exten => _*1XXX,n,Transfer(\${EXTEN:2}@${org.context_prefix}_internal)\n\n`;

    // Attended transfer
    transfer += `exten => _*2XXX,1,NoOp(Attended Transfer to \${EXTEN:2})\n`;
    transfer += `exten => _*2XXX,n,Set(__ORG_ID=${org.id})\n`;
    transfer += `exten => _*2XXX,n,Dial(Local/\${EXTEN:2}@${org.context_prefix}_internal,,t)\n`;
    transfer += `exten => _*2XXX,n,Hangup()\n\n`;

    return transfer;
  }

  generateRoutingRule(rule, org) {
    let routing = `; Routing rule: ${rule.name}\n`;

    // Add conditions and time restrictions
    if (rule.time_restrictions) {
      routing += `exten => s,1,GotoIfTime(${rule.time_restrictions.hours || '*'}:${rule.time_restrictions.days || '*'}:${rule.time_restrictions.months || '*'}:*?continue:next)\n`;
      routing += `exten => s,n(continue),NoOp(Time restriction passed)\n`;
      routing += `exten => s,n(next),NoOp(Time restriction failed)\n`;
    }

    // Apply action based on action_type
    switch (rule.action_type) {
      case 'extension':
        routing += `exten => s,n,Goto(${org.context_prefix}_internal,${rule.action_data.extension},1)\n`;
        break;
      case 'queue':
        routing += `exten => s,n,Goto(${org.context_prefix}_queue,${rule.action_data.queue},1)\n`;
        break;
      case 'hangup':
        routing += `exten => s,n,Hangup(${rule.action_data.cause || 16})\n`;
        break;
    }

    routing += `\n`;
    return routing;
  }

  async generateCompleteDialplan() {
    try {
      console.log('🎯 Generating complete dialplan for all organizations...');

      const organizations = await Organization.findAll({
        where: { status: 'active' },
        include: [
          { model: User, as: 'users', where: { status: 'active' }, required: false },
          { model: Queue, as: 'queues', where: { status: 'active' }, required: false },
          { model: DidNumber, as: 'dids', where: { status: 'active' }, required: false },
          { model: RoutingRule, as: 'routingRules', where: { active: true }, required: false },
          {
            model: Ivr,
            as: 'ivrs',
            where: { status: 'active' },
            required: false,
            include: [{ model: IvrMenu, as: 'menuOptions', required: false }]
          },
          {
            model: OutboundRoute,
            as: 'outboundRoutes',
            where: { status: 'active' },
            required: false,
            include: [{ model: SipTrunk, as: 'trunk' }]
          }
        ]
      });

      let completeDialplan = `; Auto-generated Asterisk dialplan\n`;
      completeDialplan += `; Generated at: ${new Date().toISOString()}\n\n`;

      for (const org of organizations) {
        completeDialplan += `; Organization: ${org.name} (${org.id})\n`;
        completeDialplan += `; Context prefix: ${org.context_prefix}\n\n`;

        const orgDialplans = await this.generateDialplansForOrganization(org.id);

        Object.entries(orgDialplans.contexts).forEach(([contextName, contextContent]) => {
          completeDialplan += contextContent + '\n';
        });
      }

      console.log('✅ Complete dialplan generated successfully');
      return completeDialplan;

    } catch (error) {
      console.error('❌ Error generating complete dialplan:', error);
      throw error;
    }
  }

  async writeDialplanToFile(filePath) {
    const fs = require('fs').promises;

    try {
      // Ensure recording directory exists before generating dialplan
      await this.ensureRecordingDirectoryExists();

      const dialplan = await this.generateCompleteDialplan();
      await fs.writeFile(filePath, dialplan, 'utf8');
      console.log(`✅ Dialplan written to: ${filePath}`);
      return true;
    } catch (error) {
      console.error('❌ Error writing dialplan file:', error);
      throw error;
    }
  }
}

module.exports = DialplanGenerator;