const { Organization, User, Queue, DidNumber, RoutingRule, Ivr, IvrMenu, OutboundRoute, SipTrunk } = require('../../models');

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
          { model: Queue, as: 'queues' },
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

    // Add context includes
    dialplan += `include => ${org.context_prefix}_outbound\n`;
    dialplan += `include => ${org.context_prefix}_queue\n\n`;

    // Generate extension dialplan for each user
    org.users.forEach(user => {
      if (user.status === 'active') {
        dialplan += this.generateUserExtension(user, org);
      }
    });

    // Add special extensions
    dialplan += this.generateSpecialExtensions(org);

    // Add transfer patterns
    dialplan += this.generateTransferPatterns(org);

    return dialplan;
  }

  generateUserExtension(user, org) {
    const endpoint = user.asterisk_endpoint;
    let extension = `; Extension ${user.extension} - ${user.full_name}\n`;
    extension += `exten => ${user.extension},1,NoOp(Calling ${user.full_name})\n`;
    extension += `exten => ${user.extension},n,Set(CALLERID(name)=\${CALLERID(name)})\n`;
    extension += `exten => ${user.extension},n,Set(ORG_ID=${org.id})\n`;
    extension += `exten => ${user.extension},n,Set(USER_ID=${user.id})\n`;
    extension += `exten => ${user.extension},n,Set(CDR(accountcode)=${org.id})\n`;
    extension += `exten => ${user.extension},n,Set(CHANNEL(hangup_handler_push)=${org.context_prefix}_hangup,h,1)\n`;

    // Call recording if enabled
    if (user.call_recording) {
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
      extension += `exten => ${user.extension},n,Set(CALLERID(num)=${(org.dids && org.dids[0] && org.dids[0].number) || "08065978002"})\n`;
      extension += `exten => ${user.extension},n,Dial(PJSIP/${phoneNum}@${trunkEp},30,tT)\n`;








    } else if (user.routing_type === 'ai_agent' && user.routing_destination) {
      // AI agent routing — enter Stasis with WSS URL
      extension += `exten => ${user.extension},n,Stasis(${org.stasis_app || 'pbx_api'},ai_agent,${user.routing_destination})\n`;
      extension += `exten => ${user.extension},n,Goto(end)\n`;
    } else {
      // SIP routing — check device state and dial
      extension += `exten => ${user.extension},n,Set(DEVSTATE=\${DEVICE_STATE(PJSIP/${endpoint})})\n`;
      extension += `exten => ${user.extension},n,GotoIf(\${DEVSTATE}=NOT_INUSE?available:check_busy)\n`;
      extension += `exten => ${user.extension},n(check_busy),GotoIf(\${DEVSTATE}=BUSY?busy:offline)\n`;

      extension += `exten => ${user.extension},n(available),Dial(PJSIP/${endpoint},30,tT)\n`;
      extension += `exten => ${user.extension},n,GotoIf(\${DIALSTATUS}=NOANSWER?offline:end)\n`;
      extension += `exten => ${user.extension},n,GotoIf(\${DIALSTATUS}=BUSY?busy:end)\n`;
      extension += `exten => ${user.extension},n,Goto(end)\n`;
    }

    // Offline/Unavailable handling
    extension += `exten => ${user.extension},n(offline),Playback(the-person-at-exten)\n`;
    extension += `exten => ${user.extension},n,SayDigits(${user.extension})\n`;
    extension += `exten => ${user.extension},n,Playback(is-not-available)\n`;
    extension += `exten => ${user.extension},n,Hangup()\n`;

    // Busy handling
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

    // Call recording — consent mode determines how/when MixMonitor starts
    // Recording check: org-level recording_enabled is master switch,
    // DID-level recording_enabled is per-DID override. Both must be ON.
    const orgRecordingEnabled = org.settings?.recording_enabled !== false;
    const consentMode = org._consentMode || 'announcement';
    if (orgRecordingEnabled && did.recording_enabled) {
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

      // Apply caller ID overrides ONLY if explicitly set (not null/empty)
      if (route.caller_id_override && typeof route.caller_id_override === 'string' && route.caller_id_override.trim() !== '') {
        dialplan += `exten => ${route.dial_pattern},n,Set(CALLERID(num)=${route.caller_id_override.trim()})\n`;
      }
      if (route.caller_id_name_override && typeof route.caller_id_name_override === 'string' && route.caller_id_name_override.trim() !== '') {
        dialplan += `exten => ${route.dial_pattern},n,Set(CALLERID(name)=${route.caller_id_name_override.trim()})\n`;
      }

      // Enable recording if configured (check boolean true, not just truthy)
      if (route.recording_enabled === true || route.recording_enabled === 1) {
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

    // Play greeting prompt
    if (ivr.greeting_prompt) {
      extension += `exten => ${ivr.extension},n(start),Background(${ivr.greeting_prompt})\n`;
    } else {
      extension += `exten => ${ivr.extension},n(start),Background(welcome)\n`;
    }

    // Wait for digit input
    extension += `exten => ${ivr.extension},n,WaitExten(${ivr.timeout || 10})\n`;

    // Timeout handling
    extension += `exten => t,1,NoOp(IVR Timeout)\n`;
    extension += `exten => t,n,Set(IVR_RETRIES=$[${IVR_RETRIES} + 1])\n`;
    extension += `exten => t,n,GotoIf($[${IVR_RETRIES} < ${ivr.max_retries || 3}]?${ivr.extension},start)\n`;
    if (ivr.timeout_prompt) {
      extension += `exten => t,n,Playback(${ivr.timeout_prompt})\n`;
    } else {
      extension += `exten => t,n,Playback(pm-invalid-option)\n`;
    }
    extension += `exten => t,n,Hangup()\n\n`;

    // Invalid input handling
    extension += `exten => i,1,NoOp(Invalid Input)\n`;
    extension += `exten => i,n,Set(IVR_RETRIES=$[${IVR_RETRIES} + 1])\n`;
    extension += `exten => i,n,GotoIf($[${IVR_RETRIES} < ${ivr.max_retries || 3}]?retry:maxretries)\n`;
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

    // Play greeting before entering queue
    if (queue.greeting_id) {
      extension += `exten => ${queue.number},n,Answer()\n`;
      extension += `exten => ${queue.number},n,Playback(/var/lib/asterisk/sounds/greetings/greeting_${queue.greeting_id})\n`;
    }

    // Call recording if enabled
    if (queue.recording_enabled) {
      extension += `exten => ${queue.number},n,Set(MIXMONITOR_FILENAME=\${STRFTIME(\${EPOCH},,%Y%m%d-%H%M%S)}-\${CALLERID(num)}-queue-${queue.number}.wav)\n`;
      extension += `exten => ${queue.number},n,Set(CDR(recordingfile)=\${MIXMONITOR_FILENAME})\n`;
      extension += `exten => ${queue.number},n,MixMonitor(/var/spool/asterisk/monitor/\${MIXMONITOR_FILENAME})\n`;
    }

    // Queue announcement
    if (queue.announce_holdtime) {
      extension += `exten => ${queue.number},n,Playback(queue-periodic-announce)\n`;
    }

    // Enter queue
    // Enter queue with total wait timeout via TIMEOUT(absolute)
    const queueOptions = 'ct';
    const maxWait = queue.max_wait_time || 45;
    const memberRingTime = queue.timeout || 15;
    extension += `exten => ${queue.number},n,Queue(${queue.asterisk_queue_name},${queueOptions},,,${queue.max_wait_time || 45})\n`;

    // Store queue metadata in CDR (available after Queue() returns)
    extension += `exten => ${queue.number},n,Set(CDR(queue_name)=${queue.name})\n`;
    extension += `exten => ${queue.number},n,Set(CDR(queue_wait_time)=\${QUEUEHOLDTIME})\n`;
    extension += `exten => ${queue.number},n,Set(CDR(answered_agent)=\${MEMBERINTERFACE})\n`;

    // Handle queue exit scenarios
    extension += `exten => ${queue.number},n,GotoIf(\${QUEUESTATUS}=TIMEOUT?timeout:unavail)\n`;
    extension += `exten => ${queue.number},n,GotoIf(\${QUEUESTATUS}=JOINEMPTY?unavail:unavail)\n`;
    extension += `exten => ${queue.number},n,GotoIf(\${QUEUESTATUS}=LEAVEEMPTY?unavail:unavail)\n`;
    extension += `exten => ${queue.number},n,GotoIf(\${QUEUESTATUS}=JOINUNAVAIL?unavail:unavail)\n`;

    // Timeout handling — route to destination or hangup
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

    // Unavailable handling
    extension += `exten => ${queue.number},n(unavail),Playback(all-agents-busy)\n`;
    extension += `exten => ${queue.number},n,Hangup()\n\n`;

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