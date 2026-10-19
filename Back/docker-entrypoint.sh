#!/bin/sh
set -e

echo "Running database migrations..."
node_modules/.bin/typeorm migration:run -d dist/database/data-source.js

exec "$@"
