# Base image
FROM oven/bun:1.2-alpine AS app
VOLUME /app
ARG USER_ID=1000
ARG GROUP_ID=1000
RUN getent passwd ${USER_ID} || ( addgroup -g ${GROUP_ID} app \
  && adduser -D -G app -u ${USER_ID} app )

# ---

# Server runtime
FROM app AS server
RUN  mkdir -p /mnt/documents /mnt/artifacts \
  && chmod 755 /mnt/documents /mnt/artifacts \
  && chown -R ${USER_ID}:${GROUP_ID} /mnt/documents /mnt/artifacts
USER ${USER_ID}
WORKDIR /app/server
COPY ./server/package.json ./server/bun.lockb ./
RUN bun install --production --frozen-lockfile \
  && rm -f bun.lockb
COPY ./server/ ./
ENTRYPOINT ["/app/server/bin/docker-entrypoint.sh"]
CMD ["api"]

