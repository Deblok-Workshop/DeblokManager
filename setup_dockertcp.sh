#!/bin/bash

if [[ $EUID -ne 0 ]]; then
  echo "ERR: This script must be run as root."
  exit 1
fi

if [ ! -d "/etc/systemd" ]; then
  echo "ERR: This system seems to not be managed by systemd"
  exit 1
fi

rm /etc/docker/daemon.json # too lazy to append
echo '{"hosts": ["tcp://0.0.0.0:2375", "unix:///var/run/docker.sock"]}' > /etc/docker/daemon.json
mkdir /etc/systemd/system/docker.service.d/
touch /etc/systemd/system/docker.service.d/override.conf
echo "[Service]
 ExecStart=
 ExecStart=/usr/bin/dockerd" > /etc/systemd/system/docker.service.d/override.conf
systemctl daemon-reload
systemctl restart docker.service
echo "Docker should be set up over TCP. Check for any errors here if it doesn't work."