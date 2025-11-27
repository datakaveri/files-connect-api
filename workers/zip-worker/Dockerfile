# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies (if needed)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy worker code
COPY worker.py .
COPY zip_processor.py .

# Create non-root user for security
RUN useradd -m -u 1000 worker && \
    chown -R worker:worker /app

# Switch to non-root user
USER worker

# Set Python to run in unbuffered mode for better logging
ENV PYTHONUNBUFFERED=1

# Run the worker
CMD ["python", "-u", "worker.py"]

