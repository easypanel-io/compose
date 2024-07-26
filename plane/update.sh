#!/bin/bash

if [ ! -d "./repo" ]; then
    git clone --depth 1 --branch preview --single-branch https://github.com/makeplane/plane.git repo
else
    cd repo
    git pull
    cd ..
fi

cp -r ./repo/deploy/selfhost/. ./code
mv ./code/variables.env ./code/.env.example


