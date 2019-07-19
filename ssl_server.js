const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const crypto = require('crypto');
const log4js = require('log4js');
const https = require('https');
const fs = require('fs');

const app = express();
app.use(bodyParser.urlencoded({ extended: true })); //url-encoded
app.use(bodyParser.json()); //json
app.use(express.static('./webpage'));

//#### ログ用 ####
log4js.configure({
    appenders:{
        sqlhistory:{
            type: 'file',
            filename: './log/sql_history.log',
        },
        eServer:{
            type: 'file',
            filename: './log/serverError.log'
        },
        eClient:{
            type: 'file',
            filename: './log/clientError.log'
        },
        successLog:{
            type: 'file',
            filename: './log/success.log'
        }
    },
    categories:{
        default:{
            appenders: ['sqlhistory'],
            level: 'trace'
        },
        eServer:{
            appenders: ['eServer'],
            level: 'trace'
        },
        eClient:{
            appenders: ['eClient'],
            level: 'trace'
        },
        successLog:{
            appenders: ['successLog'],
            level: 'trace'
        }
    }
});

const sqlhistory = log4js.getLogger('sqlhistory');
const eServer = log4js.getLogger('eServer');    //サーバで正しく処理できない
const eClient = log4js.getLogger('eClient');    //サーバには問題なし。(クライアント側で正しく処理できない)
const success = log4js.getLogger('successLog');



//Expressでの最初の部分での処理のエラーしょり(app.useの最後じゃないとダメ)
app.use(function(err,req,res,next){
    try{
        if(err){
            if(err['type']=='entity.parse.failed'){
                //JSONじゃないのなげきたやばいばあい(こうげきされてる)
                eClient.warn("(ExHandle) Bad Request");
                res.json({"result":"Bad Request"});
            }else{
                //なぞすぎる
                eClient.warn("### Unknown Error ###");
                res.json({"result":"Unknown Error"});
            }
        }
    }catch(ex){
        //もっとなぞすぎる
        eServer.error("(ExHandle) Error");
    }
});


const connection = mysql.createConnection({
    host: 'localhost',
    user: 'setasai',
    password: 'tcu',
    port: 3306,
    database: 'setasai'
});

//############## ポート ##################
//ufwで 443ポート開放済み (実行にroot権限必須)
const port=443;

console.log("動作開始");
eServer.info("### Server Start ###");

https.createServer({
    key: fs.readFileSync('./cert/privkey.pem'),
    cert: fs.readFileSync('./cert/cert.pem'),
    ca: fs.readFileSync('./cert/chain.pem')
},app).listen(port);

/*=======================
  ##TaskList##
  - SQLインジェクションほんとに大丈夫か(基本的には大丈夫っぽいけど)
  -型わかるように
  -各所修正しやすいように
  -高速化
=======================*/

/*
=========DB構成重要事項==========
ER_NOT_SUPPORTED_AUTH_MODE ではまった
caching_sha2_password っていう新しい認証方式にライブラリが非対応なため。
プログラムからアクセスする用のユーザつくってそいつだけ認証方式変えた。
https://qiita.com/ucan-lab/items/3ae911b7e13287a5b917
*/

var qrlist = [];
var st_qrlist="";   // tcu_Ichgokan, tcu_Syokudou, …

var sql_obj;

sql_obj=connection.query("DESCRIBE setasai 'tcu_%';", (err, results)=>{
    sqlhistory.trace(`${sql_obj['sql']}`);
    if(err){
        //エラッたら即時終了する
        eServer.error("DESCRIBE Error");
        throw new Error("DESCRIBE Error");
    }else{
        for(let index in results){
            qrlist.push(results[index]['Field']);
        }
        st_qrlist = qrlist.join(', ');
        success.log(`(QR) ${st_qrlist}`);
    }
});


//CREATE TABLE setasai (id INT AUTO_INCREMENT NOT NULL PRIMARY KEY, auth_code CHAR(13), user_agent char(150), year YEAR, date TINYINT, time TIME, tcu_Ichigokan TINYINT(1) DEFAULT 0, tcu_Syokudou TINYINT(1) DEFAULT 0, tcu_Goal TINYINT(1) DEFAULT 0);

//auth_code生成用 I i l 1 O o 0 J j は見ずらいかもしんないので使わない
const S1 = "abcdefghkmnpqrstuvwxyz23456789";
const S2 = "123456789"

//登録
app.post('/API/Entry', (req, res) => {
    let datetime = new Date();
    let user_agent = 'Unknown';
    if(req.header('User-Agent')){
        user_agent = req.header('User-Agent');
    }
    let auth_code1 = Array.from(crypto.randomFillSync(new Uint8Array(6))).map((n) => S1[n % S1.length]).join('');
    let auth_code2 = Array.from(crypto.randomFillSync(new Uint8Array(6))).map((n) => S2[n % S2.length]).join('');
    connection.beginTransaction((err) => {
        if(err){
            //トランザクション開始失敗
            eServer.error("(Entry) Transaction Error");
            res.json({ 'Result': 'Server Error 00' });
        }else{
            //トランザクション開始成功
            sql_obj=connection.query("INSERT INTO setasai(auth_code, user_agent, os, year, date, time) VALUES (?, ?, ?, ?, ?, ?);",
            [`${auth_code1}-${auth_code2}`, `${user_agent}`, `${getos(user_agent)}`, datetime.getFullYear(), datetime.getDate(), 
            `${datetime.getHours()}:${datetime.getMinutes()}:${datetime.getSeconds()}`],(err) => {
                sqlhistory.trace(`${sql_obj['sql']}`);
                if(err){
                    //INSERT失敗
                    connection.rollback();
                    eServer.error("(Entry) INSERT Error");
                    res.json({ 'Result': 'Server Error 01' });
                }else{
                    //INSERT成功
                    sql_obj=connection.query("SELECT id, auth_code FROM setasai WHERE id=LAST_INSERT_ID();", (err, results) => {
                        sqlhistory.trace(`${sql_obj['sql']}`);
                        if(err){
                            //SELECT失敗
                            connection.rollback();
                            eServer.error("(Entry) SELECT Error");
                            res.json({ 'Result': 'Server Error 02' });
                        }else{
                            //SELECT成功
                            //これがいまついかしたID = とうろくID と認証コード
                            let rjson = {
                                'Result': 'OK',
                                'id': `${results[0]['id']}`,
                                'auth_code': `${results[0]['auth_code']}`
                            };
                            connection.commit((err) => {
                                if(err){
                                    //COMMIT失敗
                                    eServer.error("(Entry) COMMIT Error");
                                    rjson = { 'Result': 'Server Error 03' };
                                }else{
                                    //COMMIT成功
                                }
                                //最終処理
                                res.json(rjson);
                                success.info(`(Entry) id=${results[0]['id']}`);
                            });//COMMIT
                        }
                    });//クエリ SELECT
                }
            });//クエリ INSERT
        }
    });//TRANSACTION
});//POST


//QR記録
app.post('/API/RecordQR', (req, res) => {
    let id = req.body['id'];
    let auth_code = req.body['auth_code'];
    let qr = req.body['qr'];
    if(!id || !auth_code || !qr){
        eClient.warn("(RecordQR) Lack Of Parameter");
        res.json({ 'Result': 'Lack Of Parameter' });
    }else{
        connection.beginTransaction((err) => {
            if(err){
                //トランザクション開始失敗
                eServer.error("(RecordQR) Transaction Error");
                res.json({ 'Result': 'Server Error 10' });
            }else{
                //トランザクション開始成功
                sql_obj=connection.query(`UPDATE setasai SET ??=1 WHERE id=? AND auth_code=?;`,
                [qr, parseFloat(id), `${auth_code}`],(err, results)=>{
                    sqlhistory.trace(`${sql_obj['sql']}`);
                    if(err){
                        //UPDATE失敗
                        connection.rollback();
                        if(err['message'].indexOf('Unknown column')!=-1){
                            //存在しないQR名
                            eClient.warn("(RecordQR) Unknown QR");
                            res.json({ 'Result': 'Unknown QR' });
                        }else{
                            //その他エラー
                            eServer.error("(RecordQR) Update Error");
                            res.json({ 'Result': 'Server Error 11' });
                        }              
                    }else{
                        //UPDATE成功
                        if(results['message'].indexOf('Rows matched: 0')!=-1){ //WHERE該当なし
                            eClient.warn("(RecordQR) Auth Faild");
                            res.json({ 'Result': 'Auth Faild' });
                        }else if(results['message'].indexOf('Changed: 0')!=-1){ //変更なし
                            res.json({ 'Result': 'Alrady Recorded' });
                        }else{ //変更OK
                            connection.commit((err)=>{
                                if(err){
                                    //COMMIT失敗
                                    connection.rollback();
                                    eServer.error("(RecordQR) COMMIT Error");
                                    res.json({ 'Result': 'Server Error 12' });
                                }else{
                                    //COMMIT成功
                                    res.json({ 'Result': 'OK' });
                                    console.log(`QRを記録しました。  ${id}  ${auth_code}  ${qr}`);
                                    success.info(`(RecordQR) id=${id}, qr=${qr}`);
                                }
                            });//COMMIT
                        }
                    }
                });//クエリ UPDATE
            }
        });//TRANSACTION
    }
});//POST




//QR確認  (トランザクションいらなそう)
app.post('/API/GetQR', (req, res) => {
    let id = req.body['id'];
    let auth_code = req.body['auth_code'];
    if(!id || !auth_code){
        eClient.warn("(GetQR) Lack Of Parameter");
        res.json({ 'Result': 'Lack Of Parameter' });
    }else{
        connection.beginTransaction((err)=>{
            if(err){
                //トランザクション開始失敗
                eServer.error("(GetQR) Transaction Error");
                res.json({ 'Result': 'Server Error 20' });
            }else{
                //トランザクション開始成功
                sql_obj=connection.query(`SELECT ?? FROM setasai WHERE id=? AND auth_code=?;`, 
                [qrlist, parseFloat(id), `${auth_code}`],(err, results)=>{
                    sqlhistory.trace(`${sql_obj['sql']}`);
                    if(err){
                        //SELECT失敗
                        connection.rollback();
                        eServer.error("(GetQR) SELECT Error");
                        res.json({ 'Result': 'Server Error 21' });
                    }else{
                        //SELECT成功
                        if(results.length==0){
                            //WHERE該当なし
                            connection.rollback();
                            eClient.warn("(GetQR) Auth Faild");
                            res.json({ 'Result': 'Auth Faild' });
                        }else{
                            //WHERE該当あり
                            connection.commit((err)=>{
                                if(err){
                                    //COMMIT失敗
                                    connection.rollback();
                                    eServer.error("(GetQR) COMMIT Error");
                                    res.json({ 'Result': 'Server Error 22' });
                                }else{
                                    //COMMIT成功
                                    let rsjson={"result": "OK"};
                                    for(index in qrlist){
                                        rsjson[`${qrlist[index]}`] = results[0][`${qrlist[index]}`];
                                    }                      
                                    res.json(rsjson);
                                }
                            });//COMMIT
                        }
                    }
                });//クエリ SELECT
            }
        });//TRANSACTION
    }
});//POST

/*
app.post('Operate/AddQR', (req, res)=>{
    let OperateID = req.body['OperateID'];
    let OperatePassword = req.body['OperatePassword'];
    let qr = req.body['qr'];
    if(!OperateID || !OperatePassword || !qr){
        eClient.warn("(AddQR) Lack Of Parameter");
        res.json({ 'Result': 'Lack Of Parameter' });
    }else{
        connection.beginTransaction((err)=>{
            if(err){
                
            }else{
                connection.query("ALTER TABLE setasai ADD ? TINYINT(1) DEFAULT 0;",[qr],(err, results)=>{
                    if(err){
                        
                    }else{
                        connection.commit((err)=>{
                            if(err){

                            }else{

                            }
                        });
                    }
                });
            }
        });
    }
});

app.post('Operate/RemoveQR', (req, res)=>{
    let OperateID = req.body['OperateID'];
    let OperatePassword = req.body['OperatePassword'];
    let qr = req.body['qr'];
    if(!OperateID || !OperatePassword || !qr){
        eClient.warn("(RemoveQR) Lack Of Parameter");
        res.json({ 'Result': 'Lack Of Parameter' });
    }else{
        connection.beginTransaction((err)=>{
            if(err){
                
            }else{
                connection.query("ALTER TABLE setasai DROP COLUMN ?;",[qr],(err, results)=>{
                    if(err){
                        
                    }else{
                        connection.commit((err)=>{
                            if(err){

                            }else{

                            }
                        });
                    }
                });
            }
        });
    }
});
*/




function getos(user_agent){
    let os="";
    if(user_agent.indexOf("Android")!=-1){
        os="Android"
    }else if(user_agent.indexOf("iPhone")!=-1){
        os="iPhone"
    }else if(user_agent.indexOf("iPad")!=-1){
        os="iPad"
    }else if(user_agent.indexOf("Windows")!=-1){
        os="Windows"
    }else if(user_agent.indexOf("Macintosh")!=-1){
        os="Macintosh"
    }else if(user_agent.indexOf("Linux")!=-1){
        os="Linux"
    }else{
        os="Unknown"
    }
    return os;
}