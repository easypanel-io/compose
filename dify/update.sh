#!/bin/bash

if [ ! -d "./repo" ]; then
    git clone --depth 1 --branch main --single-branch https://github.com/langgenius/dify.git repo
else
    cd repo
    git pull
    cd ..
fi

cp -r ./repo/docker/. ./code


