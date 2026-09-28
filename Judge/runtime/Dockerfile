FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates gcc g++ openjdk-21-jdk-headless python3 nodejs npm golang-go rustc \
    && npm install -g esbuild \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY runner.py /opt/judge/runner.py
RUN chmod 644 /opt/judge/runner.py
USER 65534:65534
WORKDIR /workspace
ENTRYPOINT ["python3", "/opt/judge/runner.py"]
