FROM criyle/go-judge:v1.13.3 AS go-judge
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates gcc g++ openjdk-21-jdk-headless python3 nodejs npm golang-go rustc util-linux \
    && npm install -g esbuild \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
COPY --from=go-judge /opt/go-judge /opt/go-judge
ADD https://raw.githubusercontent.com/criyle/go-judge/v1.13.3/LICENSE /usr/share/licenses/go-judge/LICENSE
ADD https://raw.githubusercontent.com/criyle/go-judge/v1.13.3/seccomp/NOTICE /usr/share/licenses/go-judge/seccomp-NOTICE
ADD https://www.apache.org/licenses/LICENSE-2.0.txt /usr/share/licenses/go-judge/seccomp-LICENSE
COPY mount.yaml health.py start.sh /opt/
EXPOSE 5050
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=10 CMD ["python3", "/opt/health.py"]
ENTRYPOINT ["/bin/sh", "/opt/start.sh"]
