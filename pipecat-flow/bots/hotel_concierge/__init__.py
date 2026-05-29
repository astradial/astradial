#
# Luxury Hotel Concierge - The Grand Astral
# Bot module for the Pipecat Gateway
#

from loguru import logger

from pipecat_flows import FlowArgs, FlowResult, FlowsFunctionSchema, NodeConfig


# ─── Role Message ───

CONCIERGE_ROLE = (
    "You are an elite concierge at The Grand Astral, a world-renowned luxury hotel. "
    "You speak with warmth, elegance, and impeccable professionalism. "
    "Your tone is refined yet approachable, like a trusted advisor. "
    "Use graceful language but keep it natural for voice conversation. "
    "Avoid special characters and emojis. "
    "Address guests as 'sir' or 'madam' unless they share their name, then use their name. "
    "You represent the highest standard of hospitality."
)


# ─── Flow Result Types ───

class CheckinResult(FlowResult):
    guest_name: str
    confirmation_number: str
    num_guests: int
    special_requests: str


class CheckoutResult(FlowResult):
    guest_name: str
    room_number: str
    stay_feedback: str
    additional_charges: str
    needs_transport: bool


class IssueResult(FlowResult):
    issue_description: str
    room_number: str
    urgency: str
    preferred_resolution: str


# ─── Function Handlers ───

async def handle_route_checkin(args: FlowArgs) -> tuple[dict, NodeConfig]:
    logger.info(f"Routing to check-in for: {args.get('guest_name', 'unknown')}")
    return {"guest_name": args.get("guest_name", "")}, create_checkin_node()


async def handle_route_checkout(args: FlowArgs) -> tuple[dict, NodeConfig]:
    logger.info(f"Routing to check-out for: {args.get('guest_name', 'unknown')}")
    return {"guest_name": args.get("guest_name", ""), "room_number": args.get("room_number", "")}, create_checkout_node()


async def handle_route_helpdesk(args: FlowArgs) -> tuple[dict, NodeConfig]:
    logger.info(f"Routing to helpdesk for: {args.get('guest_name', 'unknown')}")
    return {"guest_name": args.get("guest_name", "")}, create_helpdesk_node()


async def handle_process_checkin(args: FlowArgs) -> tuple[CheckinResult, NodeConfig]:
    result = CheckinResult(
        guest_name=args["guest_name"],
        confirmation_number=args["confirmation_number"],
        num_guests=args["num_guests"],
        special_requests=args.get("special_requests", "None"),
    )
    logger.info(f"Check-in processed: {result['guest_name']} / {result['confirmation_number']}")
    return result, create_checkin_confirm_node()


async def handle_process_checkout(args: FlowArgs) -> tuple[CheckoutResult, NodeConfig]:
    result = CheckoutResult(
        guest_name=args["guest_name"],
        room_number=args["room_number"],
        stay_feedback=args.get("stay_feedback", ""),
        additional_charges=args.get("additional_charges", "None"),
        needs_transport=args.get("needs_transport", False),
    )
    logger.info(f"Check-out processed: {result['guest_name']} / Room {result['room_number']}")
    return result, create_checkout_confirm_node()


async def handle_route_enquiry(args: FlowArgs) -> tuple[dict, NodeConfig]:
    logger.info(f"Enquiry: {args.get('enquiry_topic', '')}")
    return {"topic": args.get("enquiry_topic", "")}, create_enquiry_node()


async def handle_route_raise_issue(args: FlowArgs) -> tuple[dict, NodeConfig]:
    logger.info(f"Issue raised: {args.get('issue_summary', '')}")
    return {"summary": args.get("issue_summary", "")}, create_raise_issue_node()


async def handle_submit_issue(args: FlowArgs) -> tuple[IssueResult, NodeConfig]:
    result = IssueResult(
        issue_description=args["issue_description"],
        room_number=args["room_number"],
        urgency=args["urgency"],
        preferred_resolution=args.get("preferred_resolution", ""),
    )
    logger.info(f"Issue submitted: {result['issue_description']} / Urgency: {result['urgency']}")
    return result, create_issue_confirm_node()


async def handle_needs_more_help(args: FlowArgs) -> tuple[None, NodeConfig]:
    return None, create_helpdesk_node()


async def handle_end_call(args: FlowArgs) -> tuple[None, NodeConfig]:
    return None, create_end_node()


# ─── Function Schemas ───

route_checkin_schema = FlowsFunctionSchema(
    name="route_to_checkin",
    description="Guest wants to check in to the hotel",
    properties={"guest_name": {"type": "string", "description": "The guest's name if provided"}},
    required=["guest_name"],
    handler=handle_route_checkin,
)

route_checkout_schema = FlowsFunctionSchema(
    name="route_to_checkout",
    description="Guest wants to check out of the hotel",
    properties={
        "guest_name": {"type": "string", "description": "The guest's name if provided"},
        "room_number": {"type": "string", "description": "The guest's room number if provided"},
    },
    required=["guest_name"],
    handler=handle_route_checkout,
)

route_helpdesk_schema = FlowsFunctionSchema(
    name="route_to_helpdesk",
    description="Guest has an enquiry or wants to raise an issue or request",
    properties={"guest_name": {"type": "string", "description": "The guest's name if provided"}},
    required=["guest_name"],
    handler=handle_route_helpdesk,
)

process_checkin_schema = FlowsFunctionSchema(
    name="process_checkin",
    description="Process the check-in with all collected guest details",
    properties={
        "guest_name": {"type": "string", "description": "Full name of the guest"},
        "confirmation_number": {"type": "string", "description": "Reservation confirmation number"},
        "num_guests": {"type": "integer", "description": "Number of guests", "minimum": 1, "maximum": 10},
        "special_requests": {"type": "string", "description": "Any special requests or preferences"},
    },
    required=["guest_name", "confirmation_number", "num_guests"],
    handler=handle_process_checkin,
)

process_checkout_schema = FlowsFunctionSchema(
    name="process_checkout",
    description="Process the check-out with all collected details",
    properties={
        "guest_name": {"type": "string", "description": "Full name of the guest"},
        "room_number": {"type": "string", "description": "Room number"},
        "stay_feedback": {"type": "string", "description": "Guest feedback about their stay"},
        "additional_charges": {"type": "string", "description": "Additional charges like minibar, room service"},
        "needs_transport": {"type": "boolean", "description": "Whether guest needs airport transfer"},
    },
    required=["guest_name", "room_number"],
    handler=handle_process_checkout,
)

route_enquiry_schema = FlowsFunctionSchema(
    name="route_to_enquiry",
    description="Guest has a general enquiry about hotel services, amenities, dining, local attractions, or policies",
    properties={"enquiry_topic": {"type": "string", "description": "Brief description of what the guest is asking about"}},
    required=["enquiry_topic"],
    handler=handle_route_enquiry,
)

route_raise_issue_schema = FlowsFunctionSchema(
    name="route_to_raise_issue",
    description="Guest wants to raise an issue, complaint, or special request",
    properties={"issue_summary": {"type": "string", "description": "Brief summary of the issue or request"}},
    required=["issue_summary"],
    handler=handle_route_raise_issue,
)

another_enquiry_schema = FlowsFunctionSchema(
    name="another_enquiry",
    description="Guest has another question or enquiry",
    properties={"enquiry_topic": {"type": "string", "description": "The new enquiry topic"}},
    required=["enquiry_topic"],
    handler=handle_route_enquiry,
)

submit_issue_schema = FlowsFunctionSchema(
    name="submit_issue",
    description="Submit the issue or request with all details collected",
    properties={
        "issue_description": {"type": "string", "description": "Detailed description of the issue or request"},
        "room_number": {"type": "string", "description": "Guest's room number"},
        "urgency": {"type": "string", "description": "Urgency level", "enum": ["immediate", "today", "no_rush"]},
        "preferred_resolution": {"type": "string", "description": "Guest's preferred resolution if any"},
    },
    required=["issue_description", "room_number", "urgency"],
    handler=handle_submit_issue,
)

needs_more_help_schema = FlowsFunctionSchema(
    name="guest_needs_more_help",
    description="Guest wants additional assistance",
    properties={},
    required=[],
    handler=handle_needs_more_help,
)

end_call_schema = FlowsFunctionSchema(
    name="end_call",
    description="Guest is satisfied and wants to end the conversation",
    properties={},
    required=[],
    handler=handle_end_call,
)


# ─── Node Factories ───

def create_welcome_node() -> NodeConfig:
    return NodeConfig(
        name="welcome",
        role_message=CONCIERGE_ROLE,
        task_messages=[{"role": "user", "content": (
            "Welcome the guest warmly to The Grand Astral. Introduce yourself as their "
            "personal concierge. Ask how you may be of service today - whether they are "
            "checking in, checking out, or need assistance with anything during their stay."
        )}],
        functions=[route_checkin_schema, route_checkout_schema, route_helpdesk_schema],
        respond_immediately=True,
    )


def create_checkin_node() -> NodeConfig:
    return NodeConfig(
        name="checkin",
        task_messages=[{"role": "user", "content": (
            "You are now handling check-in. Collect the following details from the guest "
            "one at a time in a natural conversational way: "
            "1) Confirm their full name, 2) Reservation confirmation number, "
            "3) Number of guests, 4) Any special requests or preferences "
            "(room temperature, pillow type, minibar preferences, allergies). "
            "Be attentive and make them feel valued. Once you have all details, "
            "confirm the information back to them."
        )}],
        functions=[process_checkin_schema],
    )


def create_checkin_confirm_node() -> NodeConfig:
    return NodeConfig(
        name="checkin_confirm",
        task_messages=[{"role": "user", "content": (
            "The check-in has been processed successfully. Warmly confirm the check-in, "
            "mention their room is being prepared, and let them know a bellhop will assist "
            "with their luggage. Offer information about the hotel amenities: spa, rooftop "
            "restaurant, pool, and 24-hour room service. Ask if there is anything else "
            "they need or if they would like to end the call."
        )}],
        functions=[needs_more_help_schema, end_call_schema],
    )


def create_checkout_node() -> NodeConfig:
    return NodeConfig(
        name="checkout",
        task_messages=[{"role": "user", "content": (
            "You are now handling check-out. Collect the following from the guest: "
            "1) Confirm their name and room number, 2) Ask about their stay experience, "
            "3) Ask if they used the minibar or any chargeable services, "
            "4) Ask if they need airport transfer or luggage assistance. "
            "Be gracious and express genuine interest in their experience."
        )}],
        functions=[process_checkout_schema],
    )


def create_checkout_confirm_node() -> NodeConfig:
    return NodeConfig(
        name="checkout_confirm",
        task_messages=[{"role": "user", "content": (
            "The check-out has been processed. Provide a summary of their bill, "
            "thank them sincerely for choosing The Grand Astral, mention their loyalty "
            "points earned if applicable, and express hope to welcome them back. "
            "If they requested transport, confirm it has been arranged. "
            "Ask if there is anything else before ending."
        )}],
        functions=[needs_more_help_schema, end_call_schema],
    )


def create_helpdesk_node() -> NodeConfig:
    return NodeConfig(
        name="helpdesk",
        task_messages=[{"role": "user", "content": (
            "You are now the hotel helpdesk. Ask the guest whether they have a general "
            "enquiry about the hotel and its services, or if they would like to raise "
            "an issue or special request. Listen carefully and route accordingly."
        )}],
        functions=[route_enquiry_schema, route_raise_issue_schema],
    )


def create_enquiry_node() -> NodeConfig:
    return NodeConfig(
        name="enquiry",
        task_messages=[{"role": "user", "content": (
            "Answer the guest's enquiry with detailed, helpful information. "
            "You know the following about The Grand Astral: "
            "Spa open 7am-10pm with signature treatments, "
            "Rooftop restaurant 'Celestia' serves breakfast 7-10am, lunch 12-3pm, "
            "dinner 6-11pm (dress code smart casual), "
            "Infinity pool open 6am-9pm, Fitness center 24 hours, "
            "Complimentary WiFi throughout, Room service 24 hours, "
            "Valet parking available, "
            "Concierge can arrange city tours, private dining, and special celebrations. "
            "If you don't know something, offer to connect them with the relevant department. "
            "After answering, ask if they have any other questions or need anything else."
        )}],
        functions=[another_enquiry_schema, route_raise_issue_schema, end_call_schema],
    )


def create_raise_issue_node() -> NodeConfig:
    return NodeConfig(
        name="raise_issue",
        task_messages=[{"role": "user", "content": (
            "The guest wants to raise an issue or special request. Listen with empathy "
            "and collect: 1) Detailed description of the issue or request, "
            "2) Their room number, 3) Urgency level - is this something that needs "
            "immediate attention? 4) Any preferred resolution. "
            "Apologize sincerely if it is a complaint. Assure them it will be handled "
            "with top priority. Never be defensive."
        )}],
        functions=[submit_issue_schema],
    )


def create_issue_confirm_node() -> NodeConfig:
    return NodeConfig(
        name="issue_confirm",
        task_messages=[{"role": "user", "content": (
            "The issue has been logged. Confirm the ticket details back to the guest "
            "with a reference number like GA-2026-XXXX. Provide an estimated response "
            "time based on urgency: immediate issues within 15 minutes, today within "
            "2 hours, no rush within 24 hours. Assure them a team member will personally "
            "follow up. Ask if there is anything else they need."
        )}],
        functions=[needs_more_help_schema, end_call_schema],
    )


def create_end_node() -> NodeConfig:
    return NodeConfig(
        name="farewell",
        task_messages=[{"role": "user", "content": (
            "Thank the guest graciously for calling The Grand Astral. Wish them a "
            "wonderful day or evening. If they checked in, wish them a delightful stay. "
            "If they checked out, express hope to welcome them back soon. "
            "End with warmth and class."
        )}],
        post_actions=[{"type": "end_conversation"}],
    )
