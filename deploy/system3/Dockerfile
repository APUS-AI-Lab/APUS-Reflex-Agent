FROM node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ musl-tools git ca-certificates bubblewrap && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ARG DSH_CLIENT_COMMIT_HASH
LABEL org.opencontainers.image.revision=$DSH_CLIENT_COMMIT_HASH
ENV DSH_CLIENT_COMMIT_HASH=$DSH_CLIENT_COMMIT_HASH DSH_CLIENT_TITLE="APUS Reflex Harness"
RUN pnpm exec tsx native/system/scripts/build.ts && pnpm run build
