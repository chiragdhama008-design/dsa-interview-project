import { createClient } from '@supabase/supabase-js'; // Or '@supabase/supabase-js' depending on your package version

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);