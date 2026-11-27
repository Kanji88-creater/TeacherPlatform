/*
  Example AI proxy for the Teacher Dashboard (Cloudflare Worker). The developer deploys this once.
  Your Anthropic API key stays here on the server and is never put in the app.

  Settings (Worker environment): ANTHROPIC_API_KEY (secret), ACCESS_CODE (secret, teachers type it in Settings),
  ALLOWED_ORIGIN (your site address), MODEL (optional, defaults to claude-sonnet-5-5).
  Then paste the Worker address into Settings > AI service address in the app.
*/
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Headers': 'Content-Type, x-access-code', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (env.ACCESS_CODE && req.headers.get('x-access-code') !== env.ACCESS_CODE) return new Response('Access code required', { status: 401, headers: cors });
    const { system, messages } = await req.json();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.MODEL || 'claude-sonnet-5-5', max_tokens: 2500, system, messages })
    });
    const d = await r.json();
    return new Response(JSON.stringify({ text: (d.content || []).map(x => x.text || '').join('') }), { status: r.ok ? 200 : 502, headers: { ...cors, 'content-type': 'application/json' } });
  }
};
