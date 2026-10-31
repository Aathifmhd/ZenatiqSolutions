// Supabase connection used by the admin portal (/admin) and the
// Contact with Zenatiq widget (/connect). Both values are meant to be public:
// the database's access rules decide what anyone can see or change.
// Find them in Supabase -> Project Settings -> API.
window.ZENATIQ_CONFIG = {
  supabaseUrl: '',      // e.g. https://abcdefghijklmnop.supabase.co
  supabaseAnonKey: '',  // the "anon public" key
};
