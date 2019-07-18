# Setasai-QR-DB API 仕様



## 利用方法

それぞれのエンドポイントにPOST。

パラメータのエンコード形式は  x-www-form-urlencoded でリクエストボディ内に入れて送信。

レスポンスの形式はJSON。



### ユーザ登録

エンドポイント	/API/Entry

##### パラメータ
* ua: ユーザーエージェントの文字列。

##### レスポンス
* id: ユーザID
* auth_code: 認証コード



### QR記録

エンドポイント	/API/RecordQR

##### パラメータ

* id: ユーザID
* auth_code: 認証コード
* qr: 読み取ったQRコードの文字列

##### レスポンス

* result: 記録時は "OK" を返す。記録済みの時は "Alrady Recorded" を返す。その他エラーの場合もあり。



### 記録済みQRの取得

エンドポイント	/API/GetQR

##### パラメータ

* id: ユーザID

* auth_code: 認証コード

##### レスポンス

* result: 正常時は "OK" を返す。

* qr: JSON形式でのリスト。	key: QRコード文字列,	value: ０か1

例

```json
{
    "tcu_Ichigokan": 1, 
    "tcu_Syokudou": 0,
    "tcu_Goal": 0
}
```
