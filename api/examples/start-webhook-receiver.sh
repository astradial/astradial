#!/bin/bash

# Webhook Receiver Quick Start Script
# This script helps you quickly start the webhook receiver with common configurations

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎣 PBX API Webhook Receiver - Quick Start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Default values
DEFAULT_PORT=3001
DEFAULT_SECRET="${WEBHOOK_SECRET:-your_webhook_secret_here}"

# Check if port is provided
if [ -z "$1" ]; then
    PORT=$DEFAULT_PORT
    echo "Using default port: $PORT"
else
    PORT=$1
    echo "Using port: $PORT"
fi

# Check if secret is provided
if [ -z "$2" ]; then
    SECRET=$DEFAULT_SECRET
    echo "Using default secret: ***${DEFAULT_SECRET: -4}"
else
    SECRET=$2
    echo "Using secret: ***${2: -4}"
fi

echo ""
echo "Starting webhook receiver..."
echo ""
echo "📝 Configuration:"
echo "   Port:   $PORT"
echo "   Secret: ***${SECRET: -4}"
echo ""
echo "📡 Webhook URL for PBX API:"
echo "   http://localhost:$PORT/"
echo ""
echo "💡 To create webhook in PBX API, run:"
echo ""
echo "curl -X POST http://localhost:3000/api/v1/webhooks \\"
echo "  -H \"Authorization: Bearer \$YOUR_TOKEN\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{"
echo "    \"url\": \"http://localhost:$PORT/\","
echo "    \"events\": [\"call.initiated\", \"call.answered\", \"call.ended\"],"
echo "    \"secret\": \"$SECRET\","
echo "    \"active\": true"
echo "  }'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Start the receiver
node "$SCRIPT_DIR/webhook-receiver.js" "$PORT" "$SECRET"
