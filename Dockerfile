# APUS Reflex Harness as a long-lived evaluation service.
#
# The container holds this project's own build and its own Python SDK; nothing
# from the evaluator is copied in. `deepseek_harness.service` exposes the run
# protocol over HTTP so an external evaluator addresses it by URL.
#
# The build runs here rather than being copied in because `lib/` is generated
# output and the repository does not carry it.
FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NEXT_TELEMETRY_DISABLED=1
# bubblewrap is required, not optional: the sandbox plugin runs every tool
# command under `workspace-write` confinement and refuses to run unconfined
# when no backend exists. Without it the harness accepts a run and then fails
# every command it tries to execute.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git ripgrep build-essential make g++ xz-utils \
      bubblewrap \
 && rm -rf /var/lib/apt/lists/*
# Node comes from the official tarball rather than a second base image so the
# Python interpreter stays the one this image's package manager owns.
ARG NODE_VERSION=24.22.2
RUN arch="$(dpkg --print-architecture)" \
 && case "$arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; *) exit 1 ;; esac \
 && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 \
 && corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /workspace

# Dependency layer: manifests only, so a source change does not re-install.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY vendor ./vendor
COPY native ./native
COPY scripts ./scripts
COPY python ./python
RUN pnpm install --frozen-lockfile

# Build the harness CLI, its APUS plugins, and every package it resolves.
FROM deps AS builder
COPY . .
RUN pnpm run build

# The runtime installs the SDK that drives that build, and nothing else.
FROM builder AS runtime
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir -e /workspace/python/sdk
ENV PATH="/opt/venv/bin:${PATH}" \
    DSH_BIN=/workspace/apps/cli/lib/bin.js \
    DSH_PROFILE=sdk \
    DSH_HOME=/var/lib/dsh \
    DSH_PATCHES=/workspace/deploy/evaluation.patch.yml \
    DSH_INITIALIZE_TIMEOUT=300
RUN mkdir -p /var/lib/dsh
EXPOSE 8080
# Liveness only. `/healthz` answers whenever this process is up; whether a run
# could complete is `/readyz`, and a container must not be restarted for a
# configuration fault it reports.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4).status == 200 else 1)"
CMD ["python3", "-m", "deepseek_harness.service", "--host", "0.0.0.0", "--port", "8080"]
