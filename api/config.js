export default function handler(req, res) {
  const stagingRef = 'tmydirzzlmlmtjgwqcgh';
  const isPreview = process.env.VERCEL_ENV === 'preview';
  const previewTarget = process.env.NICO_FIT_PREVIEW_TARGET;
  const url = isPreview
    ? process.env.SUPABASE_STAGING_URL
    : process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = isPreview
    ? process.env.SUPABASE_STAGING_PUBLISHABLE_KEY
    : process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (isPreview && (previewTarget !== 'nico-fit-v3-staging' ||
      process.env.SUPABASE_STAGING_PROJECT_REF !== stagingRef ||
      url !== `https://${stagingRef}.supabase.co` ||
      !publishableKey || publishableKey.startsWith('sb_secret_'))) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({error: 'Preview V3 requiere configuración explícita de nico-fit-v3-staging.'});
  }

  res.setHeader('Cache-Control', 'no-store');

  if (!url || !publishableKey) {
    return res.status(500).json({
      error: 'Faltan SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY/SUPABASE_ANON_KEY en Vercel.'
    });
  }

  return res.status(200).json({ url, publishableKey });
}
