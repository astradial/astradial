FROM python:3.12-slim

WORKDIR /app

# System deps for aiomysql and audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libmariadb-dev ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir -e . && pip install --no-cache-dir "pipecat-ai[google,silero,websocket,webrtc]>=0.0.105" pydub

# Copy gateway code
COPY gateway/ ./gateway/
COPY flows/ ./flows/
COPY bots/ ./bots/

EXPOSE 7860

CMD ["python", "-m", "gateway.main"]
