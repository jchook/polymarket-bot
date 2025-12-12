# Base image
FROM oven/bun:1.2.12-alpine AS app
VOLUME /app
ARG USER_ID=1000
ARG GROUP_ID=1000
# Modify the existing bun user/group to match the desired UID/GID
RUN deluser bun \
  && (delgroup bun 2>/dev/null || true) \
  && addgroup -g ${GROUP_ID} app \
  && adduser -D -h /home/app -G app -u ${USER_ID} app

# ---

# Server runtime
FROM app AS server
RUN  mkdir -p /mnt/documents /mnt/artifacts \
  && chmod 755 /mnt/documents /mnt/artifacts \
  && chown -R ${USER_ID}:${GROUP_ID} /mnt/documents /mnt/artifacts
USER ${USER_ID}
WORKDIR /app
COPY ./package.json ./bun.lockb ./
RUN bun install --production --frozen-lockfile \
  && rm -f bun.lockb
COPY ./ ./
ENTRYPOINT ["/app/bin/docker-entrypoint.sh"]
CMD ["api"]

