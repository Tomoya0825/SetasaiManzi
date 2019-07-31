

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