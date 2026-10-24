const { app } = require('electron');
const path = require('node:path');
const directory = process.argv.find(value => value.startsWith('--memory-test-data='))?.slice('--memory-test-data='.length);
if (!directory || !path.resolve(directory).startsWith(path.resolve(__dirname, '../scratch') + path.sep)) throw Error('An isolated memory validation directory is required.');
app.setPath('userData', directory);
require('../electron/main.cjs');
