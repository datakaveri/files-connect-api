# Use latest Python 3.11 slim with Debian security patches
FROM python:3.11.9-slim

WORKDIR /app

# Upgrade system packages to pull in patched glibc/gnutls/linux-pam/etc.
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .
COPY zip_processor.py .

RUN useradd -m -u 1000 worker && \
    chown -R worker:worker /app

USER worker

ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "worker.py"]
