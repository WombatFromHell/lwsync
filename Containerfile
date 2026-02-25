# Reproducible build container for LWSync
# Usage:
#   # Quick build with helper script (recommended)
#   ./scripts/build-container.sh
#
#   # Or manually with podman:
#   podman build -t lwsync-build .
#   podman run --rm -v .:/app:Z lwsync-build
#
#   # Or manually with docker:
#   docker build -t lwsync-build .
#   docker run --rm -v $(pwd):/app lwsync-build

FROM docker.io/oven/bun:1.3.9-alpine

# Install zip for packaging (Alpine-based image)
RUN apk update && \
  apk add --no-cache zip

# Set reproducible build environment
ENV SOURCE_DATE_EPOCH=0
ENV LC_ALL=C
ENV TZ=UTC

WORKDIR /app

# Copy dependency manifests first for better caching
COPY bun.lock package.json .bun-version ./

# Install dependencies (frozen lockfile for reproducibility)
RUN bun install --frozen-lockfile

# Create dist directory to ensure it exists for volume mount
RUN mkdir -p dist

# Build and package
CMD ["bun", "run", "package"]
