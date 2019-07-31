const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const crypto = require('crypto');
const log4js = require('log4js');
const https = require('https');
const helmet = require('helmet');
const fs = require('fs');
const line = require('@line/bot-sdk');

const config = JSON.parse(fs.readFileSync("config.json"));

const app = express();
const client = new line.Client({channelAccessToken: `${config['LineAccessToken']}`});

app.use(bodyParser.urlencoded({ extended: true })); //url-encoded
app.use(bodyParser.json()); //json
app.use(express.static('./webpage'));
app.use(helmet());

//#### ログ用 ####
log4js.configure({
    appenders:{
        Server:{type:'file', filename: './log/server.log'},
        Fatal:{type:'fileSync', filename: './log/server.log'},
        ClientError:{type:'file', filename:'./log/clientError.log'},
        consoleout:{type:'console'}
    },
    categories:{
        default:{appenders:['Server', 'consoleout'], level:'ALL'},
        ClientError:{appenders:['ClientError', 'consoleout'], level:'ALL'},
        Fatal:{appenders:['Fatal', 'consoleout'], level:'ALL'}
    }
});
const sqlhistory = log4js.getLogger('Server');
const serverLog = log4js.getLogger('Server');
const fatalLog = log4js.getLogger('Fatal');
const clientErrorLog = log4js.getLogger('ClientError');

//Expressでの最初の部分での処理のエラーしょり(app.useの最後じゃないとダメ)
app.use(function(err,req,res,next){
    let sfunc = req['originalUrl'].slice(req['originalUrl'].lastIndexOf('/')+1);
    try{
        if(err){
            if(err['type']=='entity.parse.failed'){
                //JSONじゃないのなげきたやばいばあい(こうげきされてる)
                serverLog.warn(`(${sfunc}) Bad Request`);
                res.status(400).json({"result":"Bad Request"});
            }else{
                //なぞすぎる
                serverLog.warn("Unknown Error");
                res.status(500).json({"result":"Unknown Error"});
            }
        }
    }catch(ex){
        //もっとなぞすぎる
        res.status(500);
        serverLog.error("(ExHandle) Unknown Error");
    }
});

/*
=========DB構成重要事項==========
ER_NOT_SUPPORTED_AUTH_MODE ではまった
caching_sha2_password っていう新しい認証方式にライブラリが非対応なため。
プログラムからアクセスする用のユーザつくってそいつだけ認証方式変えた。
https://qiita.com/ucan-lab/items/3ae911b7e13287a5b917
*/

// tcu_Ichgokan, tcu_Syokudou, …
var qrlist = {};
//auth_code生成用 I i l 1 O o 0 J j は見ずらいかもしんないので使わない
const S1 = "abcdefghkmnpqrstuvwxyz23456789";
const S2 = "123456789"

fatalLog.fatal("Server Restart");
client.broadcast({type: 'text', text: 'サーバが再起動しました。'});
//起動時にLINEに起動したよとPOST

const connection = mysql.createConnection({
    host: config['MySQL']['Host'],
    user: config['MySQL']['User'],
    password: config['MySQL']['Password'],
    port: config['MySQL']['Port'],
    database: config['MySQL']['Database'],
});
const table = config['MySQL']['UserTable'];

//ufwで 443ポート開放済み (実行にroot権限必須)
https.createServer({
    key: fs.readFileSync(config['CertificateFile']['Key']),
    cert: fs.readFileSync(config['CertificateFile']['Cert']),
    ca: fs.readFileSync(config['CertificateFile']['Ca'])
},app).listen(443);

new Promise((resolve, reject)=>{
    connection.beginTransaction((err)=>{
        if(err){
            serverLog.error("(QR) TRANSACTION Error");
            reject(new Error("TRANSACTION Error"));
        }else{
            sqlhistory.trace(connection.query("SHOW FULL columns from ?? LIKE 'tcu_%';", [table], (err, results)=>{
                if(err){
                    connection.rollback();
                    serverLog.error("(QR) DESCRIBE Error");
                    reject(new Error("DESCRIBE Error"));
                }else{
                    connection.commit((err)=>{
                        if(err){
                            connection.rollback();
                            reject(new Error("COMMIT Error"));
                        }else{
                            let tmp_qr={};
                            for(let index in results){
                                if(!results[index]['Comment']){
                                    reject("Location Error")
                                }else{
                                    tmp_qr[results[index]['Field']] = results[index]['Comment'];
                                }
                            }
                            resolve(tmp_qr);
                        }
                    });      
                }
            })['sql']);
        }
    });
}).then((result)=>{
    qrlist = result;
    let str_qr="";
    for(key in qrlist){
        str_qr += `${key}(${qrlist[key]}), `;
    }
    serverLog.info(`(QR) ${str_qr.slice(0,-2)}`);
}).catch((ex)=>{
    if(ex['message']){
        client.broadcast({type: 'text', text: '[警告]\nDBの状態を確認してください。状態を確認し再起動してください。'});
        serverLog.fatal("Start Error");
    }else{
        client.broadcast({type: 'text', text: '[警告]\nQRに場所が登録されていないものがあります。状態を確認し再起動してください。'});
        serverLog.fatal("Start Error [QR Location]");
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
    if(user_agent.length>200){
        user_agent = 'Unknown(Too Long)';
    }
    let auth_code1 = Array.from(crypto.randomFillSync(new Uint8Array(6))).map((n) => S1[n % S1.length]).join('');
    let auth_code2 = Array.from(crypto.randomFillSync(new Uint8Array(6))).map((n) => S2[n % S2.length]).join('');
    connection.beginTransaction((err) => {
        if(err){
            //トランザクション開始失敗
            serverLog.error("(Entry) Transaction Error");
            res.status(500).json({ 'error': 'Server Error' });
        }else{
            //トランザクション開始成功
            sqlhistory.trace(connection.query("INSERT INTO ??(auth_code, user_agent, os, year, date, time) VALUES (?, ?, ?, ?, ?, ?);",
            [table, `${auth_code1}-${auth_code2}`, `${user_agent}`, `${getos(user_agent)}`, datetime.getFullYear(), datetime.getDate(), 
            `${datetime.getHours()}:${datetime.getMinutes()}:${datetime.getSeconds()}`],(err) => {
                if(err){
                    //INSERT失敗
                    connection.rollback();
                    serverLog.error("(Entry) INSERT Error");
                    res.status(500).json({ 'error': 'Server Error' });
                }else{
                    //INSERT成功
                    sqlhistory.trace(connection.query("SELECT id, auth_code FROM ?? WHERE id=LAST_INSERT_ID();", [table], (err, results) => {
                        if(err){
                            //SELECT失敗
                            connection.rollback();
                            serverLog.error("(Entry) SELECT Error");
                            res.status(500).json({ 'error': 'Server Error' });
                        }else{
                            //SELECT成功
                            connection.commit((err) => {
                                if(err){
                                    //COMMIT失敗
                                    connection.rollback();
                                    serverLog.error("(Entry) COMMIT Error");
                                    res.status(500).json({ 'error': 'Server Error' });
                                }else{
                                    //COMMIT成功
                                    res.status(200).json({
                                        'id': `${results[0]['id']}`,
                                        'auth_code': `${results[0]['auth_code']}`
                                    });
                                    serverLog.info(`(Entry) {"id":"${results[0]['id']}", "auth_code":"${results[0]['auth_code']}"}`);
                                }
                                //最終処理
                            });//COMMIT
                        }
                    })['sql']);//クエリ SELECT
                }
            })['sql']);//クエリ INSERT
        }
    });//TRANSACTION
});//POST


//QR記録
app.post('/API/RecordQR', (req, res)=>{
    let id = req.body['id'];
    let auth_code = req.body['auth_code'];
    let qr = req.body['qr'];
    auth_id(id, auth_code).then(()=>{
        if(!qr){
            serverLog.warn("(RecordQR) Lack Of Parameter");
            res.status(400).json({ 'error': 'Lack Of Parameter' });
        }else{
            connection.beginTransaction((err)=>{
                if(err){
                    res.status(500).json({'error': 'Server Error'});
                    serverLog.error("(RecordQR) Transaction Error");
                }else{
                    sqlhistory.trace(connection.query("UPDATE ?? SET ??=1 WHERE id=? AND auth_code=?;",
                    [table, qr, id, auth_code], (err, results)=>{
                        if(err){
                            connection.rollback();
                            if(err['message'].indexOf('Unknown column')!=-1){
                                //存在しないQR名
                                serverLog.warn(`(RecordQR) Unknown QR ${JSON.stringify(req.body)}`);
                                res.status(400).json({ 'error': 'Unknown QR' });
                            }else{
                                serverLog.error("(RecordQR) Query Error");
                                res.status(500).json({'error': 'Server Error'});
                            }
                        }else{
                            if(results['message'].indexOf('Changed: 0')!=-1){ //変更なし
                                serverLog.info(`(RecordQR) ${JSON.stringify(req.body)} (Alrady Recorded)`);
                                res.status(400).json({ 'error': 'Alrady Recorded' });
                            }else{
                                connection.commit((err)=>{
                                    if(err){
                                        //COMMIT失敗
                                        connection.rollback();
                                        serverLog.error("(RecordQR) COMMIT Error");
                                        res.status(500).json({ 'error': 'Server Error' });
                                    }else{
                                        //COMMIT成功
                                        res.status(200).json({ 'result': 'OK' });
                                        serverLog.info(`(RecordQR) ${JSON.stringify(req.body)}`);
                                    }
                                });//COMMIT
                            }
                        }
                    })['sql']);
                }
            });
        }
    }).catch((ex)=>{
        if(ex['message']){
            res.status(500).json({'error': 'Server Error'});
            serverLog.error(ex['message']);
        }else{
            //クライアント側エラーのとき LackOfParameterとかAuthFaildとか
            res.status(400).json({'error': `${ex}`});
            serverLog.warn(ex);
        }
    });
});


//QR確認
app.post('/API/GetQR', (req, res) => {
    let id = req.body['id'];
    let auth_code = req.body['auth_code'];
    getqr_id(id, auth_code).then((result)=>{
        res.status(200).json(result);
    }).catch((ex)=>{
        if(ex['message']){
            res.status(500).json({'error': 'Server Error'});
            serverLog.error(ex['message']);
        }else{
            //クライアント側エラーのとき LackOfParameterとかAuthFaildとか
            res.status(400).json({'error': `${ex}`});
            serverLog.warn(ex);
        }
    });
});//POST

//ゴール
app.post('/API/Goal', (req, res)=>{
    let id = req.body['id'];
    let auth_code = req.body['auth_code'];
    getqr_id(id, auth_code).then((result)=>{
        let is_achieved = true;
        for(let i in result){
            if(result[i] != 1){
                is_achieved = false;
                break;
            }
        }
        if(is_achieved == false){
            res.status(400).json({'error': 'Unachieved'});
        }else{
            connection.beginTransaction((err)=>{
                if(err){
                    res.status(500).json({'error': 'Server Error'});
                    serverLog.error("(Goal) Transaction Error");
                }else{
                    sqlhistory.trace(connection.query("UPDATE ?? SET goal=1 WHERE id=? AND auth_code=?;",
                    [table, id, auth_code], (err, results)=>{
                        if(err){
                            connection.rollback();
                            res.status(500).json({'error': 'Server Error'});
                            serverLog.error("(Goal) Query Error");
                        }else{
                            connection.commit((err)=>{
                                if(err){
                                    connection.rollback();
                                    res.status(500).json({'error': 'Server Error'});
                                    serverLog.error("(Goal) Commit Error");
                                }else{
                                    if(results['message'].indexOf('Changed: 0')!=-1){ //変更なし つまりはゴール済み
                                        res.status(400).json({'error': 'Already Goaled'});
                                    }else{
                                        res.status(200).json({'secret': config['Secret']});
                                    }
                                }
                            });
                        }
                    })['sql']);
                }
            });
        }
    }).catch((ex)=>{
        if(ex['message']){
            res.status(500).json({'error': 'Server Error'});
            serverLog.error(ex['message']);
        }else{
            //クライアント側エラーのとき LackOfParameterとかAuthFaildとか
            res.status(400).json({'error': `${ex}`});
            serverLog.warn(ex);
        }
    });
});

//QR一覧
app.post('/API/ListQR', (req, res)=>{
    res.json(Object.values(qrlist));
});


//認証してからQRをとってくる。QRの連想配列返す。ログはSQL以外とらない。エラーはauthの引継ぎ
function getqr_id(id, auth_code){
    return new Promise((resolve, reject)=>{
        auth_id(id, auth_code).then(()=>{
            //認証できた。
            connection.beginTransaction((err)=>{
                if(err){
                    reject(new Error("(GetQR) Transaction Error"));
                }else{
                    sqlhistory.trace(connection.query("SELECT ?? FROM ?? WHERE id=? AND auth_code=?;",
                    [Object.keys(qrlist), table, id, auth_code], (err, results)=>{
                        if(err){
                            reject(new Error("(GetQR) Query Error"));
                        }else{
                            connection.commit((err)=>{
                                if(err){
                                    reject(new Error("(GetQR) Commit Error"));
                                }else{
                                    let list={}
                                    for(let key in qrlist){
                                        list[qrlist[key]] = results[0][key]
                                    }
                                    resolve(list);
                                }
                            });
                        }
                    })['sql']);
                }
            });
        }).catch((ex)=>{
            reject(ex);
        });
    });
}
//認証成功したらresolveして、パラメータ不足ならreject("Lack Of Parameter")失敗ならreject("Auth Faild")
//エラッタらrejectでエラーをスロー。ログはSQL以外とってない。
function auth_id(id, auth_code){
    return new Promise((resolve, reject)=>{
        if(!id || !auth_code){
            reject("Lack Of Parameter");
        }else{
            connection.beginTransaction((err)=>{
                if(err){
                    reject(new Error("(Auth) Transaction Error"));
                }else{
                    sqlhistory.trace(connection.query("SELECT * FROM ?? WHERE id=? AND auth_code=?;", [table, id, auth_code], (err, results)=>{
                        if(err){
                            connection.rollback();
                            reject(new Error("(Auth) Query Error"));
                        }else{
                            connection.commit((err)=>{
                                if(err){
                                    connection.rollback();
                                    reject(new Error("(Auth) Commit Error"));
                                }else{
                                    if(!results[0]){
                                        reject("Auth Faild");
                                    }else{
                                        resolve();
                                    }
                                }
                            })
                        }
                    })['sql']);
                }
            });
        }
    });
}


//クライアント側でしか察知できないエラー起きたとき。(おそらく全部は拾いきれないが一応のモノ)
app.post('/API/RecordClientError',(req, res)=>{
    //パラメータ不足とか気にしない。とりあえず記録。
    if(req.body['level']=='info'){
        clientErrorLog.info(JSON.stringify(req.body));
    }else{
        clientErrorLog.error(JSON.stringify(req.body));
    }
});

app.post('/Operate/ListQR', (req, res)=>{
    let OperateID = req.body['OperateID'];
    let OperateAuthCode = req.body['OperateAuthCode'];
    if(!OperateID || !OperateAuthCode){
        //パラメータ不足
        serverLog.warn(`(Operate ListQR) Lack Of Parameter ${JSON.stringify(req.body)}`);
        res.status(400).json({ 'error': 'Lack Of Parameter' });
    }else{
        //パラメータOK
        if(OperateID!=config['OperateUser']['ID'] || OperateAuthCode!=config['OperateUser']['AuthCode']){
            //認証失敗
            serverLog.warn(`(Operate ListQR) Auth Faild ${JSON.stringify(req.body)}`);
            res.status(400).json({ 'error': 'Auth Faild' });
        }else{
            connection.beginTransaction((err)=>{
                if(err){
                    //トランザクション開始失敗
                    serverLog.error("(Operate RemoveQR) Transaction Error");
                    res.status(500).json({ 'error': 'Server Error' });
                }else{
                    sqlhistory.trace(connection.query("SELECT ?? FROM ??;",[Object.keys(qrlist), table],(err, results)=>{
                        if(err){
                            connection.rollback();
                            serverLog.error("(Operate ListQR) SELECT EROOR");
                            res.status(500).json({ 'error': 'Server Error' });
                            console.log(err);
                        }else{
                            let sumlist={};
                            for(let key in qrlist){
                                let tmp_sum=0;
                                for(let j in results){
                                    tmp_sum+=results[j][key];
                                }
                                sumlist[`${qrlist[key]}`] = tmp_sum;
                            }
                            connection.commit((err)=>{
                                if(err){
                                    //COMMIT失敗
                                    connection.rollback();
                                    serverLog.error("(Operate ListQR) COMMIT Error");
                                    res.status(500).json({ 'error': 'Server Error' });
                                }else{
                                    //COMMIT成功
                                    res.status(200).json(sumlist);
                                    serverLog.info(`(Operate ListQR) Success.`);
                                }
                            });
                        }
                    })['sql']);
                }
            });
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