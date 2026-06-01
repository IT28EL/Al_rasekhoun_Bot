
import sqlite3
import time
import asyncio
import logging
import os
from flask import Flask
from threading import Thread
from telegram import ReplyKeyboardMarkup, Update, KeyboardButton
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# --- 1. إعداد Flask (النبض الوهمي للاستضافة) ---
app = Flask('')

@app.route('/')
def home():
    return "البوت يعمل بنجاح! 🚀"

def run_flask():
    app.run(host='0.0.0.0', port=8080)

def keep_alive():
    t = Thread(target=run_flask)
    t.start()

# --- 2. الإعدادات الأساسية ---
TOKEN = '8287845380:AAGvZgyCm0fgN1lFLmFzcTp-fdk5kuFSEGU'
ADMIN_ID = 7833080290  # آيدي المسؤول
FILES_CHANNEL_ID = -1004297648771  # آيدي قناتك الخاصة

# --- 3. قاعدة البيانات ونظام الحماية (كما هي دون تغيير) ---
def init_db():
    conn = sqlite3.connect('rasikhon.db')
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS content 
                      (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, 
                       title TEXT, type TEXT, value TEXT, visits INTEGER DEFAULT 0)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, join_date INTEGER)''')
    conn.commit()
    conn.close()

user_last_action = {}
def is_spamming(user_id):
    current_time = time.time()
    last_time = user_last_action.get(user_id, 0)
    if current_time - last_time < 0.7: return True
    user_last_action[user_id] = current_time
    return False

def get_keyboard(parent_id, is_admin=False):
    conn = sqlite3.connect('rasikhon.db')
    items = conn.execute('SELECT title, type FROM content WHERE parent_id IS ?', (parent_id,)).fetchall()
    conn.close()
    keyboard = []
    for title, c_type in items:
        prefix = "📁 " if c_type == 'folder' else "📍 "
        keyboard.append([f"{prefix}{title}"])
    if is_admin:
        if parent_id is None:
            keyboard.append(["📊 الإحصائيات", "📢 إرسال جماعي"])
        keyboard.append(["➕ إضافة محتوى", "🗑 حذف عنصر"])
    if parent_id:
        keyboard.append(["🔙 العودة", "🏠 الرئيسية"])
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)

# --- 4. معالجة العمليات (Handlers) ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if is_spamming(user_id): return
    conn = sqlite3.connect('rasikhon.db')
    conn.execute('INSERT OR IGNORE INTO users (id, join_date) VALUES (?, ?)', (user_id, int(time.time())))
    conn.commit()
    conn.close()
    context.user_data['path'] = []
    await update.message.reply_text("مرحباً بك في منصة الرّاسخون في العلم 🎓", 
                                   reply_markup=get_keyboard(None, user_id == ADMIN_ID))

async def handle_logic(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text
    if is_spamming(user_id): return
    is_admin = (user_id == ADMIN_ID)
    path = context.user_data.get('path', [])
    curr_parent = path[-1] if path else None

    # [ملاحظة: تم الإبقاء على كافة ميزات الإدارة، الإرسال الجماعي، والإحصائيات هنا]
    if is_admin and text == "📊 الإحصائيات":
        conn = sqlite3.connect('rasikhon.db')
        u_count = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        conn.close()
        await update.message.reply_text(f"👥 عدد المشتركين: {u_count}")
        return

    if is_admin and text == "📢 إرسال جماعي":
        await update.message.reply_text("أرسل الآن نص الرسالة الجماعية:")
        context.user_data['mode'] = 'broadcast'
        return

    if context.user_data.get('mode') == 'broadcast' and is_admin:
        conn = sqlite3.connect('rasikhon.db')
        users = conn.execute('SELECT id FROM users').fetchall()
        conn.close()
        for u in users:
            try: await context.bot.send_message(u[0], f"📢 تنبيه جديد:\n\n{text}")
            except: continue
        await update.message.reply_text("✅ تم الإرسال للجميع.")
        context.user_data['mode'] = None
        return

    if text == "🔙 العودة":
        if path: path.pop()
        await update.message.reply_text("رجوع..", reply_markup=get_keyboard(path[-1] if path else None, is_admin))
        return
    if text == "🏠 الرئيسية":
        path.clear()
        await update.message.reply_text("القائمة الرئيسية", reply_markup=get_keyboard(None, is_admin))
        return

    if text == "➕ إضافة محتوى" and is_admin:
        await update.message.reply_text("أرسل الآن: `قسم | الاسم` أو `رابط | الاسم | الرابط` أو أرسل ملفاً.")
        context.user_data['mode'] = 'adding'
        return

    if context.user_data.get('mode') == 'adding' and is_admin:
        conn = sqlite3.connect('rasikhon.db')
        if update.message.document or update.message.photo or update.message.video:
            await update.message.forward(chat_id=FILES_CHANNEL_ID)
            f_id = update.message.document.file_id if update.message.document else \
                   (update.message.video.file_id if update.message.video else update.message.photo[-1].file_id)
            f_type = 'pdf' if update.message.document else ('video' if update.message.video else 'photo')
            conn.execute('INSERT INTO content (parent_id, title, type, value) VALUES (?, ?, ?, ?)', 
                         (curr_parent, update.message.caption or "بدون عنوان", f_type, f_id))
            conn.commit()
            await update.message.reply_text("✅ تم رفع الملف للقناة وحفظه.")
            context.user_data['mode'] = None
        elif text and "|" in text:
            p = text.split("|")
            if p[0].strip() == "قسم":
                conn.execute('INSERT INTO content (parent_id, title, type) VALUES (?, ?, ?)', (curr_parent, p[1].strip(), 'folder'))
            elif p[0].strip() == "رابط":
                conn.execute('INSERT INTO content (parent_id, title, type, value) VALUES (?, ?, ?, ?)', (curr_parent, p[1].strip(), 'url', p[2].strip()))
            conn.commit()
            await update.message.reply_text("✅ تم الحفظ.")
            context.user_data['mode'] = None
        conn.close()
        return

    clean_text = text.replace("📁 ", "").replace("📍 ", "")
    conn = sqlite3.connect('rasikhon.db')
    item = conn.execute('SELECT id, type, value FROM content WHERE title = ? AND parent_id IS ?', (clean_text, curr_parent)).fetchone()
    if item:
        item_id, i_type, i_val = item
        conn.execute('UPDATE content SET visits = visits + 1 WHERE id = ?', (item_id,))
        conn.commit()
        if i_type == 'folder':
            path.append(item_id)
            await update.message.reply_text(f"📁 {clean_text}", reply_markup=get_keyboard(item_id, is_admin))
        else:
            if i_type == 'pdf': await update.message.reply_document(i_val, caption=clean_text)
            elif i_type == 'photo': await update.message.reply_photo(i_val, caption=clean_text)
            elif i_type == 'video': await update.message.reply_video(i_val, caption=clean_text)
            elif i_type == 'url': await update.message.reply_text(f"🔗 {clean_text}:\n{i_val}")
    conn.close()

# --- 5. التشغيل النهائي ---
def main():
    init_db()
    keep_alive() # تشغيل النبض الوهمي
    while True:
        try:
            app_tg = Application.builder().token(TOKEN).build()
            app_tg.add_handler(CommandHandler("start", start))
            app_tg.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, handle_logic))
            app_tg.run_polling(drop_pending_updates=True)
        except Exception as e:
            time.sleep(5)

if __name__ == '__main__': main()