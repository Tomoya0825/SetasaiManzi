const video = document.createElement("video");
const canvasElement = document.getElementById("videocanvas");
const canvas = canvasElement.getContext("2d");

/*##########################################
  getUserMedia は Safari, Edgeとかに非対応? (バージョンによる?)(要検証)
  IEはもちろん動かない。

  LocalStrageまわり注意(プライベートブラウジングとかだとアウト)
##########################################*/

var id = ""
var auth_code = ""

//まずGetQRしてアカウントが使えるかどうか…

//Lack Of Parameterはプライベートブラウジングな可能性あり。

if (!window.localStorage) {
    //localStrage使えない(よほど古い)
    alert("ご利用のブラウザはlocalstorageに非対応のため利用できません。");
    show_popup3();
} else if (!navigator.mediaDevices) {
    //mediaDevices使えない(ちょっと古いかSafari)
    alert("ご利用のブラウザはカメラ機能に非対応のため利用できません。");
    show_popup3();
} else {
    //APIはだいじょうぶそう(プライぺートブラウジングである場合を除く…)
    if (!localStorage.getItem("id") || !localStorage.getItem("auth_code")) {
        alert("QRコードの読み取りのためにカメラの使用許可をお願いします。");
        post("https://v133-130-100-78.a029.g.tyo1.static.cnode.io/API/Entry", { "user_agent": "TestUserManzi" }).then(data => {
            if (data) {
                if (data['result'] == "OK") {
                    localStorage.setItem("id", data['id']);
                    localStorage.setItem("auth_code", data['auth_code']);
                    id = data['id'];
                    auth_code = data['auth_code'];
                } else {
                    //サーバ側処理失敗
                }
            } else {
                //通信失敗 or 応答なし
            }
        });
    } else {
        id = localStorage.getItem("id");
        auth_code = localStorage.getItem("auth_code");
    }

    


    // 縦横比1に  aspectRatio: 1
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment", aspectRatio: 1 } }).then((stream) => {
        video.srcObject = stream;
        video.play()

        let time = new Date()
        var wait = setInterval(() => {
            if ((video.readyState === video.HAVE_ENOUGH_DATA)) {
                clearInterval(wait);
                canvasElement.width = video.videoWidth;
                canvasElement.height = video.videoHeight;
            }else{
                //1.5秒以上カメラが起動できないとき
                if((new Date())-time>=1500){
                    alert("ほかのタブで開いてるQRカメラを閉じてOKを押してください。");
                    clearInterval(wait);
                    location.reload();
                }
            }
        }, 100);

        var scanqr = setInterval(() => {
            canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
            var imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
            var qr_object = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
            if (qr_object && (qr_object.data.indexOf("tcu_") != -1)) {
                clearInterval(scanqr);

                post('https://v133-130-100-78.a029.g.tyo1.static.cnode.io/API/RecordQR', {
                    "id": `${id}`,
                    "auth_code": `${auth_code}`,
                    "qr": `${qr_object.data}`
                }).then(data => {
                    if (data) {
                        if (data.result == "OK") {
                            alert("しゅうりょ");
                            //飛ばしたりする
                        } else {
                            //サーバ側処理失敗
                        }
                    } else {
                        //通信失敗 or 応答なし
                    }
                });

            }
        }, 100);
    }).catch((err)=>{
        //エラー
    });
}


//手動入力時
function submit() {
    alert(document.getElementById("textbox").value);
}


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
    }).then(response => response.json());
}


//以下表示用関数
function show_popup1() {
    clearInterval(tickfunc);
    document.getElementById("popup1").style.display = "inline";
}
function close_popup1() {
    tickfunc = setInterval(tick, 100);
    document.getElementById("popup1").style.display = "none";
}

function show_popup2() {
    clearInterval(tickfunc);
    document.getElementById("popup2").style.display = "inline";
}
function close_popup2() {
    tickfunc = setInterval(tick, 100);
    document.getElementById("popup2").style.display = "none";
}

function show_popup3() {
    document.getElementById("popup3").style.display = "inline";
}
function close_popup3() {
    //popup3閉じてpopup1開く(ダメな時手動入力させる)
    document.getElementById("popup3").style.display = "none";
    document.getElementById("popup1").style.display = "inline";
}