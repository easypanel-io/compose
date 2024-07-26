#!/bin/bash

# check if ./repo exists
if [ ! -d "./repo" ]; then
    git clone --depth 1 --branch master --single-branch https://github.com/supabase/supabase repo
else
    cd repo
    git pull
    cd ..
fi

# copy files from ./repo/docker to ./code
cp -r ./repo/docker/. ./code
