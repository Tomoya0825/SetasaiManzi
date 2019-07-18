const mysql = require('mysql');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'setasai',
    password: 'tcu',
    port: 3306,
    database: 'setasai'
});

var qrlist={};

//gittestsuyami3

connection.query('SELECT * FROM qrtable;', (err, results)=>{
    if(err){
        //エラッたとしても何度かリトライするようにする
    }else{
        for(let index in results){
            qrlist[results[index]['qrid']] = results[index]['qr_text'];
        }
        console.log(qrlist);

        //ここに処理かくか非同期のやつなんやかんや。

    }
});

//.onはイベント的な扱いらしい。(なのでそれよりしたは即時実行
