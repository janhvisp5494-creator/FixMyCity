// FixMyCity app configuration.
// The anon key is designed to be public (access is controlled by Row Level Security),
// but NEVER put the service_role key in this file.
window.FMC_CONFIG = {
  SUPABASE_URL: "https://ppywxlnibecthqzfxuvu.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_1BUgC9TGiVhzL_AYj1jfXg_lbs5g7KA", // Supabase > Project Settings > API > anon public
  RADIUS_M: 150,            // Repeat Issue Radar default radius in metres
  MIN_CLUSTER: 3,           // reports needed before a cluster is suggested
  DEFAULT_CENTER: [20.5937, 78.9629], // used when there are no reports and no location access
  DEFAULT_ZOOM: 5
};
