
import os
import json
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import Flask, send_from_directory, request, jsonify
from datetime import datetime

app = Flask(__name__)

# ====================================================
# [ 雲端備份 Email 設定區 ]
# ====================================================
# 請在此處填入您的資訊：

# 1. 您的 Gmail 帳號
SMTP_USER = 'benjamin.tcore@gmail.com' 

# 2. 您的 16 位「應用程式密碼」
# (修正：已自動加上引號，並會在發送時自動移除空格)
SMTP_PASS = 'aodr jzcy btop wtkh'

# 3. 備份收件人 (預設發送給自己，也可以改成別人的 Email)
# 注意：多個收件人請用逗號隔開，並且"整個字串"要包在引號內
BACKUP_RECIPIENT = 'benjaminchu0508@gmail.com, mimi.chou@tfg.com.tw, uin.hsu@tfg.com.tw'

# --- 以下設定通常不需要更動 ---
SMTP_SERVER = 'smtp.gmail.com'
SMTP_PORT = 587
# ====================================================

def send_backup_email(data, operator):
    # 檢查是否已設定帳密
    if '請填入' in SMTP_USER or '請填入' in SMTP_PASS or not SMTP_USER:
        print("\n[備份失敗] 偵測到尚未設定 Gmail 帳號或密碼！")
        print("請開啟 inventory_app.py 並在第 15-18 行填入您的資訊。")
        
        # 即使 Email 沒設，也先存一個本地 JSON 檔案當備份，確保資料不遺失
        filename = f"local_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return False

    try:
        msg = MIMEMultipart()
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        msg['Subject'] = f"【大豐盤點雲端備份】作業員：{operator or '未記錄'} - {timestamp}"
        msg['From'] = SMTP_USER
        msg['To'] = BACKUP_RECIPIENT

        # 整理盤點清單成表格
        rows = ""
        count = 0
        for item in data:
            if item.get('actualQty', 0) > 0:
                count += 1
                rows += f"""
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;">{item.get('productCode', '無代號')}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">{item.get('name', '無品名')}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: center; font-weight: bold; color: #2563eb;">{item.get('actualQty')}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">{item.get('location', '-')}</td>
                </tr>
                """
        
        html = f"""
        <html>
          <body style="font-family: 'Microsoft JhengHei', sans-serif; color: #334155;">
            <div style="max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #2563eb; color: white; padding: 20px; text-align: center;">
                    <h2 style="margin: 0;">大豐資訊 - 盤點進度同步</h2>
                </div>
                <div style="padding: 20px;">
                    <p><b>作業人員：</b> {operator or '未登錄'}</p>
                    <p><b>同步時間：</b> {timestamp}</p>
                    <p><b>本次備份項目：</b> {count} 項</p>
                    
                    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                      <thead>
                        <tr style="background-color: #f8fafc;">
                          <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">產品代號</th>
                          <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">品名</th>
                          <th style="padding: 10px; border: 1px solid #ddd;">數量</th>
                          <th style="padding: 10px; border: 1px solid #ddd;">儲位</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows if rows else '<tr><td colspan="4" style="padding: 20px; text-align: center;">尚無已盤點項目</td></tr>'}
                      </tbody>
                    </table>
                </div>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
                    此郵件由大豐盤點系統自動發送，請勿直接回覆。
                </div>
            </div>
          </body>
        </html>
        """
        msg.attach(MIMEText(html, 'html'))

        # 執行發送
        # Google 應用程式密碼驗證時通常不包含空格，這裡自動移除空格以防萬一
        safe_password = SMTP_PASS.replace(" ", "")

        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls() # 安全加密連線
            server.login(SMTP_USER, safe_password)
            server.send_message(msg)
        
        print(f"[備份成功] 已發送至 {BACKUP_RECIPIENT}")
        return True
    except Exception as e:
        print(f"[備份失敗] 錯誤原因: {str(e)}")
        # 發生錯誤時，印出更多提示
        if "Username and Password not accepted" in str(e):
             print(">>> 提示：請檢查 Email 是否正確，或是應用程式密碼是否已過期/錯誤。")
        return False

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/backup', methods=['POST'])
def backup_data():
    content = request.json
    items = content.get('items', [])
    operator = content.get('operator', '未知')
    
    # 呼叫發送 Email 函數
    success = send_backup_email(items, operator)
    
    return jsonify({
        "status": "success" if success else "error",
        "message": "備份成功" if success else "Email 發送失敗，請檢查伺服器端設定"
    })

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    print("\n" + "="*50)
    print("   大豐資訊盤點系統 - 雲端備份模式已就緒")
    print("="*50)
    print(f" * SMTP 帳號: {SMTP_USER if '請填入' not in SMTP_USER else '尚未設定'}")
    print(f" * 網址: http://localhost:5000")
    print("="*50 + "\n")
    app.run(host='0.0.0.0', port=5000)
