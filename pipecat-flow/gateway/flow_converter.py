"""Convert editor JSON format to dynamic flow NodeConfig factories.

Supports:
- state_mappings on functions (store computed values in flow_manager.state)
- value_maps at flow level (key-value lookups for state_mappings templates)
- Template resolution via {args.x}, {state.x}, {call.x}, {value_map.name.key}
"""

from loguru import logger

from pipecat_flows import FlowArgs, FlowManager, FlowsFunctionSchema, NodeConfig

from gateway.template_engine import resolve_template


def editor_json_to_dynamic_flow(editor_json: dict):
    """Convert editor JSON into a dynamic flow module-like object.

    Returns an object with create_welcome_node() that produces NodeConfig
    with proper FlowsFunctionSchema handlers for node transitions.
    """
    nodes_by_id = {}
    initial_node_id = None

    for node in editor_json.get("nodes", []):
        nodes_by_id[node["id"]] = node
        if node.get("type") == "initial":
            initial_node_id = node["id"]

    if not initial_node_id and nodes_by_id:
        initial_node_id = list(nodes_by_id.keys())[0]

    # Load flow-level value_maps for template resolution
    value_maps = editor_json.get("value_maps", {})

    # Mutable ref to capture flow_manager once a handler runs
    # This allows build_node_config to resolve {state.x} in task_messages
    _fm_ref: list = [None]
    # Call metadata set by pipeline before initial node is built
    _call_meta_ref: list = [{}]

    def build_node_config(node_id: str) -> NodeConfig:
        """Build a NodeConfig from editor JSON node data."""
        node = nodes_by_id[node_id]
        data = node.get("data", {})

        config = NodeConfig(name=node_id)

        # Role messages
        if "role_messages" in data and data["role_messages"]:
            for msg in data["role_messages"]:
                if msg.get("role") == "system":
                    config["role_message"] = msg["content"]
                    break

        # Task messages — resolve {state.x} and {call.x} templates
        if "task_messages" in data:
            fm = _fm_ref[0]
            call_meta = getattr(fm, "call_metadata", {}) if fm is not None else _call_meta_ref[0]
            state = fm.state if fm is not None else {}
            resolved_msgs = []
            for msg in data["task_messages"]:
                resolved_content = resolve_template(
                    msg.get("content", ""),
                    state=state,
                    call=call_meta,
                    value_maps=value_maps,
                )
                resolved_msgs.append({"role": msg["role"], "content": resolved_content})
            config["task_messages"] = resolved_msgs

        # Functions — convert to FlowsFunctionSchema with transition handlers
        if "functions" in data and data["functions"]:
            schemas = []
            for func_def in data["functions"]:
                next_node = func_def.get("next_node_id")
                state_mappings = func_def.get("state_mappings", {})
                func_post_actions = func_def.get("post_actions", [])
                is_end_call = func_def.get("name") == "end_call"
                is_transfer_call = func_def.get("name") == "transfer_to_department"

                def make_handler(target_node_id, mappings, actions, end_call=False, transfer=False):
                    async def handler(args: FlowArgs, flow_manager: FlowManager):
                        # Capture flow_manager ref for future build_node_config calls
                        _fm_ref[0] = flow_manager

                        # 1. Always store raw function args in state
                        flow_manager.state.update(args)

                        # 2. Apply state_mappings with template resolution
                        if mappings:
                            call_meta = getattr(flow_manager, "call_metadata", {})
                            for key, template in mappings.items():
                                resolved = resolve_template(
                                    template,
                                    args=args,
                                    state=flow_manager.state,
                                    call=call_meta,
                                    value_maps=value_maps,
                                )
                                flow_manager.state[key] = resolved
                            logger.info(f"State after mappings: {flow_manager.state}")

                        # 3. Execute function-level post_actions (e.g. webhooks)
                        if actions:
                            for action in actions:
                                if action.get("type") == "webhook":
                                    try:
                                        from gateway.webhook_action import handle_webhook_action
                                        await handle_webhook_action(action, flow_manager)
                                    except Exception as e:
                                        logger.error(f"Function post_action failed: {e}")

                        # 4a. If transfer function, cancel pipeline and redirect call
                        if transfer:
                            import asyncio
                            task = flow_manager._task
                            call_meta_t = getattr(flow_manager, 'call_metadata', {})
                            ch_id_t = call_meta_t.get('endpoint', '') or call_meta_t.get('channel_id', '')
                            transfer_num = flow_manager.state.get('transfer_number', '')
                            dept_label = flow_manager.state.get('department_label', 'the department')
                            logger.info(f"transfer_to_department: {dept_label} → queue {transfer_num}, channel {ch_id_t}")

                            async def _do_transfer(ch_id=ch_id_t, queue=transfer_num):
                                # Play transfer announcement audio before cancelling
                                try:
                                    import wave
                                    from pipecat.frames.frames import OutputAudioRawFrame
                                    wav_path = "/opt/pipecat-flow/audio/system/transfer_hold.wav"
                                    with wave.open(wav_path, "rb") as wf:
                                        audio_data = wf.readframes(wf.getnframes())
                                        sample_rate = wf.getframerate()
                                        channels = wf.getnchannels()
                                    await task.queue_frame(OutputAudioRawFrame(
                                        audio=audio_data, sample_rate=sample_rate, num_channels=channels
                                    ))
                                    logger.info("transfer: playing announcement audio")
                                    await asyncio.sleep(3)  # Wait for audio to play
                                except Exception as e:
                                    logger.warning(f"transfer: announcement failed: {e}")
                                    await asyncio.sleep(2)
                                # Redirect FIRST (before pipeline cancel, which kills the channel)
                                if ch_id and queue:
                                    try:
                                        import httpx
                                        async with httpx.AsyncClient(timeout=5) as client:
                                            await client.post(
                                                "http://127.0.0.1:8000/api/v1/calls/transfer-channel",
                                                json={"channel_id": ch_id, "queue": queue, "org_id": getattr(flow_manager, 'call_metadata', {}).get('org_id', '')},
                                                headers={"X-Internal-Key": "4f6d990b285c38112ebea37f5ce11969232d61478ebef9a3"},
                                            )
                                        logger.info(f"transfer: redirected {ch_id} to queue {queue}")
                                    except Exception as e:
                                        logger.warning(f"transfer: redirect failed: {e}")
                                await asyncio.sleep(1)  # Let redirect take effect
                                logger.info("transfer: cancelling pipeline")
                                await task.cancel()

                            asyncio.ensure_future(_do_transfer())

                        # 4b. If end_call, schedule pipeline end after Gemini speaks
                        if end_call:
                            import asyncio
                            from pipecat.frames.frames import EndFrame
                            logger.info("end_call: will end pipeline in 8 seconds")
                            task = flow_manager._task
                            # Use the PJSIP channel name for AMI hangup (not UniqueID)
                            call_meta = getattr(flow_manager, 'call_metadata', {})
                            channel_id = call_meta.get('endpoint', '') or call_meta.get('channel_id', '')

                            async def _force_end(ch_id=channel_id):
                                await asyncio.sleep(8)
                                logger.info("end_call: forcing pipeline cancel now")
                                await task.cancel()
                                # Also hangup Asterisk channel via AMI
                                if ch_id:
                                    try:
                                        import httpx
                                        async with httpx.AsyncClient(timeout=5) as client:
                                            await client.post(
                                                "http://127.0.0.1:8000/api/v1/calls/hangup",
                                                json={"channel_id": ch_id},
                                                headers={"X-Internal-Key": "4f6d990b285c38112ebea37f5ce11969232d61478ebef9a3"},
                                            )
                                        logger.info(f"end_call: sent hangup for channel {ch_id}")
                                    except Exception as e:
                                        logger.warning(f"end_call: hangup API failed: {e}")

                            asyncio.ensure_future(_force_end())

                        # 5. Transition to next node
                        logger.info(f"Transitioning to node: {target_node_id}")
                        return args, build_node_config(target_node_id)

                    return handler

                schema = FlowsFunctionSchema(
                    name=func_def["name"],
                    description=func_def.get("description", ""),
                    properties={
                        k: v for k, v in func_def.get("properties", {}).items()
                    },
                    required=func_def.get("required", []),
                    handler=make_handler(next_node, state_mappings, func_post_actions, end_call=is_end_call, transfer=is_transfer_call) if next_node else None,
                )
                schemas.append(schema)
            config["functions"] = schemas

        # Pre/post actions — pass through as-is (webhook actions resolved at runtime by ActionManager)
        if "pre_actions" in data:
            config["pre_actions"] = data["pre_actions"]
        if "post_actions" in data:
            config["post_actions"] = data["post_actions"]

        # Respond immediately (explicitly handle false)
        if "respond_immediately" in data:
            config["respond_immediately"] = data["respond_immediately"]

        return config

    class DynamicFlow:
        @staticmethod
        def set_call_metadata(meta: dict):
            _call_meta_ref[0] = meta

        @staticmethod
        def create_welcome_node() -> NodeConfig:
            return build_node_config(initial_node_id)

    return DynamicFlow()
