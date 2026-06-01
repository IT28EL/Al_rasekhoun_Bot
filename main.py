
import os
from supabase import create_client, Client

SUPABASE_URL = "https://dnjwfulyobufwdqezktd.supabase.co"
SUPABASE_KEY = "sb_publishable_As6dVjy3l11aIB3zvMJbbQ_R4gqRmfr"

try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    # محاولة جلب البيانات من الجدول
    res = supabase.table("users").select("*").execute()
    print("✅ تم الاتصال بنجاح! الجداول موجودة والربط سليم.")
except Exception as e:
    print(f"❌ خطأ في الربط: {e}")
