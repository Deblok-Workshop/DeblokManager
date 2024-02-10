#!/bin/bash

VERBOSE=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    *)
      echo "WARN: Unknown option: $1 ... but I'm continuing because crashing over a goofy param is stupid."
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "ERR: This script must be run as root."
  exit 1
fi

if [ ! -d "/etc/systemd" ]; then
  echo "ERR: This system seems to not be managed by systemd"
  exit 1
fi

if [ -e "/etc/docker/daemon.json" ]; then
  if [ "$VERBOSE" = true ]; then
   echo "Removing existing daemon.json"
  fi
  rm /etc/docker/daemon.json # too lazy to append
fi

if [ "$VERBOSE" = true ]; then
  echo "Configuring Docker to run over TCP..."
  echo "Adding values to Dockerd's daemon.json file"
fi

echo '{"hosts": ["tcp://0.0.0.0:2375", "unix:///var/run/docker.sock"]}' > /etc/docker/daemon.json

if [ "$VERBOSE" = true ]; then
  echo "Setting up systemd's override.conf for Docker"
fi



if [ ! -d "/etc/systemd/system/docker.service.d/" ]; then
   if [ "$VERBOSE" = true ]; then
    echo "Making docker.service.d directory"
   fi
   mkdir /etc/systemd/system/docker.service.d/
fi
if [ -e "/etc/systemd/system/docker.service.d/override.conf" ]; then
  if [ "$VERBOSE" = true ]; then
    echo "Removing existing override.conf"
  fi
  rm /etc/systemd/system/docker.service.d/override.conf
fi
touch /etc/systemd/system/docker.service.d/override.conf
if [ "$VERBOSE" = true ]; then
    echo "Writing configuration to override.conf"
fi
echo "[Service]
 ExecStart=
 ExecStart=/usr/bin/dockerd" > /etc/systemd/system/docker.service.d/override.conf
if [ "$VERBOSE" = true ]; then
  echo "Reloading systemd daemon"
fi
systemctl daemon-reload
if [ "$VERBOSE" = true ]; then
  echo "Restarting Docker service"
fi
systemctl restart docker.service
echo "Docker should be set up over TCP. Check for any errors here if it doesn't work."