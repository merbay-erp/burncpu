# burncpu — multi-stage Rust build
# Image kullanım: ~30MB runtime (debian-slim + statically-linked binary)
# Build kullanım: ~600MB (cache layer'a düşer 2. build'de saniyeler)

# ── Stage 1: Build ──────────────────────────────────────────────
FROM rust:1.93-slim-bookworm AS builder

# Native deps for sqlx (offline mode kullanmıyoruz; build-time pg yok)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Cache deps layer — Cargo.toml + Cargo.lock copy önce
COPY Cargo.toml ./
RUN mkdir -p src && \
    echo 'fn main() {}' > src/main.rs && \
    cargo build --release && \
    rm -rf src target/release/burncpu target/release/burncpu.d \
           target/release/deps/burncpu* target/release/.fingerprint/burncpu*

# Gerçek source
COPY src ./src
COPY migrations ./migrations
COPY static ./static

# SQLx compile-time validation için offline mode değil, runtime check
ENV SQLX_OFFLINE=true
RUN cargo build --release && \
    strip target/release/burncpu

# ── Stage 2: Runtime ────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# ffmpeg (+ffprobe) powers the background video transcode worker (`transcode`),
# normalising uploaded clips to H.264/AAC MP4 and extracting poster frames.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* && \
    useradd -m -u 1001 -s /bin/false burncpu

WORKDIR /app
COPY --from=builder /build/target/release/burncpu /app/burncpu
COPY --from=builder /build/migrations /app/migrations
COPY --from=builder /build/static /app/static

USER burncpu
EXPOSE 3050

ENV BIND_ADDR=0.0.0.0:3050 \
    RUST_LOG=burncpu=info,tower_http=info

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS --max-time 4 http://127.0.0.1:3050/healthz >/dev/null || exit 1

CMD ["/app/burncpu"]
