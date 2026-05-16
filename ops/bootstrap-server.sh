#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/var/www/playground.rodion.pro
REPO=git@github.com:WizardJIOCb/playground.rodion.pro.git

sudo mkdir -p "$APP_DIR" /var/www/letsencrypt
sudo chown -R "$USER":"$USER" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi

cd "$APP_DIR"
npm install --omit=dev

sudo cp ops/playground.service /etc/systemd/system/playground.rodion.pro.service
sudo systemctl daemon-reload
sudo systemctl enable --now playground.rodion.pro.service

sudo cp ops/nginx.conf /etc/nginx/sites-available/playground.rodion.pro
sudo ln -sf /etc/nginx/sites-available/playground.rodion.pro /etc/nginx/sites-enabled/playground.rodion.pro
sudo nginx -t
sudo systemctl reload nginx

 echo "Service listens on 127.0.0.1:3357 behind nginx."
echo "Set PLAYGROUND_ADMIN_TOKEN in /etc/playground.rodion.pro.env, then restart:"
echo "sudo systemctl restart playground.rodion.pro"
