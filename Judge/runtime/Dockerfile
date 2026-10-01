FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates gcc g++ openjdk-21-jdk-headless python3 nodejs npm golang-go rustc \
    && npm install -g esbuild \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY runner.py execute.py /opt/judge/
RUN chmod 644 /opt/judge/runner.py /opt/judge/execute.py
USER 65534:65534
WORKDIR /workspace
ENTRYPOINT ["python3", "/opt/judge/runner.py"]
