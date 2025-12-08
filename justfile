set positional-arguments := true

# List all the commands
list:
  just --list

build:
  cd client && bun run build

# Drizzle Kit shortcut
db *args="--help":
  docker compose exec app bun drizzle-kit "$@"

# Generate OpenAPI spec and other code
gen:
  cd server && just gen && cd ../client && just gen

# View docker logs
logs:
  docker compose logs -f

# Interactive shell on the api server
sh:
  docker compose exec app bash

# Start the server
up *args="--menu":
  HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose up --build --wait "$@"

prod *args="up":
  docker compose -f docker-compose.prod.yml "$@"

rsync:
  rsync -av --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude server/storage/ \
    ./ speck:app/

deploy: rsync
  ssh speck "cd app && just prod up --build -d"
