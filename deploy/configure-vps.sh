#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
domain=${1:-}
admin_email=${2:-}
pending_auth=false
if [[ ! $domain =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ || ${#domain} -gt 253 ]]; then
  echo 'Usage: bash deploy/configure-vps.sh opensi.YOUR_DOMAIN your-admin@gmail.com' >&2
  exit 1
fi
if [[ $admin_email == --pending-auth ]]; then
  admin_email=''
  pending_auth=true
elif [[ ! $admin_email =~ ^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$ ]]; then
  echo 'Provide the exact administrator email address, or --pending-auth to deploy with login disabled.' >&2
  exit 1
fi
if [[ -e .env.production || -L .env.production ]]; then
  echo '.env.production already exists; its encryption key was preserved. Edit it locally on the VPS to change settings.' >&2
  exit 1
fi
command -v openssl >/dev/null
encryption_key=$(openssl rand -hex 32)
if [[ ! $encryption_key =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Failed to generate the server encryption key.' >&2
  exit 1
fi
# Noclobber protects an existing secret file even if another setup runs concurrently.
set -o noclobber
{
  printf '%s\n' 'NODE_ENV=production' 'PORT=4580' 'HOST=0.0.0.0'
  printf 'APP_URL=https://%s\nOPENSI_DOMAIN=%s\nADMIN_EMAILS=%s\n' "$domain" "$domain" "$admin_email"
  printf '%s\n' 'LOCAL_DEV_AUTH=false' 'DATA_DIR=/app/data' 'OPENSI_DOCKER_ENABLED=false' 'OPENSI_TRUST_PROXY=1'
  printf 'OPENSI_ENCRYPTION_KEY=%s\n' "$encryption_key"
  printf '%s\n' 'GOOGLE_CLIENT_ID=' 'GOOGLE_CLIENT_SECRET='
} > .env.production
unset encryption_key
chmod 600 .env.production
echo 'Production configuration created. Add Google OAuth credentials directly to .env.production on the VPS.'
if [[ $pending_auth == true ]]; then
  echo 'Login is disabled until Google OAuth credentials and ADMIN_EMAILS are configured.'
fi
echo "Google redirect URI: https://$domain/api/auth/google/callback"
