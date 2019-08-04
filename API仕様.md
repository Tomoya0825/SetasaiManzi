## 新規登録
### URL
/API/Entry
### パラメータ 例
* なし
### レスポンス 例
```json
{
	"id": "10",
	"auth_code": "38afv8-555215"
}
```
### 固有エラー 例
* なし

<br>
---
<br>

## QR記録
### URL
/API/RecordQR
### パラメータ 例
```json
{
	"id": "10",
	"auth_code": "38afv8-555215",
	"qr": "tcu_Ichigokan"
}
```
### レスポンス 例
```json
{
	"result": "OK"
}
```
### 固有エラー 例
```json
{"error": "Alrady Recorded"}	//すでに記録済み
{"error": "Unknown QR"}			//パラメータのQRがサーバ側で定義されていない
```

<br>
---
<br>

## QR取得
### URL
/API/GetQR
### パラメータ 例
```json
{
	"id": "10",
	"auth_code": "38afv8-555215"
}
```
### レスポンス 例
```json
{
	"一号館": 1,
	"食堂": 0
}
```
### 固有エラー 例
* なし

<br>
---
<br>

## ゴール記録
### URL
/API/Goal
### パラメータ 例
```json
{
	"id": "10",
	"auth_code": "38afv8-555215"
}
```
### レスポンス 例
```json
{
	"secret": "世田谷祭2019"
}
```
### 固有エラー 例
```json
{"error": "Unachieved"}			//すべてのQRを読み取っていない(未達成)
{"error": "Already Goaled"}		//すでにゴール済み
```

<br>
---
<br>

## QR設置箇所取得
### URL
/API/GetLocation
### パラメータ 例
* なし
### レスポンス 例
```json
[
	"一号館",
	"食堂"
]
```
### 固有エラー 例
* なし

<br>
---
<br>

## (共通のエラー)
```json
{"error": "Server Error"}		//サーバ側のエラー
{"error": "Unknown Error"}		//不明なエラー

//以下二3つは認証したりパラメータが必要なものでおこりゆるエラー
{"error": "Bad Request"}		//主にパラメータの構文や形式に誤りがある
{"error": "Auth Faild"}			//パラメータのidとauth_codeで認証できない
{"error": "Lack Of Parameter"}	//パラメータが足りない
```