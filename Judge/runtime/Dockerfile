# syntax=docker/dockerfile:1
FROM criyle/go-judge:v1.13.3 AS go-judge
# Ubuntu apt의 nodejs는 지원이 끝난 18.x이므로 공식 Node 24 바이너리를 가져옵니다.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS node
RUN npm install -g esbuild@0.28.2

FROM ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates gcc g++ openjdk-21-jdk-headless python3 golang-go rustc util-linux \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/LICENSE /usr/share/licenses/node/LICENSE
COPY --from=node /usr/local/lib/node_modules/esbuild /usr/local/lib/node_modules/esbuild
# 채점 명령은 /usr/bin/node를 씁니다. 둘 다 sandbox에 읽기 전용으로 mount되는 /usr 아래에 있습니다.
RUN ln -s /usr/local/bin/node /usr/bin/node && ln -s ../lib/node_modules/esbuild/bin/esbuild /usr/local/bin/esbuild

WORKDIR /opt
COPY --from=go-judge /opt/go-judge /opt/go-judge
ADD --checksum=sha256:a84a0427c3a1c25851a4689410a54283962a759a02558058a107470993b80c5a https://raw.githubusercontent.com/criyle/go-judge/v1.13.3/LICENSE /usr/share/licenses/go-judge/LICENSE
ADD --checksum=sha256:a8130acef4b119510fe89f6070ec27d50fbb188c8ed29c3c839bcb8dfe2b4184 https://raw.githubusercontent.com/criyle/go-judge/v1.13.3/seccomp/NOTICE /usr/share/licenses/go-judge/seccomp-NOTICE
ADD --checksum=sha256:cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 https://www.apache.org/licenses/LICENSE-2.0.txt /usr/share/licenses/go-judge/seccomp-LICENSE
COPY mount.yaml health.py start.sh /opt/
EXPOSE 5050
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=10 CMD ["python3", "/opt/health.py"]
ENTRYPOINT ["/bin/sh", "/opt/start.sh"]
