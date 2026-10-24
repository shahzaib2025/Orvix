const {app}=require('electron');
const path=require('node:path');
app.setPath('userData',path.resolve(__dirname,'../scratch/screen-command-validation-user-data'));
require('../electron/main.cjs');
