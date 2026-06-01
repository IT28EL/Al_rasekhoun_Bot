
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
    return "بوت الرّاسخون في العلم: الحالة (سحابي متطور) ✅"

def run_flask():
    app.run(host='0.0.0.0', port=8080)

def keep_alive():
    t = Thread(target=run_flask)
    t.start()

# --- 2. الإعدادات والربط ---
SUPABASE_URL = "https://dnjwfulyobufwdqezktd.supabase.co"
SUPABASE_KEY = "sb_publishable_As6dVjy3l11aIB3zvMJbbQ_R4gqRmfr"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TOKEN = '8287845380:AAEALQaBW_wdQ72MSdtbbukwvP3YsXTbSkc'
ADMIN_ID = 7833080290 
FILES_CHANNEL_ID = -1004297648771  # آيدي قناتك الخاصة

# --- 3. الحماية من السبام ---
user_last_action = {}
def is_spamming(user_id):
    current_time = time.time()
    last_time = user_last_action.get(user_id, 0)
    if current_time - last_time < 0.8:
        return True
    user_last_action[user_id] = current_time
    return False

# --- 4. بناء القوائم السحابية ---
def get_main_keyboard(parent_id, is_admin=False):
    p_id = parent_id if parent_id else 0
    query = supabase.table("content").select("title, type").eq("parent_id", p_id).execute()
    items = query.data
    
    keyboard = []
    temp_row = []
    for item in items:
        prefix = "📁 " if item['type'] == 'folder' else "📍 "
        temp_row.append(f"{prefix}{item['title']}")
        if len(temp_row) == 2:
            keyboard.append(temp_row)
            temp_row = []
    if temp_row: keyboard.append(temp_row)
    
    if is_admin:
        if p_id == 0:
            keyboard.append(["📊 الإحصائيات", "📢 إرسال جماعي"])
        keyboard.append(["➕ إضافة محتوى", "🗑 حذف عنصر"])
    
    if p_id != 0:
        keyboard.append(["🔙 العودة", "🏠 الرئيسية"])
        
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)

# --- 5. منطق عمل البوت المطور ---
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if is_spamming(user_id): return
    
    # تسجيل المستخدم سحابياً
    supabase.table("users").upsert({"id": user_id}).execute()
    
    context.user_data['path'] = []
    await update.message.reply_text(
        "مرحباً بك في منصة الرّاسخون في العلم 🎓\n(النظام السحابي المطور)",
        reply_markup=get_main_keyboard(None, user_id == ADMIN_ID)
    )

async def handle_logic(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    text = update.message.text
    if is_spamming(user_id): return
    
    is_admin = (user_id == ADMIN_ID)
    path = context.user_data.get('path', [])
    curr_parent = path[-1] if path else 0

    # --- ميزة الإحصائيات ---
    if is_admin and text == "📊 الإحصائيات":
        u_count = supabase.table("users").select("id", count="exact").execute().count
        top_content = supabase.table("content").select("title, visits").neq("type", "folder").order("visits", desc=True).limit(5).execute().data
        res = f"👥 المشتركين: {u_count}\n\n🔝 الأكثر زيارة:\n"
        for item in top_content:
            res += f"- {item['title']}: ({item.get('visits', 0)} زيارة)\n"
        await update.message.reply_text(res)
        return

    # --- ميزة الإرسال الجماعي ---
    if is_admin and text == "📢 إرسال جماعي":
        await update.message.reply_text("أرسل رسالة التعميم الآن:")
        context.user_data['mode'] = 'broadcast'
        return

    if is_admin and context.user_data.get('mode') == 'broadcast':
        users = supabase.table("users").select("id").execute().data
        count = 0
        for u in users:
            try:
                await context.bot.send_message(chat_id=u['id'], text=f"📢 تنبيه من الرّاسخون في العلم:\n\n{text}")
                count += 1
            except: continue
        await update.message.reply_text(f"✅ تم الإرسال لـ {count} مشترك.")
        context.user_data['mode'] = None
        return

    # --- التنقل ---
    if text == "🔙 العودة":
        if path: path.pop()
        await update.message.reply_text("رجوع..", reply_markup=get_main_keyboard(path[-1] if path else None, is_admin))
        return
    if text == "🏠 الرئيسية":
        path.clear()
        await update.message.reply_text("القائمة الرئيسية", reply_markup=get_main_keyboard(None, is_admin))
        return

    # --- إضافة المحتوى (سحابي + توجيه للقناة) ---
    if is_admin and text == "➕ إضافة محتوى":
        await update.message.reply_text("أرسل: `قسم | الاسم` أو `رابط | الاسم | الرابط` أو أرسل ملفاً.")
        context.user_data['mode'] = 'adding'
        return

    if is_admin and context.user_data.get('mode') == 'adding':
        if text and "|" in text:
            p = text.split("|")
            m_type = p[0].strip()
            if m_type == "قسم":
                supabase.table("content").insert({"parent_id": curr_parent, "title": p[1].strip(), "type": "folder"}).execute()
            elif m_type == "رابط":
                supabase.table("content").insert({"parent_id": curr_parent, "title": p[1].strip(), "type": "url", "file_id": p[2].strip()}).execute()
            await update.message.reply_text("✅ تم الحفظ سحابياً.")
            context.user_data['mode'] = None
        elif update.message.document or update.message.photo or update.message.video:
            # توجيه للقناة الخاصة
            await update.message.forward(chat_id=FILES_CHANNEL_ID)
            
            f_id = update.message.document.file_id if update.message.document else (update.message.video.file_id if update.message.video else update.message.photo[-1].file_id)
            title = update.message.caption or "ملف بدون عنوان"
            supabase.table("content").insert({"parent_id": curr_parent, "title": title, "type": "file", "file_id": f_id}).execute()
            await update.message.reply_text("✅ تم حفظ الملف سحابياً وتوجيهه للقناة.")
            context.user_data['mode'] = None
        return

    # --- التصفح والزيارات ---
    if text:
        clean_text = text.replace("📁 ", "").replace("📍 ", "")
        query = supabase.table("content").select("*").eq("title", clean_text).eq("parent_id", curr_parent).execute()
        
        if query.data:
            item = query.data[0]
            new_visits = (item.get('visits', 0) or 0) + 1
            supabase.table("content").update({"visits": new_visits}).eq("id", item['id']).execute()
            
            if item['type'] == 'folder':
                path.append(item['id'])
                await update.message.reply_text(f"📁 {clean_text}", reply_markup=get_main_keyboard(item['id'], is_admin))
            else:
                if item['type'] == 'url':
                    await update.message.reply_text(f"🔗 {item['title']}:\n{item['file_id']}")
                else:
                    await context.bot.send_document(chat_id=user_id, document=item['file_id'], caption=item['title'])

# --- 6. التشغيل ---
def main():
    keep_alive()
    application = Application.builder().token(TOKEN).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(MessageHandler(filters.ALL & ~filters.COMMAND, handle_logic))
    application.run_polling(drop_pending_updates=True)

if __name__ == '__main__':
    main()
