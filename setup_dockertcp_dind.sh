#!/bin/bash
if [[ $EUID -ne 0 ]]; then
  echo "ERR: This script must be run as root."
  exit 1
fi
if [ ! -d "/etc/docker" ]; then
  mkdir /etc/docker
fi
echo '{"hosts": ["tcp://0.0.0.0:2375", "unix:///var/run/docker.sock"]}' > /etc/docker/daemon.json
service docker restart
echo "Docker should now be set up over TCP."