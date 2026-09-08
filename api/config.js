export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  res.setHeader('Cache-Control', 'no-store');

  if (!url || !publishableKey) {
    return res.status(500).json({
      error: 'Faltan SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY/SUPABASE_ANON_KEY en Vercel.'
    });
  }

  return res.status(200).json({ url, publishableKey });
}
