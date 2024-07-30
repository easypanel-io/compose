#!/bin/bash

if [ ! -d "./repo" ]; then
    git clone --depth 1 --branch main --single-branch https://github.com/appwrite/appwrite.git repo
else
    cd repo
    git pull
    cd ..
fi

curl -s https://appwrite.io/install/compose > ./code/docker-compose.yml
curl -s https://appwrite.io/install/env > ./code/.env.example


