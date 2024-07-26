#!/bin/bash

if [ ! -d "./repo" ]; then
    git clone --depth 1 --branch main --single-branch git@github.com:twentyhq/twenty.git repo
else
    cd repo
    git pull
    cd ..
fi

cp -r ./repo/packages/twenty-docker/. ./code


