// Values the two index pages share: the site address, the index name, and
// the stylesheet. Kept apart from either page so they can import each other's
// sections without a cycle.
export const SITE = 'https://naeha-s.github.io/ctxcap';
export const INDEX = 'The Context Budget Index';
export const STYLE = `  :root { --bg:#fbfaf7; --fg:#1c1b19; --muted:#6b675f; --line:#e4e0d8; --bar:#c2410c; --bar-small:#4d7c0f; --link:#1d4ed8; --card:#ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141413; --fg:#ecebe7; --muted:#a09c93; --line:#2e2d2a; --bar:#fb923c; --bar-small:#a3e635; --link:#93c5fd; --card:#1c1c1a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 56px 20px 80px; }
  a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .kicker { color: var(--muted); font-size: 14px; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 12px; }
  .kicker a { color: inherit; }
  h1 { font-size: clamp(30px, 5.2vw, 46px); line-height: 1.12; letter-spacing: -.02em; margin: 0 0 20px; }
  h2 { font-size: 22px; letter-spacing: -.01em; margin: 56px 0 8px; }
  p { margin: 0 0 16px; }
  .lede { font-size: 20px; line-height: 1.5; max-width: 40em; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 32px 0 16px; padding: 0; list-style: none; }
  .stats li { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .stats b { display: block; font-size: 28px; line-height: 1.15; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .stats span { color: var(--muted); font-size: 14px; line-height: 1.35; display: block; margin-top: 4px; }
  .note { max-width: 44em; }
  .small { color: var(--muted); font-size: 15px; max-width: 46em; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 0; font-variant-numeric: tabular-nums; }
  thead th { text-align: left; font-size: 13px; font-weight: 600; color: var(--muted); letter-spacing: .03em; text-transform: uppercase; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--line); }
  td { padding: 10px 12px 10px 0; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .num { text-align: right; white-space: nowrap; }
  thead th.num { text-align: right; }
  .rank { width: 2.2em; color: var(--muted); }
  .repo a { font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
  .repo a:hover { text-decoration: underline; }
  .file { display: block; color: var(--muted); font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .stars { color: var(--muted); }
  .tokens { width: 36%; padding-right: 0; }
  .tokens .n { display: block; font-weight: 600; line-height: 1.3; }
  .tokens .bar { display: block; height: 8px; margin-top: 4px; border-radius: 3px; background: var(--bar); }
  .under .tokens .bar { background: var(--bar-small); }
  .divider th { text-align: left; font-size: 15px; font-weight: 600; padding: 28px 0 10px; border-bottom: 1px solid var(--line); }
  .divider span { display: block; font-weight: 400; color: var(--muted); }
  ul.method { padding-left: 1.2em; margin: 0 0 16px; }
  ul.method li { margin: 0 0 10px; max-width: 46em; }
  code, pre { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--card); border: 1px solid var(--line); border-radius: 4px; }
  code { padding: 1px 5px; }
  pre { padding: 12px 14px; overflow-x: auto; max-width: 46em; margin: 0 0 16px; }
  @media (max-width: 640px) {
    body { font-size: 16px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .stars { display: none; }
    .tokens { width: 30%; }
  }
  .compare { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin: 24px 0 8px; }
  .compare h2 { margin: 0 0 6px; font-size: 19px; }
  .compare p { margin: 0 0 12px; color: var(--muted); font-size: 15px; max-width: 42em; }
  .compare form { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
  .compare label { display: block; font-size: 14px; color: var(--muted); }
  .compare input { width: 11em; padding: 8px 10px; font: inherit; font-variant-numeric: tabular-nums; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 7px; }
  .compare button { padding: 9px 14px; font: inherit; font-weight: 600; color: var(--bg); background: var(--fg); border: 0; border-radius: 7px; cursor: pointer; }
  .compare output { flex-basis: 100%; min-height: 1.6em; font-variant-numeric: tabular-nums; }
  .compare output b { font-variant-numeric: tabular-nums; }
`;

