/*===================
    初回証明書発行用
  ===================*/
const express = require('express');
const app = express();
app.use(express.static('./webpage'));
app.listen(80);