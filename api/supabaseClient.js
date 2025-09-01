// supabaseClient.js
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://jwrvlaxfrnglaxueqgdx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3cnZsYXhmcm5nbGF4dWVxZ2R4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzMDYzOTIsImV4cCI6MjA3MTg4MjM5Mn0.wzW3yQVi5mZOAx8dAmdgLmLOacaPPaxYJv53p_1BIzs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
