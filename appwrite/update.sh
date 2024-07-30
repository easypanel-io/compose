#!/bin/bash

if [ ! -d "./repo" ]; then
    git clone --depth 1 --branch main --single-branch https://github.com/appwrite/appwrite.git repo
else
    cd repo
    git pull
    cd ..
fi

cp ./repo/docker-compose.yml ./code/docker-compose.yml
cp ./repo/.env ./code/.env.example


