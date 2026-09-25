#!/usr/bin/env bash
#
# Deploy the portal on the institute server, in Docker.
#
#   ./scripts/deploy-server.sh
#
# Writes .env if it is not there yet (generating the database password and
# the NextAuth secret), finds the SSL certificate the institute copied
# into your home directory, builds the image and starts the three
# containers: nginx on the allocated port, the app, and PostgreSQL.
#
# Re-running it is safe: an existing .env is never overwritten, and the
# database volume is left alone, so bills already filed survive.
#
# Options, as environment variables:
#   PORTAL_PORT=8116                 the port the institute allocated
#   PORTAL_HOST=172.22.100.12        how people reach it (IP or hostname)
#   SSL_CERT_FILE=/path/to/cert      skip certificate auto-detection
#   SSL_KEY_FILE=/path/to/key
#
set -euo pipefail
cd "$(dirname "$0")/.."

PORTAL_PORT=${PORTAL_PORT:-8116}
say()  { printf '==> %s\n' "$*"; }
warn() { printf '    !  %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- docker
command -v docker >/dev/null || die "docker is not installed on this machine."
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1 || sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
    warn "using sudo for docker; to avoid it: sudo usermod -aG docker \$USER, then log out and back in"
  else
    die "cannot talk to the docker daemon (is it running, and may this user use it?)"
  fi
fi
"${DOCKER[@]}" compose version >/dev/null 2>&1 || die "the 'docker compose' plugin is not installed."

# The user's home, even when this is run through sudo.
HOME_DIR=$HOME
[ -n "${SUDO_USER:-}" ] && HOME_DIR=$(eval echo "~$SUDO_USER")

# ----------------------------------------------------------- certificate
find_cert() {
  local f
  for f in "$HOME_DIR"/*.crt "$HOME_DIR"/*.pem "$HOME_DIR"/fullchain*.pem \
           "$HOME_DIR"/certs/* "$HOME_DIR"/ssl/*; do
    [ -f "$f" ] || continue
    grep -q "BEGIN CERTIFICATE" "$f" 2>/dev/null && { echo "$f"; return; }
  done
}
find_key() {
  local f
  for f in "$HOME_DIR"/*.key "$HOME_DIR"/*.pem "$HOME_DIR"/privkey*.pem \
           "$HOME_DIR"/certs/* "$HOME_DIR"/ssl/*; do
    [ -f "$f" ] || continue
    grep -q "PRIVATE KEY" "$f" 2>/dev/null && { echo "$f"; return; }
  done
}

CERT=${SSL_CERT_FILE:-$(find_cert || true)}
KEY=${SSL_KEY_FILE:-$(find_key || true)}

if [ -z "${CERT:-}" ] || [ -z "${KEY:-}" ]; then
  warn "could not find the SSL certificate and key automatically."
  warn "files in $HOME_DIR:"
  ls -1 "$HOME_DIR" | head -20 >&2
  die "re-run with: SSL_CERT_FILE=/path/to/cert SSL_KEY_FILE=/path/to/key $0"
fi
say "certificate: $CERT"
say "private key: $KEY"
openssl x509 -in "$CERT" -noout -subject -dates 2>/dev/null | sed 's/^/    /' || \
  warn "openssl could not read that certificate -- check it is the right file"

# nginx runs as an unprivileged user inside the container and must be able
# to read the key. A key that is 0600 root-only will not mount usefully.
if [ ! -r "$KEY" ]; then
  die "$KEY is not readable by this user."
fi

# ------------------------------------------------------------------ .env
PORTAL_HOST=${PORTAL_HOST:-$(hostname -I 2>/dev/null | awk '{print $1}')}
[ -n "$PORTAL_HOST" ] || PORTAL_HOST=127.0.0.1

if [ -f .env ]; then
  say ".env already exists -- leaving its values alone"
else
  say "writing .env"
  DEMO_PW=${DEMO_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)}
  cat > .env <<EOF
# Written by scripts/deploy-server.sh on $(date -u +%Y-%m-%dT%H:%MZ)

# DATABASE_URL is not set here on purpose: docker-compose.yml points the
# app at the `db` container, and that setting wins over this file.

# The port the institute allocated. nginx listens on 8116 inside the
# container; this is what it is published as on the host.
PORTAL_PORT=$PORTAL_PORT

POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')
NEXTAUTH_SECRET=$(openssl rand -base64 32 | tr -d '\n')
NEXTAUTH_URL=https://$PORTAL_HOST:$PORTAL_PORT

SSL_CERT_FILE=$CERT
SSL_KEY_FILE=$KEY

# Pilot testing: demo accounts sign in without LDAP. Remove both lines
# (and the demo data) before the portal handles real bills.
DEMO_LOGIN_ENABLED=true
DEMO_PASSWORD=$DEMO_PW

# The demo employees have realistic @iitmandi.ac.in addresses, so mail is
# off until a real SMTP relay is configured -- otherwise a pilot run can
# email people who have nothing to do with it.
MAIL_ENABLED=false

# LDAP, for real sign-ins. Demo logins work without it.
# LDAP_URL=ldaps://<ldap-host>:636
# LDAP_BASE_DN=dc=iitmandi,dc=ac,dc=in
# OU=["students_ug","Faculty","Staff"]
EOF
  chmod 600 .env
fi

# Whatever the file says, these must be present or compose will not start.
for var in POSTGRES_PASSWORD NEXTAUTH_SECRET NEXTAUTH_URL SSL_CERT_FILE SSL_KEY_FILE; do
  grep -qE "^$var=.+" .env || die "$var is missing from .env"
done
grep -qE "^NEXTAUTH_URL=https://" .env || warn "NEXTAUTH_URL is not https -- sign-in cookies will be dropped"

# -------------------------------------------------------------- bring up
say "building the image (first run takes a few minutes)"
"${DOCKER[@]}" compose build

say "starting the containers"
"${DOCKER[@]}" compose up -d

say "waiting for the portal to answer"
URL="https://127.0.0.1:$PORTAL_PORT/login"
for _ in $(seq 1 60); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "$URL" || true)
  [ "$code" = "200" ] && break
  sleep 3
done

echo
"${DOCKER[@]}" compose ps
echo

if [ "${code:-}" = "200" ]; then
  say "the portal is up at https://$PORTAL_HOST:$PORTAL_PORT"
  BILLS=$("${DOCKER[@]}" compose exec -T db psql -U ifmp -d ifmp -tAc 'select count(*) from bills' 2>/dev/null | tr -d ' \r' || echo '?')
  say "database holds $BILLS bills"
  say "sign in as 'Dean' with DEMO_PASSWORD from .env:  grep DEMO_PASSWORD .env"
  echo
  say "next: schedule a backup"
  echo "    (crontab -l 2>/dev/null; echo \"0 2 * * *  cd $PWD && ./scripts/db-backup.sh >> /tmp/ifmp-backup.log 2>&1\") | crontab -"
else
  warn "the portal did not answer on $URL (last status: ${code:-none})"
  warn "look at:  ${DOCKER[*]} compose logs --tail=40 proxy next-app"
  exit 1
fi
