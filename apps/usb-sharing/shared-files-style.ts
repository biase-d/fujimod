export const sharedFilesStyle = `/* Palette, system font, and primary pill match the deployed web app. */
:root {
  color-scheme: dark;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #000;
  color: #eee;
  --dim: #8e8e93;
}
* { box-sizing: border-box; }
body { margin: 0; }
[hidden] { display: none !important; }
.viewer { max-width: 860px; margin: auto; padding: 24px 20px 40px; }
.media { margin-bottom: 20px; }
.media video, .media img {
  display: block;
  width: 100%;
  max-height: 65dvh;
  object-fit: contain;
}
.media video { aspect-ratio: 3 / 2; }
.media img { height: auto; }
h1 { margin: 0 0 14px; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.shared-list { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.shared-list li { margin-bottom: 16px; overflow-wrap: anywhere; }
.shared-list a { color: inherit; text-underline-offset: 3px; }
table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  margin-bottom: 20px;
  font: 11.5px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
}
th, td { text-align: left; vertical-align: top; padding: 5px 0; overflow-wrap: anywhere; }
th { width: 180px; padding-right: 16px; color: var(--dim); font-weight: 400; }
.download {
  display: inline-flex;
  border: 1px solid #fff;
  border-radius: 16px;
  padding: 7px 13px;
  background: #fff;
  color: #000;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.download:hover { background: #ddd; border-color: #ddd; }
.download:focus-visible { outline: 2px solid #eee; outline-offset: 4px; }
@media (max-width: 520px) {
  .viewer { padding: 14px 14px 32px; }
  th { width: 38%; padding-right: 12px; }
  table { font-size: 11px; }
}
`;
