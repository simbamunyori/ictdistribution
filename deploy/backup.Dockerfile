# The nightly backup and the restore test: PostgreSQL's own tools, openssl
# for the encryption and rclone for the off-site copy.
FROM postgres:16-alpine
RUN apk add --no-cache openssl rclone
