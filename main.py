
import time
import asyncio
import os
from flask import Flask
from threading import Thread
from telegram import ReplyKeyboardMarkup, Update, KeyboardButton
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from supabase import create_client, Client

# --- 1. إعدادات Flask للنبض (Heartbeat) ---
app = Flask('')

@app.route('/')
def home():
    return "بوت الرّاسخون في العلم: الحالة (سحابي مستقر) ✅"

def run_flask():
    app.run(host='0.0.0.0', port=8080)

def keep_alive():
    t = Thread(target=run_flask)
    t.start()

# --- 2. الإعدادات والربط (بياناتك الخاصة) ---
SUPABASE_URL = "https://dnjwfulyobufwdqezktd.supabase.co"
SUPABASE_KEY = "sb_publishable_As6dVjy3l11aIB3zvMJbbQ_R4gqRmfr" # ملاحظة هامة بالأسفل
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TOKEN = '8287845380:AAEALQaBW_wdQ72MSdtbbukwvP3YsXTbSkc'
ADMIN_ID = 7833080290  # آيدي المسؤول
FILES_CHANNEL_ID = -1004297648771  # آيدي قناتك الخاصة

# --- 3. وظائف جلب البيانات من السحاب ---

def get_keyboard(parent_id, is_admin=False):
    # جلب الأقسام من Supabase
    # نستخدم 0 كرمز للقسم الرئيسي (None)
    p_id = parent_id if parent_id else 0
    query = supabase.table("content").select("title, type").eq("parent_id", p_id).execute()
    items = query.data
    
    keyboard = []
    temp_row = []
    for item in items:
        prefix = "📁 " if item['type'] == 'folder' else "📍 "
        temp_row.append(f"{prefix}{item['title']}")
        if len(temp_row) == 2: # تنظيم الأزرار (2 في كل صف)
            keyboard.append(temp_row)
            temp_row = []
    if temp_row: keyboard.append(temp_row)
    
    # أزرار التحكم
    control_buttons = []
    if is_admin:
        if p_id == 0:
            control_buttons.extend(["📊 الإحصائيات", "📢 إرسال جماعي"])
        control_buttons.append("➕ إضافة محتوى")
        keyboard.append(control_buttons)
        keyboard.append(["🗑 حذف عنصر"])
    
    navigation = []
    if p_id != 0:
        navigation.append("🔙 العودة")
        navigation.append("🏠 الرئيسية")
        keyboard.append(navigation)
        
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)

# --- 4. منطق عمل البوت ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    # تسجيل المستخدم في السحاب
    supabase.table("users").upsert({"id": user_id}).execute()
    context.user_data['path'] = []
    await update.message.reply_text(
        "مرحباً بك في منصة الرّاسخون في العلم 🎓\nتم تفعيل الحماية السحابية لبياناتك.",
        reply_markup=get_keyboard(None, user_id == ADMIN_ID)
    )

async def handle_logic(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text
    is_admin = (user_id == ADMIN_ID)
    path = context.user_data.get('path', [])
    curr_parent = path[-1] if path else 0

    # إحصائيات
    if is_admin and text == "📊 الإحصائيات":
        res = supabase.table("users").select("id", count="exact").execute()
        await update.message.reply_text(f"👥 عدد المشتركين في القاعدة السحابية: {res.count}")
        return

    # العودة والرسيسية
    if text == "🔙 العودة":
        if path: path.pop()
        await update.message.reply_text("رجوع..", reply_markup=get_keyboard(path[-1] if path else None, is_admin))
        return
    if text == "🏠 الرئيسية":
        path.clear()
        await update.message.reply_text("القائمة الرئيسية", reply_markup=get_keyboard(None, is_admin))
        return

    # إضافة محتوى
    if is_admin and text == "➕ إضافة محتوى":
        await update.message.reply_text("أرسل الاسم بالشكل التالي:\n`قسم | اسم القسم` لإنشاء مجلد\nأو أرسل ملفاً (PDF/فيديو) مع كتابة عنوانه في الوصف.")
        context.user_data['mode'] = 'adding'
        return

    if context.user_data.get('mode') == 'adding' and is_admin:
        if update.message.document or update.message.video or update.message.photo:
            # رفع للمخزن وجلب ID
            f_msg = await update.message.forward(chat_id=FILES_CHANNEL_ID)
            f_id = f_msg.document.file_id if f_msg.document else (f_msg.video.file_id if f_msg.video else f_msg.photo[-1].file_id)
            f_type = 'file'
            title = update.message.caption or "ملف بدون عنوان"
            supabase.table("content").insert({"parent_id": curr_parent, "title": title, "type": f_type, "file_id": f_id}).execute()
            await update.message.reply_text("✅ تم حفظ الملف سحابياً.")
        elif "|" in text:
            parts = text.split("|")
            if parts[0].strip() == "قسم":
                supabase.table("content").insert({"parent_id": curr_parent, "title": parts[1].strip(), "type": "folder"}).execute()
                await update.message.reply_text("✅ تم إنشاء القسم سحابياً.")
        context.user_data['mode'] = None
        return

    # التنقل والفتح
    clean_text = text.replace("📁 ", "").replace("📍 ", "")
    query = supabase.table("content").select("*").eq("title", clean_text).eq("parent_id", curr_parent).execute()
    
    if query.data:
        item = query.data[0]
        if item['type'] == 'folder':
            path.append(item['id'])
            await update.message.reply_text(f"فتح {clean_text}..", reply_markup=get_keyboard(item['id'], is_admin))
        else:
            await context.bot.send_document(chat_id=update.effective_chat.id, document=item['file_id'], caption=item['title'])

# --- 5. التشغيل ---
def main():
    keep_alive()
    application = Application.builder().token(TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, handle_logic))
    application.run_polling(drop_pending_updates=True)

if __name__ == '__main__':
    main()
