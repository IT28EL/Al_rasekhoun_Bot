# bot.py
import os
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ConversationHandler,
    ContextTypes,
    filters
)
from telegram.constants import ParseMode

# Configure logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Configuration
TELEGRAM_TOKEN = os.getenv('8287845380:AAEALQaBW_wdQ72MSdtbbukwvP3YsXTbSkc', '7833080290')  # Replace with your bot token
RESOURCE_GROUP_LINK = "https://t.me/Al_rasekhoun"

SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'English', 'History']
GRADES = ['9', '10', '11', '12']
RESOURCE_TYPES = ['Textbook', 'Link', 'Cheatsheet', 'Video']
ADMIN_ID = 7669890509

# Conversation states
(CHOOSE_SUBJECT, CHOOSE_GRADE, CHOOSE_TYPE, 
 INPUT_TITLE, INPUT_CONTENT) = range(5)

# Database class
class Database:
    def __init__(self, filename: str = 'resources.json'):
        self.filename = filename
        self.data = self._load_data()

    def _load_data(self) -> Dict:
        try:
            with open(self.filename, 'r') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {'resources': [], 'stats': {'accesses': 0}}

    def _save_data(self):
        with open(self.filename, 'w') as f:
            json.dump(self.data, f, indent=4)

    def add_resource(self, resource: Dict) -> bool:
        try:
            resource['added_at'] = datetime.utcnow().isoformat()
            self.data['resources'].append(resource)
            self._save_data()
            return True
        except Exception as e:
            logger.error(f"Failed to add resource: {e}")
            return False

    def get_resources(self, subject: str, grade: str, type: str) -> List[Dict]:
        self.data['stats']['accesses'] += 1
        self._save_data()
        return [r for r in self.data['resources'] 
                if r['subject'] == subject and 
                r['grade'] == grade and 
                r['type'] == type]

    def get_stats(self) -> Dict:
        return self.data['stats']

# Utility functions
def create_keyboard(items: List[str], prefix: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton(item, callback_data=f"{prefix}_{item}")] 
        for item in items
    ])

def format_resource(resource: Dict) -> str:
    type_emojis = {'Textbook': '📚', 'Cheatsheet': '📝', 'Video': '🎥', 'Link': '🔗'}
    emoji = type_emojis.get(resource['type'], '📎')
    
    return (
        f"{emoji} <b>{resource['title']}</b> {emoji}\n"
        f"📘 Subject: {resource['subject']}\n"
        f"📋 Grade: {resource['grade']}\n"
        f"📎 Type: {resource['type']}\n"
        f"🔗 <a href='{resource['content']}'>Access Resource</a>"
    )

def is_valid_link(content: str) -> bool:
    return any(fmt in content for fmt in ['https://t.me/', 't.me/'])

def is_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID

# Command handlers
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "🎓 Welcome to Educational Resources Bot!\n"
        "Use /browse to find resources\n"
        "Use /add to share resources (admin only)\n"
        "Use /stats to see usage stats",
        parse_mode=ParseMode.HTML
    )

async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    stats = db.get_stats()
    await update.message.reply_text(
        f"📊 Stats\nTotal accesses: {stats['accesses']}",
        parse_mode=ParseMode.HTML
    )

# Browse conversation handlers
async def browse_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.message.reply_text(
        "Select a subject:",
        reply_markup=create_keyboard(SUBJECTS, "subject"),
        parse_mode=ParseMode.HTML
    )
    return CHOOSE_SUBJECT

async def browse_subject(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data['subject'] = query.data.split('_')[1]
    await query.edit_message_text(
        "Select a grade:",
        reply_markup=create_keyboard(GRADES, "grade")
    )
    return CHOOSE_GRADE

async def browse_grade(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data['grade'] = query.data.split('_')[1]
    await query.edit_message_text(
        "Select resource type:",
        reply_markup=create_keyboard(RESOURCE_TYPES, "type")
    )
    return CHOOSE_TYPE

async def browse_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    type_ = query.data.split('_')[1]
    
    resources = db.get_resources(
        context.user_data['subject'],
        context.user_data['grade'],
        type_
    )
    
    if not resources:
        await query.edit_message_text("No resources found!")
        return ConversationHandler.END
        
    await query.edit_message_text("Found resources:")
    for resource in resources:
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=format_resource(resource),
            parse_mode=ParseMode.HTML,
            disable_web_page_preview=False
        )
    return ConversationHandler.END

# Add conversation handlers
async def add_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("❌ Admin access required!")
        return ConversationHandler.END
        
    await update.message.reply_text(
        "Select subject for new resource:",
        reply_markup=create_keyboard(SUBJECTS, "subject"),
        parse_mode=ParseMode.HTML
    )
    return CHOOSE_SUBJECT

async def add_subject(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data['subject'] = query.data.split('_')[1]
    await query.edit_message_text(
        "Select grade:",
        reply_markup=create_keyboard(GRADES, "grade")
    )
    return CHOOSE_GRADE

async def add_grade(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data['grade'] = query.data.split('_')[1]
    await query.edit_message_text(
        "Select resource type:",
        reply_markup=create_keyboard(RESOURCE_TYPES, "type")
    )
    return CHOOSE_TYPE

async def add_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    context.user_data['type'] = query.data.split('_')[1]
    await query.edit_message_text("Enter resource title:")
    return INPUT_TITLE

async def add_title(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data['title'] = update.message.text
    await update.message.reply_text(
        f"Send the Telegram link to the resource\n(Group: {RESOURCE_GROUP_LINK})"
    )
    return INPUT_CONTENT

async def add_content(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    content = update.message.text
    if not is_valid_link(content):
        await update.message.reply_text("❌ Invalid Telegram link! Try again:")
        return INPUT_CONTENT

    resource = {
        'subject': context.user_data['subject'],
        'grade': context.user_data['grade'],
        'type': context.user_data['type'],
        'title': context.user_data['title'],
        'content': content
    }
    
    if db.add_resource(resource):
        await update.message.reply_text(
            "✅ Resource added successfully!",
            parse_mode=ParseMode.HTML
        )
    else:
        await update.message.reply_text(
            "❌ Failed to add resource!",
            parse_mode=ParseMode.HTML
        )
    
    context.user_data.clear()
    return ConversationHandler.END

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.message.reply_text("Operation cancelled!")
    return ConversationHandler.END

# Main function
def main():
    if TELEGRAM_TOKEN == 'your-token-here':
        logger.error("Please set TELEGRAM_TOKEN environment variable")
        return

    global db
    db = Database()

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    # Basic commands
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("stats", stats))

    # Browse conversation
    browse_handler = ConversationHandler(
        entry_points=[CommandHandler("browse", browse_start)],
        states={
            CHOOSE_SUBJECT: [CallbackQueryHandler(browse_subject, pattern="^subject_")],
            CHOOSE_GRADE: [CallbackQueryHandler(browse_grade, pattern="^grade_")],
            CHOOSE_TYPE: [CallbackQueryHandler(browse_type, pattern="^type_")]
        },
        fallbacks=[CommandHandler("cancel", cancel)]
    )

    # Add conversation
    add_handler = ConversationHandler(
        entry_points=[CommandHandler("add", add_start)],
        states={
            CHOOSE_SUBJECT: [CallbackQueryHandler(add_subject, pattern="^subject_")],
            CHOOSE_GRADE: [CallbackQueryHandler(add_grade, pattern="^grade_")],
            CHOOSE_TYPE: [CallbackQueryHandler(add_type, pattern="^type_")],
            INPUT_TITLE: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_title)],
            INPUT_CONTENT: [MessageHandler(filters.TEXT & ~filters.COMMAND, add_content)]
        },
        fallbacks=[CommandHandler("cancel", cancel)]
    )

    app.add_handler(browse_handler)
    app.add_handler(add_handler)

    logger.info("Starting bot...")
    app.run_polling(allowed_updates=["message", "callback_query"])

if __name__ == "__main__":
    main()
