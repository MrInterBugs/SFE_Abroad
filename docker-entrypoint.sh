#!/bin/sh
set -eu

mkdir -p /usr/src/app/data
chown -R node:node /usr/src/app/data

exec su-exec node "$@"
