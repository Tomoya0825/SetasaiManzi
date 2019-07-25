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
        sqlhistory:{type:'file', filename:'./log/sqlHistory.log'},
        serverLog:{type:'file', filename: './log/serverLog.log'},
        fatalLog:{type:'fileSync', filename: './log/serverLog.log'},
        historyLog:{type:'file', filename:'./log/historyLog.log'},
        clientErrorLog:{type:'file', filename:'./log/clientErrorLog.log'},
        consoleout:{type:'console'}
    },
    categories:{
        default:{appenders:['sqlhistory', 'historyLog', 'consoleout'], level:'ALL'},
        serverLog:{appenders:['serverLog', 'historyLog', 'consoleout'], level:'ALL'},
        clientErrorLog:{appenders:['clientErrorLog', 'consoleout'], level:'ALL'},
        fatalLog:{appenders:['fatalLog', 'consoleout'], level:'ALL'}
    }
});
const sqlhistory = log4js.getLogger('sqlhistory');
const serverLog = log4js.getLogger('serverLog');
const fatalLog = log4js.getLogger('fatalLog');
const clientErrorLog = log4js.getLogger('clientErrorLog')

//Expressでの最初の部分での処理のエラーしょり(app.useの最後じゃないとダメ)
app.use(function(err,req,res,next){
    let sfunc = req['originalUrl'].slice(req['originalUrl'].lastIndexOf('/')+1);
    try{
        if(err){
            if(err['type']=='entity.parse.failed'){
                //JSONじゃないのなげきたやばいばあい(こうげきされてる)
                serverLog.warn(`(${sfunc}) Bad Request`);
                res.json({"result":"Bad Request"});
            }else{
                //なぞすぎる
                serverLog.warn("Unknown Error");
                res.json({"result":"Unknown Error"});
            }
        }
    }catch(ex){
        //もっとなぞすぎる
        serverLog.error("(ExHandle) Unknown Error");
    }
});

process.on("exit", (code)=>{
    fatalLog.fatal("Fatal Error");
});

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

// tcu_Ichgokan, tcu_Syokudou, …
var qrlist = [];
var st_qrlist="";
//実行したSQL文確認用
var sql_obj;
//auth_code生成用 I i l 1 O o 0 J j は見ずらいかもしんないので使わない
const S1 = "abcdefghkmnpqrstuvwxyz23456789";
const S2 = "123456789"

serverLog.info("Server Start");

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'setasai',
    password: 'tcu',
    port: 3306,
    database: 'setasai'
});

//ufwで 443ポート開放済み (実行にroot権限必須)
https.createServer({
    key: fs.readFileSync('./cert/privkey.pem'),
    cert: fs.readFileSync('./cert/cert.pem'),
    ca: fs.readFileSync('./cert/chain.pem')
},app).listen(443);

connection.beginTransaction((err)=>{
    if(err){
        serverLog.error("(QR) TRANSACTION Error");
        throw new Error("TRANSACTION Error");
    }else{
        sql_obj=connection.query("DESCRIBE setasai 'tcu_%';", (err, results)=>{
            sqlhistory.trace(`${sql_obj['sql']}`);
            if(err){
                serverLog.error("(QR) DESCRIBE Error");
                connection.rollback();
                throw new Error("DESCRIBE Error");
            }else{
                connection.commit((err)=>{
                    if(err){
                        connection.rollback();
                        throw new Error("COMMIT Error");
                    }else{
                        for(let index in results){
                            qrlist.push(results[index]['Field']);
                        }
                        st_qrlist = qrlist.join(', ');
                        serverLog.info(`(QR) ${st_qrlist}`);
                    }
                });      
            }
        });
    }
});


//################################################################################################################

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
            serverLog.error("(Entry) Transaction Error");
            res.json({ 'result': 'Server Error 00' });
        }else{
            //トランザクション開始成功
            sql_obj=connection.query("INSERT INTO setasai(auth_code, user_agent, os, year, date, time) VALUES (?, ?, ?, ?, ?, ?);",
            [`${auth_code1}-${auth_code2}`, `${user_agent}`, `${getos(user_agent)}`, datetime.getFullYear(), datetime.getDate(), 
            `${datetime.getHours()}:${datetime.getMinutes()}:${datetime.getSeconds()}`],(err) => {
                sqlhistory.trace(`${sql_obj['sql']}`);
                if(err){
                    //INSERT失敗
                    connection.rollback();
                    serverLog.error("(Entry) INSERT Error");
                    res.json({ 'result': 'Server Error 01' });
                }else{
                    //INSERT成功
                    sql_obj=connection.query("SELECT id, auth_code FROM setasai WHERE id=LAST_INSERT_ID();", (err, results) => {
                        sqlhistory.trace(`${sql_obj['sql']}`);
                        if(err){
                            //SELECT失敗
                            connection.rollback();
                            serverLog.error("(Entry) SELECT Error");
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
                                    serverLog.error("(Entry) COMMIT Error");
                                    rjson = { 'result': 'Server Error 03' };
                                }else{
                                    //COMMIT成功
                                    res.json(rjson);
                                    serverLog.info(`(Entry) {"id":"${results[0]['id']}", "auth_code":"${results[0]['auth_code']}"}`);
                                }
                                //最終処理
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
        //パラメータ不足
        serverLog.warn(`(RecordQR) Lack Of Parameter ${JSON.stringify(req.body)}`);
        res.json({ 'result': 'Lack Of Parameter' });
    }else{
        connection.beginTransaction((err) => {
            if(err){
                //トランザクション開始失敗
                serverLog.error("(RecordQR) Transaction Error");
                res.json({ 'result': 'Server Error 10' });
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
                            serverLog.warn(`(RecordQR) Unknown QR ${JSON.stringify(req.body)}`);
                            res.json({ 'result': 'Unknown QR' });
                        }else{
                            //その他エラー
                            serverLog.error("(RecordQR) Update Error");
                            res.json({ 'result': 'Server Error 11' });
                        }              
                    }else{
                        //UPDATE成功
                        if(results['message'].indexOf('Rows matched: 0')!=-1){ //WHERE該当なし
                            serverLog.warn(`(RecordQR) Auth Faild ${JSON.stringify(req.body)}`);
                            res.json({ 'result': 'Auth Faild' });
                        }else if(results['message'].indexOf('Changed: 0')!=-1){ //変更なし
                            serverLog.info(`(RecordQR) ${JSON.stringify(req.body)} (Alrady Recorded)`)
                            res.json({ 'result': 'Alrady Recorded' });
                        }else{ //変更OK
                            connection.commit((err)=>{
                                if(err){
                                    //COMMIT失敗
                                    connection.rollback();
                                    serverLog.error("(RecordQR) COMMIT Error");
                                    res.json({ 'result': 'Server Error 12' });
                                }else{
                                    //COMMIT成功
                                    res.json({ 'result': 'OK' });
                                    serverLog.info(`(RecordQR) ${JSON.stringify(req.body)}`);
                                }
                            });//COMMIT
                        }
                    }
                });//クエリ UPDATE
            }
        });//TRANSACTION
    }
});//POST


//QR確認
app.post('/API/GetQR', (req, res) => {
    let id = req.body['id'];
    let auth_code = req.body['auth_code'];
    let reqtype="GetQR";
    if(req.body['verification']=='true'){
        reqtype="Verification";
    }
    if(!id || !auth_code){
        //パラメータ不足
        serverLog.warn(`(${reqtype}) Lack Of Parameter ${JSON.stringify(req.body)}`);
        res.json({ 'result': 'Lack Of Parameter' });
    }else{
        //パラメータOK
        connection.beginTransaction((err)=>{
            if(err){
                //トランザクション開始失敗
                serverLog.error(`(${reqtype}) Transaction Error`);
                res.json({ 'result': 'Server Error 20' });
            }else{
                //トランザクション開始成功
                sql_obj=connection.query(`SELECT ?? FROM setasai WHERE id=? AND auth_code=?;`, 
                [qrlist, parseFloat(id), `${auth_code}`],(err, results)=>{
                    sqlhistory.trace(`${sql_obj['sql']}`);
                    if(err){
                        //SELECT失敗
                        connection.rollback();
                        serverLog.error(`(${reqtype}) SELECT Error`);
                        res.json({ 'result': 'Server Error 21' });
                    }else{
                        //SELECT成功
                        if(results.length==0){
                            //WHERE該当なし
                            connection.rollback();
                            serverLog.warn(`(${reqtype}) Auth Faild ${JSON.stringify(req.body)}`);
                            res.json({ 'result': 'Auth Faild' });
                        }else{
                            //WHERE該当あり
                            connection.commit((err)=>{
                                if(err){
                                    //COMMIT失敗
                                    connection.rollback();
                                    serverLog.error(`(${reqtype}) COMMIT Error`);
                                    res.json({ 'result': 'Server Error 22' });
                                }else{
                                    //COMMIT成功
                                    let rsjson={"result": "OK"};
                                    for(index in qrlist){
                                        rsjson[`${qrlist[index]}`] = results[0][`${qrlist[index]}`];
                                    }
                                    serverLog.info(`(${reqtype}) ${JSON.stringify(req.body)}`);                   
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

//クライアント側でしか察知できないエラー起きたとき。(おそらく全部は拾いきれないが一応のモノ)
app.post('/API/RecordClientError',(req, res)=>{
    //パラメータ不足とか気にしない。とりあえず記録。
    if(req.body['level']=='info'){
        clientErrorLog.info(JSON.stringify(req.body));
    }else{
        clientErrorLog.error(JSON.stringify(req.body));
    }
});

//#################################################################
//#################################################################
const adOperateID="OperationUser";
const adOperateAuthCode="Setasai2019";
//#################################################################
//#################################################################

app.post('/Operate/ListQR', (req, res)=>{
    let OperateID = req.body['OperateID'];
    let OperateAuthCode = req.body['OperateAuthCode'];
    if(!OperateID || !OperateAuthCode){
        //パラメータ不足
        serverLog.warn(`(Operate ListQR) Lack Of Parameter ${JSON.stringify(req.body)}`);
        res.json({ 'result': 'Lack Of Parameter' });
    }else{
        //パラメータOK
        if(OperateID!=adOperateID || OperateAuthCode!=adOperateAuthCode){
            //認証失敗
            serverLog.warn(`(Operate ListQR) Auth Faild ${JSON.stringify(req.body)}`);
            res.json({ 'result': 'Auth Faild' });
        }else{
            connection.beginTransaction((err)=>{
                if(err){
                    //トランザクション開始失敗
                    serverLog.error("(Operate RemoveQR) Transaction Error");
                    res.json({ 'result': 'Server Error 30' });
                }else{
                    sql_obj=connection.query("SELECT ?? FROM setasai;",[qrlist],(err, results)=>{
                        sqlhistory.trace(`${sql_obj['sql']}`);
                        if(err){
                            connection.rollback();
                            serverLog.error("(Operate ListQR) SELECT EROOR");
                            res.json({ 'result': 'Server Error 31' });
                            console.log(err);
                        }else{
                            let sumlist={};
                            for(let i in qrlist){
                                let tmp_sum=0;
                                for(let j in results){
                                    tmp_sum+=results[j][qrlist[i]];
                                }
                                sumlist[`${qrlist[i]}-sum`] = tmp_sum;
                            }
                            connection.commit((err)=>{
                                if(err){
                                    //COMMIT失敗
                                    connection.rollback();
                                    serverLog.error("(Operate ListQR) COMMIT Error");
                                    res.json({ 'result': 'Server Error 32' });
                                }else{
                                    //COMMIT成功
                                    res.json(sumlist);
                                    serverLog.info(`(Operate ListQR) Success.`);
                                }
                            });
                        }
                    });
                }
            });
        }
    }
});

app.post('/Operate/ShowLog', (req, res)=>{
    let OperateID = req.body['OperateID'];
    let OperateAuthCode = req.body['OperateAuthCode'];
    let LogType = req.body['LogType'];
    if(!OperateID || !OperateAuthCode || !LogType){
        //パラメータ不足
        serverLog.warn(`(Operate ShowLog) Lack Of Parameter ${JSON.stringify(req.body)}`);
        res.json({ 'result': 'Lack Of Parameter' });
    }else{
        //パラメータOK
        if(OperateID!=adOperateID || OperateAuthCode!=adOperateAuthCode){
            //認証失敗
            serverLog.warn(`(Operate ShowLog) Auth Faild ${JSON.stringify(req.body)}`);
            res.json({ 'result': 'Auth Faild' });
        }else{
            res.send(fs.readFileSync(`./log/${LogType}.log`));
        }
    }
});


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