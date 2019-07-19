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
const logger = log4js.getLogger();
logger.level = 'trace';

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

https.createServer({
    key: fs.readFileSync('./cert/privkey.pem'),
    cert: fs.readFileSync('./cert/cert.pem'),
    ca: fs.readFileSync('./cert/chain.pem')
},app).listen(port);

/*=======================
  ##TaskList##
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
  @@@@@@@@@@@@@@@@@@@@@@!!!!!!!! SQLインジェクション脆弱性検証 !!!!!!!@@@@@@@@@@@@@@@@@@@@@@@@@@@@
  @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
  -型わかるように
  -ログ対応
  -各所修正しやすいように
  -ムダなトランザクション消す
  -高速化
=======================*/

/*
=========DB構成重要事項==========
ER_NOT_SUPPORTED_AUTH_MODE ではまった
caching_sha2_password っていう新しい認証方式にライブラリが非対応なため。
プログラムからアクセスする用のユーザつくってそいつだけ認証方式変えた。
https://qiita.com/ucan-lab/items/3ae911b7e13287a5b917
*/

//================================================================
//QRの名前や数に応じてDBとともに変更。
///API/GetQR も修正。 コード内での変数 = QRのテキスト, DBでのカラム名
//================================================================

//===============================返すJSON入れ子にすればQRもDBにできるのでは????========================================

var qrlist = [];
var st_qrlist="";   // tcu_Ichgokan, tcu_Syokudou, …

connection.query("SELECT * FROM qrtable ORDER BY sortid;", (err, results)=>{
    if(err){
        //エラッたとしても何度かリトライするようにする
    }else{
        for(let index in results){
            qrlist.push(results[index]['qr']);
        }
        st_qrlist = qrlist.join(', ');
        console.log(st_qrlist);
        //ここに処理かくか非同期のやつなんやかんや。
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
    //console.log(req.body['user_agent']);
    let auth_code1 = Array.from(crypto.randomFillSync(new Uint8Array(6))).map((n) => S1[n % S1.length]).join('');
    let auth_code2 = Array.from(crypto.randomFillSync(new Uint8Array(6))).map((n) => S2[n % S2.length]).join('');
    connection.beginTransaction((err) => {
        if(err){
            //トランザクション開始失敗
            res.json({ 'result': 'Server Error 00' });
        }else{
            //トランザクション開始成功
            connection.query("INSERT INTO setasai(auth_code, user_agent, year, date, time) VALUES (?, ?, ?, ?, ?);",
            [`${auth_code1}-${auth_code2}`, `${user_agent}`, datetime.getFullYear(), datetime.getDate(), 
            `${datetime.getHours()}:${datetime.getMinutes()}:${datetime.getSeconds()}`],(err) => {
                if(err){
                    //INSERT失敗
                    connection.rollback();
                    res.json({ 'result': 'Server Error 01' });
                }else{
                    //INSERT成功
                    connection.query("SELECT id, auth_code FROM setasai WHERE id=LAST_INSERT_ID();", (err, results) => {
                        if(err){
                            //SELECT失敗
                            connection.rollback();
                            res.json({ 'result': 'Server Error 02' });
                        }else{
                            //SELECT成功
                            //これがいまついかしたID = とうろくID と認証コード
                            let rjson = {
                                'result': 'OK',
                                'id': `${results[0]['id']}`,
                                'auth_code': `${results[0]['auth_code']}`
                            };
                            connection.commit((err) => {
                                if(err){
                                    //COMMIT失敗
                                    rjson = { 'result': 'Server Error 03' };
                                }else{
                                    //COMMIT成功
                                }
                                //最終処理
                                res.json(rjson);
                                console.log(`新規登録しました。  ${results[0]['id']}  ${results[0]['auth_code']}`);
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
    connection.beginTransaction((err) => {
        if(err){
            //トランザクション開始失敗
            res.json({ 'result': 'Server Error 10' });
        }else{
            //トランザクション開始成功
            connection.query(`UPDATE setasai SET ??=1 WHERE id=? AND auth_code=?;`,
            [`${qr}`, `${id}`, `${auth_code}`],(err, results)=>{
                console.log(err);
                if(err){
                    //UPDATE失敗
                    connection.rollback();
                    if(err['message'].indexOf('Unknown column')!=-1){
                        //存在しないQR名
                        res.json({ 'result': 'Unknown QR' });
                    }else{
                        //その他エラー
                        res.json({ 'result': 'Server Error 11' });
                        console.log(`UpdateQR:\n${err}`);
                    }              
                }else{
                    //UPDATE成功
                    if(results['message'].indexOf('Rows matched: 0')!=-1){ //WHERE該当なし
                        res.json({ 'result': 'Auth Faild' });
                    }else if(results['message'].indexOf('Changed: 0')!=-1){ //変更なし
                        res.json({ 'result': 'Alrady Recorded' });
                    }else{ //変更OK
                        connection.commit((err)=>{
                            if(err){
                                //COMMIT失敗
                                connection.rollback();
                                res.json({ 'result': 'Server Error 12' });
                            }else{
                                //COMMIT成功
                                res.json({ 'result': 'OK' });
                                console.log(`QRを記録しました。  ${id}  ${auth_code}  ${qr}`);
                            }
                        });//COMMIT
                    }
                }
            });//クエリ UPDATE
        }
    });//TRANSACTION
});//POST


//QR確認  (トランザクションいらなそう)
app.post('/API/GetQR', (req, res) => {
    let id = req.body['id'];
    let auth_code = req.body['auth_code'];

    //console.log(typeof(id));
    //console.log(typeof(auth_code));

    connection.beginTransaction((err)=>{
        if(err){
            //トランザクション開始失敗
            res.json({ 'result': 'Server Error 20' });
        }else{
            //トランザクション開始成功
            connection.query(`SELECT ?? FROM setasai WHERE id=? AND auth_code=?;`, 
            [qrlist, `${id}`, `${auth_code}`],(err, results)=>{
                if(err){
                    //SELECT失敗
                    connection.rollback();
                    res.json({ 'result': 'Server Error 21' });
                }else{
                    //SELECT成功
                    if(results.length==0){
                        //WHERE該当なし
                        connection.rollback();
                        res.json({ 'result': 'Auth Faild' });
                    }else{
                        //WHERE該当あり
                        connection.commit((err)=>{
                            if(err){
                                //COMMIT失敗
                                connection.rollback();
                                res.json({ 'result': 'Server Error 22' });
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
});//POST





function getos(user_agent){
    let os="";
    if(user_agent.indexOf("Android")){
        od="Android"
    }else if(user_agent.indexOf("iPhone")){
        os="iPhone"
    }else if(user_agent.indexOf("iPad")){
        os="iPad"
    }else if(user_agent.indexOf("Windows")){
        os="Windows"
    }else if(user_agent.indexOf("Macintosh")){
        os="Macintosh"
    }else if(user_agent.indexOf("Linux")){
        os="Linux"
    }else{
        os="不明"
    }
    return os;
}