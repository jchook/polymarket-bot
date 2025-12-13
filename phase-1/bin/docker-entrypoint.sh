#!/bin/sh
set -e

CMD=${1:-app}

# Run the appropriate process
if [ "$CMD" = "app" ] || [ "$CMD" = "api" ]; then
  if [ "$NODE_ENV" = "development" ]; then
    echo "Running app in development mode"
    bun install >&2
    exec bun run --watch src/index.ts
  else
    echo "Running app in production mode"
    exec bun run src/index.ts
  fi
else
  echo "Running custom command: $*"
  exec "$@"
fi
