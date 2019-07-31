const video = document.createElement("video");
const canvasElement = document.getElementById("videocanvas");
const canvas = canvasElement.getContext("2d");

const baseUrl="https://v133-130-100-78.a029.g.tyo1.static.cnode.io";
var id="";
var auth_code="";


if(!window.localStorage){
    //localStrage使えない(なぞブラウザ)
    alert("ご利用のブラウザはlocalStrageに非対応のため利用できません。");
    show_popup3();
    recordClientError("Not Support (localStrage)", 'info');
    location.href = "../index.html";
}else if(!navigator.mediaDevices){
    //mediaDevices使えない(ちょっと古いかSafari)
    alert("ご利用のブラウザはカメラ機能に非対応のため利用できません。");
    show_popup3();
    recordClientError("Not Support (mediaDevices)", 'info');
    location.href = "../index.html";
}


if(!localStorage.getItem("id") || !localStorage.getItem("auth_code")){
    //ブラウザにユーザ情報なし
    alert("QRコードの読み取りのためにカメラの使用許可をお願いします。");
    post(`${baseUrl}/API/Entry`).then((res)=>{
        if(!res['error']){
            //OK
            localStorage.setItem('id', res['id']);
            localStorage.setItem('auth_code', res['auth_code']);
            id = res['id'];
            auth_code = res['auth_code'];
        }else{
            //エラー(通信?やサーバ側)
            alert("エラーが発生しました。");
            recordClientError('Entry Error');
            location.href = "../index.html";//まあ一応(できないかもだけど)
        }
    }).catch((err)=>{
        alert("エラーが発生しました。");
        recordClientError('Entry Post Error');
        location.reload();
    });
}else{
    //情報アリ
    id = localStorage.getItem("id");
    auth_code = localStorage.getItem("auth_code");
    //GetQRつかって認証してみてユーザ情報ちゃんと使えるか確認
    post(`${baseUrl}/API/GetQR`,{
        "id": id,
        "auth_code": auth_code,
        "verification": 'true'
    }).then((res)=>{
        if(!res['error']){
            //OK

        }else if(res['error']=='Auth Faild' || res['error']=='Lack Of Parameter'){
            //アカウント情報新しく作る必要アリ @@@@@@@@ 対応どうする @@@@@@@@
            alert("IDを新規発行します。");
            recordClientError('Re-Entry');
            localStorage.removeItem("id");
            localStorage.removeItem("auth_code");
            location.reload();
        }else{
            //その他エラー
            alert("エラーが発生しました。");
            recordClientError('(Verification) GetQR Error');
            location.href = "../index.html" ;
        }
    });
}

var scan;
navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:"environment",aspectRatio:1}}).then((stream)=>{
    video.srcObject = stream;
    video.play();

    let time = new Date();
    let wait = setInterval(()=>{
        if(video.readyState === video.HAVE_ENOUGH_DATA){
            clearInterval(wait);
            canvasElement.width = video.videoWidth;
            canvasElement.height = video.videoHeight;
        }else{
            //1.5秒以上カメラが起動できないとき
            if((new Date())-time>=1500){
                clearInterval(wait);
                alert("ほかのタブで開いてるQRカメラを閉じてOKを押してください。");
                recordClientError('Camera Startup Error (Tab)', 'info');
                location.reload();     
            }
        }
    },100);
    scan = setInterval(()=>{
        canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
        let image = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
        let qrobj = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if(qrobj && (qrobj['data'].indexOf('tcu_')!=-1)){
            clearInterval(scan);
            post(`${baseUrl}/API/RecordQR`,{
                "id": id,
                "auth_code": auth_code,
                "qr": qrobj['data']
            }).then((res)=>{
                if(!res['error']){
                    //登録した場合
                    location.href = "../Uniquepage/index.html?result=ok";//ok
                }else if(res['error']=='Alrady Recorded'){
                    //登録済みの場合
                    location.href = "../Uniquepage/index.html?result=recoded";//recoded
                }else{
                    //その他エラー
                    alert("エラーが発生しました。");
                    recordClientError('RecordQR Error');
                    location.reload();
                }
            }).catch((err)=>{
                alert("エラーが発生しました。");
                recordClientError('RecordQR Post Error');
                location.reload();
            });
        }else{
            //なんもしない(まつ)
        }
    },100);
}).catch((err)=>{
    alert("エラーが発生しました。\nカメラをブロックしてしまった場合、ブラウザの設定よりカメラの使用許可をお願いします。");
    recordClientError('getUserMedia Error');
    location.href = "../index.html";
});


//手動入力時
function submit() {
    alert(document.getElementById("textbox").value);
}

//fetch API使う用
function post(url = '', data = {}) {
    return fetch(url, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        redirect: "follow",
        referrer: "no-referrer",
        body: JSON.stringify(data)
    }).then(response => response.json()).catch((err)=>{
        //ここのエラーなぞに影響ないのにいろいろ発生するのであえて処理しない。
    });
}

//いちおう
function recordClientError(errmsg='', level='error'){
    return post(`${baseUrl}/API/RecordClientError`,{
            "id": id,
            "auth_code": auth_code,
            "error": errmsg,
            "level": level
    });
}


//以下表示用関数
function show_popup1() {
    clearInterval(scan);
    document.getElementById("popup1").style.display = "inline";
}
function close_popup1() {
    document.getElementById("popup1").style.display = "none";
    location.reload();
}

function show_popup2() {
    clearInterval(scan);
    recordClientError('Camera Not Working Button Pushed', 'info');
    document.getElementById("popup2").style.display = "inline";
}
function close_popup2() {
    document.getElementById("popup2").style.display = "none";
    location.reload();
}

function show_popup3() {
    document.getElementById("popup3").style.display = "inline";
}
function close_popup3() {
    //popup3閉じてpopup1開く(ダメな時手動入力させる)
    document.getElementById("popup3").style.display = "none";
    document.getElementById("popup1").style.display = "inline";
}