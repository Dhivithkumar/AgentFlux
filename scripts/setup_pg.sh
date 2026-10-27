#!/bin/bash
set -e
su - postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
su - postgres -c "psql -c \"CREATE DATABASE agent_flux;\"" || true
sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" /etc/postgresql/16/main/postgresql.conf
echo "host all all 0.0.0.0/0 md5" >> /etc/postgresql/16/main/pg_hba.conf
echo "host all all ::0/0 md5" >> /etc/postgresql/16/main/pg_hba.conf
service postgresql restart
echo "Postgres configured and restarted successfully."
