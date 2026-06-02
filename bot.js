/*
 * ================================================================================
 * Bot: الرَّاسِخون في العِلم - Cloudflare Workers Version
 * ================================================================================
 * يعمل هذا الـ Worker عبر Webhook من تيليجرام.
 *
 * متغيرات البيئة المطلوبة:
 *   BOT_TOKEN          - توكن البوت من BotFather
 *   ADMIN_IDS          - معرفات المدراء مفصولة بفاصلة
 *   BOT_KV             - KV لتخزين الجلسات، الموارد، والإحصائيات
 *   CONTENT_CHANNEL_ID - معرف القناة الخاصة أو اسم المستخدم @channel
 *   SOURCE_CODE        - نسخة نصية من الكود المصدري للبوت
 *
 * يتم تخزين المحتوى في قناة خاصة وجلبه عبر Telegram copyMessage.
 * يتم حفظ نسخة من الكود المصدري في نفس القناة وتحديثها عند الإضافة أو التعديل.
 * ================================================================================
 */

const DEFAULT_STRUCTURE = {
  grades: {
    "الثانوية العامة - علمي": [
      "الرياضيات", "الفيزياء", "الكيمياء", "علوم الحياة والأرض",
      "اللغة العربية", "اللغة الإنكليزية", "التربية الإسلامية"
    ],
    "الثانوية العامة - أدبي": [
      "اللغة العربية", "اللغة الإنكليزية", "اللغة الفرنسية", "التربية الإسلامية",
      "التاريخ", "الجغرافيا", "الفلسفة"
    ],
    "الصف التاسع": [
      "الرياضيات", "العلوم", "اللغة العربية", "اللغة الإنكليزية",
      "التربية الإسلامية", "التاريخ", "الجغرافيا"
    ]
  },
  semesters: ["الفصل الأول", "الفصل الثاني"]
};

const STATE = {
  MAIN_MENU: "MAIN_MENU",
  BROWSE_GRADE: "BROWSE_GRADE",
  BROWSE_SEMESTER: "BROWSE_SEMESTER",
  BROWSE_SUBJECT: "BROWSE_SUBJECT",
  FEEDBACK: "FEEDBACK",
  ADMIN_MENU: "ADMIN_MENU",
  ADMIN_ADD_CONTENT: "ADMIN_ADD_CONTENT",
  ADMIN_ADD_CONTENT_META: "ADMIN_ADD_CONTENT_META",
  ADMIN_REMOVE_CONTENT: "ADMIN_REMOVE_CONTENT",
  ADMIN_BROADCAST: "ADMIN_BROADCAST",
  ADMIN_EDIT_STRUCTURE: "ADMIN_EDIT_STRUCTURE",
  ADMIN_EDIT_STRUCTURE_META: "ADMIN_EDIT_STRUCTURE_META"
};

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      const update = await request.json();

      if (update.message) {
        await handleMessage(update.message, env);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env);
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Error handling update:", error);
      return new Response("Internal Error", { status: 500 });
    }
  }
};

async function handleMessage(message, env) {
  const botToken = env.BOT_TOKEN;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  const user = message.from;

  let session = await getUserSession(user.id, env);
  if (!session) session = getDefaultSession();
  session.username = user.username || null;
  session.full_name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  session.last_activity = new Date().toISOString();

  await addUserId(user.id, env);
  await updateStatistics("total_messages", env);

  if (text === "/start" || text === "🔙 الرئيسية") {
    session.state = STATE.MAIN_MENU;
    delete session.pendingContent;
    delete session.browse;
    await saveUserSession(user.id, session, env);
    await sendMainMenu(chatId, botToken);
    return;
  }

  if (text === "/help") {
    await sendHelpMessage(chatId, botToken);
    return;
  }

  if (text === "/myprogress" || text === "📊 التقدم") {
    await sendProgressMessage(chatId, session, botToken);
    await saveUserSession(user.id, session, env);
    return;
  }

  if (text === "/bookmarks" || text === "⭐ المفضلة") {
    await sendBookmarks(chatId, session, env, botToken);
    session.state = STATE.MAIN_MENU;
    await saveUserSession(user.id, session, env);
    return;
  }

  if (text === "/admin") {
    if (!isAdmin(user.id, env)) {
      await sendTelegramMessage(chatId, "⛔ عذراً، هذا الأمر متاح للمديرين فقط.", botToken);
      return;
    }
    session.state = STATE.ADMIN_MENU;
    await saveUserSession(user.id, session, env);
    await sendAdminKeyboard(chatId, botToken);
    return;
  }

  if (text === "/cancel") {
    session.state = STATE.MAIN_MENU;
    delete session.pendingContent;
    delete session.browse;
    await saveUserSession(user.id, session, env);
    await sendMainMenu(chatId, botToken);
    return;
  }

  if (session.state === STATE.FEEDBACK) {
    await saveFeedback(user.id, session.full_name, text, env);
    session.state = STATE.MAIN_MENU;
    await saveUserSession(user.id, session, env);
    await sendTelegramMessage(chatId, "✅ *تم استلام ملاحظاتك*\n\nشكراً لك على مساهمتك في تطوير البوت.", botToken);
    return;
  }

  if (text === "💬 ملاحظة") {
    session.state = STATE.FEEDBACK;
    await saveUserSession(user.id, session, env);
    await sendTelegramMessage(chatId, "💬 *أرسل ملاحظتك الآن*\n\nسأرسلها إلى المدراء فوراً.", botToken);
    return;
  }

  if (session.state === STATE.ADMIN_ADD_CONTENT) {
    await prepareAdminContentUpload(message, session, env);
    return;
  }

  if (session.state === STATE.ADMIN_ADD_CONTENT_META) {
    await finishAdminContentUpload(text, session, env);
    return;
  }

  if (session.state === STATE.ADMIN_REMOVE_CONTENT) {
    await removeContentByAdmin(text, session, env);
    return;
  }

  if (session.state === STATE.ADMIN_BROADCAST) {
    await sendBroadcastMessage(text, session, env);
    return;
  }

  if (text === "📚 المواد") {
    session.state = STATE.BROWSE_GRADE;
    await saveUserSession(user.id, session, env);
    await sendGradeMenu(chatId, env, botToken);
    return;
  }

  if (session.state === STATE.BROWSE_GRADE && await isValidGrade(text, env)) {
    session.state = STATE.BROWSE_SEMESTER;
    session.browse = { grade: text };
    await saveUserSession(user.id, session, env);
    await sendSemesterMenu(chatId, text, env, botToken);
    return;
  }

  if (session.state === STATE.BROWSE_SEMESTER && await isValidSemester(text, env)) {
    session.state = STATE.BROWSE_SUBJECT;
    session.browse.semester = text;
    await saveUserSession(user.id, session, env);
    await sendSubjectMenu(chatId, session.browse.grade, text, env, botToken);
    return;
  }

  if (session.state === STATE.BROWSE_SUBJECT && await isValidSubject(session.browse.grade, session.browse.semester, text, env)) {
    session.browse.subject = text;
    await saveUserSession(user.id, session, env);
    await showResourcesMenu(chatId, session.browse.grade, session.browse.semester, text, env, botToken);
    session.state = STATE.MAIN_MENU;
    await saveUserSession(user.id, session, env);
    return;
  }

  if (session.state === STATE.ADMIN_MENU) {
    if (text === "📊 إحصائيات") {
      await sendAdminStatistics(chatId, env, botToken);
      return;
    }
    if (text === "➕ إضافة محتوى") {
      session.state = STATE.ADMIN_ADD_CONTENT;
      await saveUserSession(user.id, session, env);
      await sendTelegramMessage(chatId, "📤 أرسل الآن المحتوى الذي تريد إضافته إلى القناة الخاصة. يمكن أن يكون ملفاً أو نصاً.", botToken);
      return;
    }
    if (text === "🗑️ حذف محتوى") {
      session.state = STATE.ADMIN_REMOVE_CONTENT;
      await saveUserSession(user.id, session, env);
      await sendTelegramMessage(chatId, "🗑️ أرسل معرف المحتوى أو عنوانه لحذفه من النظام.", botToken);
      return;
    }
    if (text === "📣 إرسال جماعي") {
      session.state = STATE.ADMIN_BROADCAST;
      await saveUserSession(user.id, session, env);
      await sendTelegramMessage(chatId, "📣 أرسل النص الذي تريد إرساله لجميع المستخدمين.", botToken);
      return;
    }
    if (text === "🧾 حفظ نسخة الكود") {
      await backupCodeIfPossible(env, botToken);
      await sendTelegramMessage(chatId, "✅ جاري حفظ نسخة من الكود المصدري في القناة الخاصة.", botToken);
      return;
    }
    if (text === "🧩 تعديل الأقسام") {
      session.state = STATE.ADMIN_EDIT_STRUCTURE;
      await saveUserSession(user.id, session, env);
      await sendAdminStructureKeyboard(chatId, botToken);
      return;
    }
  }

  if (session.state === STATE.ADMIN_EDIT_STRUCTURE) {
    if (text === "🔙 الرئيسية") {
      session.state = STATE.ADMIN_MENU;
      await saveUserSession(user.id, session, env);
      await sendAdminKeyboard(chatId, botToken);
      return;
    }
    const actionMap = {
      "➕ إضافة صف": "ADD_GRADE",
      "🗑️ حذف صف": "REMOVE_GRADE",
      "➕ إضافة مادة": "ADD_SUBJECT",
      "🗑️ حذف مادة": "REMOVE_SUBJECT",
      "➕ إضافة فصل": "ADD_SEMESTER",
      "🗑️ حذف فصل": "REMOVE_SEMESTER"
    };
    const action = actionMap[text];
    if (!action) {
      await sendTelegramMessage(chatId, "⚠️ اختر أحد أوامر تعديل البنية من الأزرار أو أرسل نصاً صالحاً.", botToken);
      await sendAdminStructureKeyboard(chatId, botToken);
      return;
    }
    session.state = STATE.ADMIN_EDIT_STRUCTURE_META;
    session.edit_action = action;
    await saveUserSession(user.id, session, env);
    let prompt = "";
    switch (action) {
      case "ADD_GRADE":
        prompt = "أرسل اسم الصف الجديد";
        break;
      case "REMOVE_GRADE":
        prompt = "أرسل اسم الصف المراد حذفه";
        break;
      case "ADD_SUBJECT":
        prompt = "أرسل الصف ثم اسم المادة مفصولين بـ |، مثلاً:\nالثانوية العامة - علمي | الفيزياء";
        break;
      case "REMOVE_SUBJECT":
        prompt = "أرسل الصف ثم اسم المادة المراد حذفها مفصولين بـ |";
        break;
      case "ADD_SEMESTER":
        prompt = "أرسل اسم الفصل الجديد";
        break;
      case "REMOVE_SEMESTER":
        prompt = "أرسل اسم الفصل المراد حذفه";
        break;
    }
    await sendTelegramMessage(chatId, `✏️ ${prompt}`, botToken);
    return;
  }

  if (session.state === STATE.ADMIN_EDIT_STRUCTURE_META) {
    await finishAdminStructureEdit(text, session, env, botToken, chatId, user.id);
    return;
  }

  await sendTelegramMessage(chatId, "🤖 عذراً، لم أفهم هذا الأمر. الرجاء استخدام الأزرار الموجودة أو إرسال /start للعودة إلى القائمة الرئيسية.", botToken);
}

async function handleCallbackQuery(callbackQuery, env) {
  const botToken = env.BOT_TOKEN;
  const queryId = callbackQuery.id;
  const message = callbackQuery.message;
  const chatId = message.chat.id;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;

  await callTelegramApi(botToken, "answerCallbackQuery", { callback_query_id: queryId });

  if (data.startsWith("resource_")) {
    await sendResourceById(data.replace("resource_", ""), chatId, userId, env, botToken);
    return;
  }

  if (data.startsWith("bookmark_")) {
    await toggleBookmark(data.replace("bookmark_", ""), userId, chatId, env, botToken, true);
    return;
  }

  if (data.startsWith("unbookmark_")) {
    await toggleBookmark(data.replace("unbookmark_", ""), userId, chatId, env, botToken, false);
    return;
  }

  if (data === "back_to_main") {
    await sendMainMenu(chatId, botToken);
    return;
  }
}

function isAdmin(userId, env) {
  const adminIds = (env.ADMIN_IDS || "").split(",").map(id => parseInt(id.trim())).filter(Boolean);
  return adminIds.includes(userId);
}

async function getUserSession(userId, env) {
  if (!env.BOT_KV) return getDefaultSession();
  const sessionData = await env.BOT_KV.get(`user_${userId}`);
  return sessionData ? JSON.parse(sessionData) : getDefaultSession();
}

async function saveUserSession(userId, session, env) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`user_${userId}`, JSON.stringify(session));
}

async function addUserId(userId, env) {
  if (!env.BOT_KV) return;
  const raw = await env.BOT_KV.get("user_ids");
  const ids = raw ? JSON.parse(raw) : [];
  if (!ids.includes(userId)) {
    ids.push(userId);
    await env.BOT_KV.put("user_ids", JSON.stringify(ids));
  }
}

async function updateStatistics(statName, env) {
  if (!env.BOT_KV) return;
  const current = parseInt(await env.BOT_KV.get(`stat_${statName}`) || "0");
  await env.BOT_KV.put(`stat_${statName}`, (current + 1).toString());
}

async function getResources(env) {
  if (!env.BOT_KV) return [];
  const raw = await env.BOT_KV.get("content_resources");
  return raw ? JSON.parse(raw) : [];
}

async function saveResources(resources, env) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("content_resources", JSON.stringify(resources));
}

async function getStructure(env) {
  if (!env.BOT_KV) return DEFAULT_STRUCTURE;
  const raw = await env.BOT_KV.get("content_structure");
  return raw ? JSON.parse(raw) : DEFAULT_STRUCTURE;
}

async function saveStructure(structure, env) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put("content_structure", JSON.stringify(structure));
}

function getContentChannelId(env) {
  return env.CONTENT_CHANNEL_ID || env.CONTENT_CHANNEL_USERNAME || null;
}

async function finishAdminStructureEdit(text, session, env, botToken, chatId, userId) {
  const structure = await getStructure(env);
  const action = session.edit_action;
  const parts = text.split("|").map(part => part.trim()).filter(Boolean);
  let message = "";

  switch (action) {
    case "ADD_GRADE": {
      const grade = text.trim();
      if (!grade) {
        message = "⚠️ أرسل اسم الصف الجديد.";
        break;
      }
      if (structure.grades[grade]) {
        message = `⚠️ هذا الصف موجود مسبقاً: ${grade}`;
        break;
      }
      structure.grades[grade] = [];
      message = `✅ تم إضافة الصف الجديد: ${grade}`;
      break;
    }
    case "REMOVE_GRADE": {
      const grade = text.trim();
      if (!grade || !structure.grades[grade]) {
        message = `⚠️ لم أجد الصف: ${grade}`;
        break;
      }
      delete structure.grades[grade];
      message = `✅ تم حذف الصف: ${grade}`;
      break;
    }
    case "ADD_SUBJECT": {
      if (parts.length < 2) {
        message = "⚠️ أرسل الصف ثم اسم المادة مفصولين بـ |.";
        break;
      }
      const [grade, subject] = parts;
      if (!structure.grades[grade]) {
        message = `⚠️ الصف غير موجود: ${grade}`;
        break;
      }
      if (structure.grades[grade].includes(subject)) {
        message = `⚠️ المادة موجودة بالفعل في ${grade}: ${subject}`;
        break;
      }
      structure.grades[grade].push(subject);
      message = `✅ تم إضافة المادة ${subject} إلى الصف ${grade}`;
      break;
    }
    case "REMOVE_SUBJECT": {
      if (parts.length < 2) {
        message = "⚠️ أرسل الصف ثم اسم المادة المراد حذفها مفصولين بـ |.";
        break;
      }
      const [grade, subject] = parts;
      if (!structure.grades[grade] || !structure.grades[grade].includes(subject)) {
        message = `⚠️ لم أجد المادة ${subject} في الصف ${grade}`;
        break;
      }
      structure.grades[grade] = structure.grades[grade].filter(item => item !== subject);
      message = `✅ تم حذف المادة ${subject} من الصف ${grade}`;
      break;
    }
    case "ADD_SEMESTER": {
      const semester = text.trim();
      if (!semester) {
        message = "⚠️ أرسل اسم الفصل الجديد.";
        break;
      }
      if (structure.semesters.includes(semester)) {
        message = `⚠️ هذا الفصل موجود مسبقاً: ${semester}`;
        break;
      }
      structure.semesters.push(semester);
      message = `✅ تم إضافة الفصل الجديد: ${semester}`;
      break;
    }
    case "REMOVE_SEMESTER": {
      const semester = text.trim();
      if (!semester || !structure.semesters.includes(semester)) {
        message = `⚠️ لم أجد هذا الفصل: ${semester}`;
        break;
      }
      structure.semesters = structure.semesters.filter(item => item !== semester);
      message = `✅ تم حذف الفصل: ${semester}`;
      break;
    }
    default:
      message = "⚠️ حدث خطأ غير متوقع أثناء تعديل البنية.";
  }

  await saveStructure(structure, env);
  session.state = STATE.ADMIN_MENU;
  delete session.edit_action;
  await saveUserSession(userId, session, env);
  await sendTelegramMessage(chatId, message, botToken);
  await sendAdminKeyboard(chatId, botToken);
}

function getDefaultSession() {
  return {
    state: STATE.MAIN_MENU,
    bookmarks: [],
    last_activity: null,
    browse: {}
  };
}

async function isValidGrade(text, env) {
  const structure = await getStructure(env);
  return Object.keys(structure.grades).includes(text);
}

async function isValidSemester(text, env) {
  const structure = await getStructure(env);
  return structure.semesters.includes(text);
}

async function isValidSubject(grade, semester, text, env) {
  const structure = await getStructure(env);
  return (structure.grades[grade] || []).includes(text);
}

async function sendTelegramMessage(chatId, text, botToken, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function sendMainMenu(chatId, botToken) {
  const keyboard = {
    keyboard: [
      [{ text: "/start" }],
      [{ text: "📚 المواد" }, { text: "⭐ المفضلة" }],
      [{ text: "📊 التقدم" }, { text: "💬 ملاحظة" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
  const welcomeText = "📚 *مرحباً بك في بوت الرَّاسِخون في العِلم!*\n\n" +
                      "هذا البوت يعمل عبر قناة خاصة في تيليجرام لجلب المحتوى دون رفعه إلى سيرفرات خارجية.";
  await sendTelegramMessage(chatId, welcomeText, botToken, keyboard);
}

async function sendHelpMessage(chatId, botToken) {
  const helpText = "📖 *دليل استخدام بوت الرَّاسِخون في العِلم*\n\n" +
                   "*/start* - العودة إلى القائمة الرئيسية\n" +
                   "*/myprogress* - عرض التقدم الدراسي\n" +
                   "*/bookmarks* - عرض المواد المحفوظة\n" +
                   "*/admin* - أوامر المشرف إن كنت مديراً\n" +
                   "*/cancel* - إلغاء أي عملية";
  await sendTelegramMessage(chatId, helpText, botToken);
}

async function sendProgressMessage(chatId, session, botToken) {
  const progressText = `📊 *تقدمك الدراسي الحالي:*\n\n` +
                       `📚 *الصف:* ${session.browse?.grade || "غير محدد"}\n` +
                       `📖 *الفصل:* ${session.browse?.semester || "غير محدد"}\n` +
                       `📘 *المادة:* ${session.browse?.subject || "غير محددة"}\n` +
                       `⭐ *المحفوظات:* ${session.bookmarks?.length || 0}\n` +
                       `🕒 *آخر نشاط:* ${session.last_activity || "غير متوفر"}`;
  await sendTelegramMessage(chatId, progressText, botToken);
}

async function sendBookmarks(chatId, session, env, botToken) {
  const bookmarks = session.bookmarks || [];
  if (!bookmarks.length) {
    await sendTelegramMessage(chatId, "⭐ *لا يوجد لديك مواد محفوظة بعد.*\n\nيمكنك حفظ أي محتوى عند عرضه باستخدام زر الحفظ.", botToken);
    return;
  }
  let message = "⭐ *المواد المحفوظة*\n\n";
  bookmarks.forEach((bookmark, index) => {
    message += `*${index + 1}.* ${bookmark.title} (\`${bookmark.id}\`)\n`;
  });
  message += "\nاستخدم /start للعودة إلى القائمة الرئيسية.";
  await sendTelegramMessage(chatId, message, botToken);
}

async function sendAdminKeyboard(chatId, botToken) {
  const keyboard = {
    keyboard: [
      [{ text: "📊 إحصائيات" }, { text: "➕ إضافة محتوى" }],
      [{ text: "🗑️ حذف محتوى" }, { text: "📣 إرسال جماعي" }],
      [{ text: � تعديل الأقسام" }, { text: "🧾 حفظ نسخة الكود" }],
      [{ text: "🔙 الرئيسية" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
  await sendTelegramMessage(chatId, "🔧 *لوحة تحكم المشرف*\n\nاختر العملية المناسبة من الأزرار أدناه.", botToken, keyboard);
}

async function sendAdminStructureKeyboard(chatId, botToken) {
  const keyboard = {
    keyboard: [
      [{ text: "➕ إضافة صف" }, { text: "🗑️ حذف صف" }],
      [{ text: "➕ إضافة مادة" }, { text: "🗑️ حذف مادة" }],
      [{ text: "➕ إضافة فصل" }, { text: "🗑️ حذف فصل" }],
      [{ text: "🔙 الرئيسية" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
  await sendTelegramMessage(chatId, "🧩 *تعديل بنية الأقسام*\n\nاختر نوع التعديل أو أرسل النص المطلوب.", botToken, keyboard);
}

async function sendGradeMenu(chatId, env, botToken) {
  const structure = await getStructure(env);
  const keyboard = {
    keyboard: Object.keys(structure.grades).map(grade => [{ text: grade }]).concat([[{ text: "🔙 الرئيسية" }]]),
    resize_keyboard: true,
    one_time_keyboard: false
  };
  await sendTelegramMessage(chatId, "📚 *اختر الصف الدراسي من شجرة الأقسام*", botToken, keyboard);
}

async function sendSemesterMenu(chatId, grade, env, botToken) {
  const structure = await getStructure(env);
  const keyboard = {
    keyboard: structure.semesters.map(semester => [{ text: semester }]).concat([[{ text: "🔙 الرئيسية" }]]),
    resize_keyboard: true,
    one_time_keyboard: false
  };
  await sendTelegramMessage(chatId, `📖 *الصف:* ${grade}\n\nاختر الفصل الدراسي:`, botToken, keyboard);
}

async function sendSubjectMenu(chatId, grade, semester, env, botToken) {
  const structure = await getStructure(env);
  const subjects = structure.grades[grade] || [];
  if (!subjects.length) {
    await sendTelegramMessage(chatId, `⚠️ هذا القسم فارغ حالياً:\n*${grade}* | *${semester}*\n\nيمكن للمشرف تعبئته عبر /admin.`, botToken);
    return;
  }
  const keyboard = {
    keyboard: subjects.map(subject => [{ text: subject }]).concat([[{ text: "🔙 الرئيسية" }]]),
    resize_keyboard: true,
    one_time_keyboard: false
  };
  await sendTelegramMessage(chatId, `📘 *${grade} - ${semester}*\n\nاختر المادة:`, botToken, keyboard);
}

async function showResourcesMenu(chatId, grade, semester, subject, env, botToken) {
  const resources = await getResources(env);
  const filtered = resources.filter(r => r.grade === grade && r.semester === semester && r.subject === subject);
  if (!filtered.length) {
    await sendTelegramMessage(chatId, `⚠️ لا يوجد محتوى لهذا القسم:\n📚 *${grade}* | 📖 *${semester}* | 📘 *${subject}*\n\nالصفحة فارغة حالياً ويمكن تعبئتها من قبل المشرف عبر /admin.`, botToken);
    return;
  }

  const buttons = filtered.slice(0, 8).map(resource => [{ text: `📄 ${resource.title}`, callback_data: `resource_${resource.id}` }]);
  buttons.push([{ text: "🔙 الرئيسية", callback_data: "back_to_main" }]);
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `📁 *الملفات المتاحة:*\n\n📚 *${grade}* | 📖 *${semester}* | 📘 *${subject}*\n\nاختر الملف المطلوب:`,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    })
  });
}

async function sendResourceById(resourceId, chatId, userId, env, botToken) {
  const resources = await getResources(env);
  const resource = resources.find(r => r.id === resourceId);
  if (!resource) {
    await sendTelegramMessage(chatId, "⚠️ عذراً، المحتوى غير موجود حالياً.", botToken);
    return;
  }

  const channelId = getContentChannelId(env);
  if (!channelId) {
    await sendTelegramMessage(chatId, "⚠️ لم يتم تكوين قناة المحتوى. الرجاء تعيين CONTENT_CHANNEL_ID.", botToken);
    return;
  }

  const result = await callTelegramApi(botToken, "copyMessage", {
    chat_id: chatId,
    from_chat_id: channelId,
    message_id: resource.channel_message_id
  });

  if (!result.ok) {
    await sendTelegramMessage(chatId, "⚠️ فشل جلب المحتوى من القناة الخاصة. تأكد من أن البوت مشرف في القناة.", botToken);
    return;
  }

  await updateStatistics("total_content_views", env);
  await incrementWeeklyResourceView(resourceId, env);

  const session = await getUserSession(userId, env);
  session.last_resource = resourceId;
  session.last_activity = new Date().toISOString();
  await saveUserSession(userId, session, env);

  const isBookmarked = session.bookmarks.some(bookmark => bookmark.id === resourceId);
  const button = isBookmarked
    ? [{ text: "🗑️ إزالة من المفضلة", callback_data: `unbookmark_${resourceId}` }]
    : [{ text: "⭐ حفظ في المفضلة", callback_data: `bookmark_${resourceId}` }];

  await sendTelegramMessage(chatId, `📚 *${resource.title}*\n\n${resource.description || "لا يوجد وصف حالياً."}`, botToken, { inline_keyboard: [button] });
}

async function toggleBookmark(resourceId, userId, chatId, env, botToken, add) {
  const session = await getUserSession(userId, env);
  const resources = await getResources(env);
  const resource = resources.find(r => r.id === resourceId);
  if (!resource) {
    await sendTelegramMessage(chatId, "⚠️ هذا المحتوى غير متوفر حالياً.", botToken);
    return;
  }

  session.bookmarks = session.bookmarks || [];
  if (add) {
    if (!session.bookmarks.some(b => b.id === resourceId)) {
      session.bookmarks.push({ id: resource.id, title: resource.title, added_at: new Date().toISOString() });
      await sendTelegramMessage(chatId, "✅ تمت إضافة المحتوى إلى المفضلة.", botToken);
    } else {
      await sendTelegramMessage(chatId, "⭐ المحتوى موجود بالفعل في المفضلة.", botToken);
    }
  } else {
    session.bookmarks = session.bookmarks.filter(b => b.id !== resourceId);
    await sendTelegramMessage(chatId, "✅ تمت إزالة المحتوى من المفضلة.", botToken);
  }
  await saveUserSession(userId, session, env);
}

async function callTelegramApi(botToken, method, params) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  return response.json();
}

async function prepareAdminContentUpload(message, session, env) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const botToken = env.BOT_TOKEN;

  if (!isAdmin(userId, env)) {
    await sendTelegramMessage(chatId, "⛔ هذا الأمر متاح للمديرين فقط.", botToken);
    return;
  }

  if (!message.document && !message.photo && !message.video && !message.audio && !message.voice && !message.animation && !message.sticker && !message.text) {
    await sendTelegramMessage(chatId, "⚠️ يرجى إرسال الملف أو النص الذي تريد إضافته.", botToken);
    return;
  }

  session.pendingContent = {
    source_chat_id: chatId,
    message_id: message.message_id
  };
  session.state = STATE.ADMIN_ADD_CONTENT_META;
  await saveUserSession(userId, session, env);

  await sendTelegramMessage(chatId, "✅ تم استلام المحتوى. الآن أرسل بياناته بهذا الشكل:\n`العنوان | الصف | الفصل | المادة | الوسوم`\n\nمثال:\nملخص الفيزياء | الثانوية العامة - علمي | الفصل الأول | الفيزياء | فيزياء,مراجعة", botToken);
}

async function finishAdminContentUpload(text, session, env) {
  const botToken = env.BOT_TOKEN;
  const chatId = session.pendingContent?.source_chat_id;
  if (!chatId) return;

  const parts = text.split("|").map(part => part.trim()).filter(Boolean);
  if (parts.length < 4) {
    await sendTelegramMessage(chatId, "⚠️ البيانات غير مكتملة. أرسل: العنوان | الصف | الفصل | المادة | الوسوم", botToken);
    return;
  }

  const [title, grade, semester, subject, tagsText = ""] = parts;
  const tags = tagsText.split(",").map(tag => tag.trim()).filter(Boolean);
  const channelId = getContentChannelId(env);
  if (!channelId) {
    await sendTelegramMessage(chatId, "⚠️ لم يتم تكوين قناة المحتوى. الرجاء ضبط CONTENT_CHANNEL_ID في البيئة.", botToken);
    return;
  }

  const copied = await callTelegramApi(botToken, "copyMessage", {
    chat_id: channelId,
    from_chat_id: session.pendingContent.source_chat_id,
    message_id: session.pendingContent.message_id
  });

  if (!copied.ok) {
    await sendTelegramMessage(chatId, "⚠️ فشل نقل المحتوى إلى القناة الخاصة. تأكد من أن البوت مشرف في القناة.", botToken);
    return;
  }

  const resourceId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const resources = await getResources(env);
  resources.push({
    id: resourceId,
    title,
    description: "",
    grade,
    semester,
    subject,
    tags,
    channel_chat_id: channelId,
    channel_message_id: copied.result.message_id,
    added_by: session.username || session.full_name || "admin",
    added_at: new Date().toISOString(),
    views: 0
  });

  await saveResources(resources, env);
  await updateStatistics("total_resources", env);
  session.state = STATE.MAIN_MENU;
  delete session.pendingContent;
  await saveUserSession(user.id, session, env);
  await sendTelegramMessage(chatId, `✅ تم إضافة المحتوى بنجاح. معرف المحتوى: \`${resourceId}\``, botToken);
  await backupCodeIfPossible(env, botToken);
}

async function removeContentByAdmin(text, session, env) {
  const botToken = env.BOT_TOKEN;
  const chatId = session.user_chat_id || session.pendingContent?.source_chat_id;
  if (!chatId) return;

  const resources = await getResources(env);
  const index = resources.findIndex(r => r.id === text || r.title === text);
  if (index === -1) {
    await sendTelegramMessage(chatId, "⚠️ لم أتمكن من العثور على المحتوى الذي أرسلته.", botToken);
    return;
  }

  resources.splice(index, 1);
  await saveResources(resources, env);
  await updateStatistics("total_resources_removed", env);
  session.state = STATE.MAIN_MENU;
  delete session.pendingContent;
  await saveUserSession(user.id, session, env);
  await sendTelegramMessage(chatId, "✅ تم حذف المحتوى بنجاح.", botToken);
  await backupCodeIfPossible(env, botToken);
}

async function sendBroadcastMessage(text, session, env) {
  const botToken = env.BOT_TOKEN;
  const raw = await env.BOT_KV.get("user_ids");
  const userIds = raw ? JSON.parse(raw) : [];
  const sender = session.user_id || session.pendingContent?.source_chat_id || userIds[0] || 0;
  await sendTelegramMessage(sender, `⏳ جاري إرسال الرسالة إلى ${userIds.length} مستخدم...`, botToken);

  for (const userId of userIds) {
    try {
      await sendTelegramMessage(userId, `📣 *رسالة من إدارة الرَّاسِخون في العِلم:*\n\n${text}`, botToken);
    } catch (_error) {
      // تجاهل الأخطاء
    }
  }

  await updateStatistics("total_broadcasts", env);
  session.state = STATE.MAIN_MENU;
  await saveUserSession(user.id, session, env);
  await sendTelegramMessage(sender, "✅ تم إرسال الرسالة إلى جميع المستخدمين.", botToken);
}

async function backupCodeIfPossible(env, botToken) {
  if (!env.BOT_KV) return;
  const sourceCode = env.SOURCE_CODE;
  const channelId = getContentChannelId(env);
  if (!sourceCode || !channelId) return;

  const codeText = `📄 *نسخة احتياطية من الكود المصدري للبوت*\n\n${sourceCode}`;
  const existingMessageId = await env.BOT_KV.get("code_backup_message_id");

  if (existingMessageId) {
    await callTelegramApi(botToken, "editMessageText", {
      chat_id: channelId,
      message_id: parseInt(existingMessageId, 10),
      text: codeText,
      parse_mode: "Markdown"
    });
  } else {
    const result = await callTelegramApi(botToken, "sendMessage", {
      chat_id: channelId,
      text: codeText,
      parse_mode: "Markdown"
    });
    if (result.ok) {
      await env.BOT_KV.put("code_backup_message_id", result.result.message_id.toString());
    }
  }
}

async function incrementWeeklyResourceView(resourceId, env) {
  if (!env.BOT_KV) return;
  const key = `weekly_view_${resourceId}`;
  const current = parseInt(await env.BOT_KV.get(key) || "0");
  await env.BOT_KV.put(key, (current + 1).toString(), { expirationTtl: 7 * 24 * 60 * 60 });
}

async function sendAdminStatistics(chatId, env, botToken) {
  if (!env.BOT_KV) {
    await sendTelegramMessage(chatId, "⚠️ لم يتم تكوين KV للإحصائيات.", botToken);
    return;
  }

  const userIds = JSON.parse(await env.BOT_KV.get("user_ids") || "[]");
  const resources = await getResources(env);
  const totalUsers = userIds.length;
  const totalResources = resources.length;
  const totalViews = parseInt(await env.BOT_KV.get("stat_total_content_views") || "0");

  let totalBookmarks = 0;
  const topUsers = [];
  for (const id of userIds) {
    const sessionData = await env.BOT_KV.get(`user_${id}`);
    const session = sessionData ? JSON.parse(sessionData) : null;
    if (!session) continue;
    const count = (session.bookmarks || []).length;
    totalBookmarks += count;
    topUsers.push({ id, bookmarks: count, last_activity: session.last_activity || "-" });
  }
  topUsers.sort((a, b) => b.bookmarks - a.bookmarks);

  const weeklyKeys = await env.BOT_KV.list({ prefix: "weekly_view_" });
  const weeklyCounts = [];
  for (const key of weeklyKeys.keys) {
    const resourceId = key.name.replace("weekly_view_", "");
    const count = parseInt(await env.BOT_KV.get(key.name) || "0");
    const resource = resources.find(r => r.id === resourceId);
    weeklyCounts.push({ title: resource?.title || resourceId, count });
  }
  weeklyCounts.sort((a, b) => b.count - a.count);

  let message = `📊 *إحصائيات البوت*\n\n` +
                `👥 *عدد المستخدمين:* ${totalUsers}\n` +
                `📚 *عدد الموارد:* ${totalResources}\n` +
                `👁️ *عدد المشاهدات:* ${totalViews}\n` +
                `⭐ *عدد المحفوظات:* ${totalBookmarks}\n\n` +
                `*أفضل 5 مستخدمين حسب المفضلات:*\n`;
  topUsers.slice(0, 5).forEach(user => {
    message += `- ${user.id} | محفوظات: ${user.bookmarks} | آخر نشاط: ${user.last_activity}\n`;
  });
  message += `\n*أفضل 5 موارد هذا الأسبوع:*\n`;
  weeklyCounts.slice(0, 5).forEach(item => {
    message += `- ${item.title} (${item.count})\n`;
  });

  await sendTelegramMessage(chatId, message, botToken);
}
