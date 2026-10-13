/* =====================================================================
   Study Planner — configuration

   Leave these blank and the app runs on the local DEVELOPMENT driver:
   accounts and data live only in this browser. It is enough to click
   through every screen, but it is NOT private and NOT shared between
   devices.

   To make it real, paste your Supabase project values below.

   Both of these are SAFE TO COMMIT. The anon key is a public key — it is
   designed to sit in frontend code. What actually protects each student's
   data is the row-level security in supabase/schema.sql, which makes the
   database refuse to return rows belonging to anybody else. The
   service_role key is the dangerous one and must NEVER appear in this
   file or anywhere else the browser can read.
   ===================================================================== */
window.STUDY_PLANNER_CONFIG = {
  SUPABASE_URL: "",       // e.g. "https://abcdefghijkl.supabase.co"
  SUPABASE_ANON_KEY: ""   // Project Settings -> API -> anon public
};
