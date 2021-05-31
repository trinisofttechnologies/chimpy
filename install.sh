cd ./node_modules/xolvio-sync-webdriverio
npm install fibers@^5.0.0 --save
cd ../..

cd ./node_modules/cucumber
npm install fibers@^5.0.0 --save
cd ../..

cd ./node_modules/wdio-sync
npm install fibers@^5.0.0 --save
cd ../..

cd ./node_modules/xolvio-fiber-utils
npm install fibers@^5.0.0 --save
cd ../..

sed -i 's/Os.tmpDir()/Os.tmpdir()/g' ./node_modules/hapi/lib/defaults.js