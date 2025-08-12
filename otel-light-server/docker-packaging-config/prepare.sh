#!/bin/bash

set -e

rm -fr $PROJECT_DIR/node_modules
npm install

npm run lint

npm run build

cp -R $PROJECT_DIR/node_modules $PACKAGING_FILES/
cp -R $PROJECT_DIR/dist $PACKAGING_FILES/

