# syntax=docker/dockerfile:1
# Preserve the audited v1.13.3 runtime behavior. Rebuild its immutable source
# with patched Go/x/net and the upstream authentication-log redaction backport.
FROM golang:1.27.4-bookworm@sha256:4fa7c968ba93f1635670522dbb01a2c78150443e1385746924566079f36570ea AS go-judge
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOMAXPROCS=2 GOMEMLIMIT=512MiB
WORKDIR /src
ADD --checksum=sha256:5b5293e4300de03251c3b43d38241386937012722adb44d084f8f3eb4cc79b55 https://api.github.com/repos/criyle/go-judge/tarball/4ebd2ffe9474639c665fa21cfb438f68820fe77c /tmp/go-judge.tar.gz
RUN tar -xzf /tmp/go-judge.tar.gz --strip-components=1 -C /src \
    && rm /tmp/go-judge.tar.gz
COPY go-judge-auth-redaction.patch /tmp/go-judge-auth-redaction.patch
RUN git apply --unidiff-zero --check /tmp/go-judge-auth-redaction.patch \
    && git apply --unidiff-zero /tmp/go-judge-auth-redaction.patch
COPY go-judge.go.mod ./go.mod
COPY go-judge.go.sum ./go.sum
RUN go mod download && go mod verify \
    && go test -mod=readonly -tags=nomsgpack,grpcnotrace -count=1 ./cmd/go-judge/... \
    && printf '%s\n' 'v1.13.3-unsolvable.1' > cmd/go-judge/version/version.txt \
    && go build -mod=readonly -buildvcs=false -trimpath -tags=nomsgpack,grpcnotrace -ldflags='-s -w' -o /opt/go-judge ./cmd/go-judge \
    && go version -m /opt/go-judge
# Ubuntu apt의 nodejs는 지원이 끝난 18.x이므로 공식 Node 24 바이너리를 가져옵니다.
FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS node
RUN npm install -g esbuild@0.28.2

FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

ENV DEBIAN_FRONTEND=noninteractive
# Acquire::Retries=0 is Ubuntu's mitigation while the old APT installs its own
# security update (CVE-2026-109518); do not ship an unpatched base-image APT.
RUN apt-get -o Acquire::Retries=0 update \
    && apt-get -o Acquire::Retries=0 install -y --no-install-recommends \
    apt ca-certificates gcc g++ openjdk-21-jdk-headless python3 golang-go rustc util-linux \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' apt)" ge 2.8.4ubuntu0.1 \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libapt-pkg6.0t64)" ge 2.8.4ubuntu0.1 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/LICENSE /usr/share/licenses/node/LICENSE
COPY --from=node /usr/local/lib/node_modules/esbuild /usr/local/lib/node_modules/esbuild
# 채점 명령은 /usr/bin/node를 씁니다. 둘 다 sandbox에 읽기 전용으로 mount되는 /usr 아래에 있습니다.
RUN ln -s /usr/local/bin/node /usr/bin/node && ln -s ../lib/node_modules/esbuild/bin/esbuild /usr/local/bin/esbuild

WORKDIR /opt
COPY --from=go-judge /opt/go-judge /opt/go-judge
COPY go-judge-build.json /opt/go-judge-build.json
COPY --from=go-judge /src/LICENSE /usr/share/licenses/go-judge/LICENSE
COPY --from=go-judge /usr/local/go/LICENSE /usr/share/licenses/go-judge/Go-LICENSE
COPY --from=go-judge /src/seccomp/NOTICE /usr/share/licenses/go-judge/seccomp-NOTICE
ADD --checksum=sha256:cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 https://www.apache.org/licenses/LICENSE-2.0.txt /usr/share/licenses/go-judge/seccomp-LICENSE
COPY mount.yaml health.py start.sh /opt/
EXPOSE 5050
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=10 CMD ["python3", "/opt/health.py"]
ENTRYPOINT ["/bin/sh", "/opt/start.sh"]
