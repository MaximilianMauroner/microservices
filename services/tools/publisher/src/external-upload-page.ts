import { renderSuiteChrome } from "@tools-platform/suite-chrome";

export function renderExternalUploadPage(options: {
  assetVersion: string;
  retentionLabel: string;
}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Temporary uploads</title>
  <link rel="icon" href="/assets/icons/publisher.png" type="image/png" sizes="48x48">
  <link rel="stylesheet" href="/publish/assets/${escapeHtml(options.assetVersion)}/app.css">
</head>
<body>
  ${renderSuiteChrome("publish")}
  <header class="topbar">
    <div class="topbar__inner">
      <a class="brand" href="/publish" aria-label="Temporary uploads">
        <img src="/assets/icons/publisher.png" alt="" width="28" height="28">
        <span>Temporary uploads</span>
      </a>
      <div class="identity" id="identity">
        <span class="identity__status" aria-hidden="true"></span>
        <span class="identity__email" id="identity-email">Authenticated</span>
        <button class="identity__signout" id="sign-out" type="button" aria-label="Sign out" title="Sign out">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M10 17l5-5-5-5"></path>
            <path d="M15 12H3"></path>
            <path d="M21 3v18h-7"></path>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <main id="main">
    <section class="auth-panel" id="auth-panel" aria-labelledby="auth-heading" hidden>
      <span class="auth-panel__icon">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6z"></path>
          <path d="m9 12 2 2 4-4"></path>
        </svg>
      </span>
      <h1 id="auth-heading">Session required</h1>
      <p id="auth-message">Sign in again to continue.</p>
      <button class="button button--primary auth-panel__button" id="sign-in" type="button">
        Refresh sign-in
      </button>
    </section>

    <div id="authenticated-app">
      <nav class="view-tabs" role="tablist" aria-label="Upload views">
        <button class="view-tab is-active" id="upload-tab" type="button" role="tab" aria-selected="true" aria-controls="upload-view">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 16V4"></path>
            <path d="m7 9 5-5 5 5"></path>
            <path d="M20 15v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4"></path>
          </svg>
          Upload
        </button>
        <button class="view-tab" id="recent-tab" type="button" role="tab" aria-selected="false" aria-controls="recent-view">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7h16"></path>
            <path d="M4 12h16"></path>
            <path d="M4 17h10"></path>
          </svg>
          Recent
        </button>
      </nav>

    <section class="workspace" id="upload-view" role="tabpanel" aria-labelledby="upload-tab upload-heading">
      <div class="workspace__heading">
        <div>
          <h1 id="upload-heading">Upload a file</h1>
          <p>Files expire after ${escapeHtml(options.retentionLabel)}.</p>
        </div>
        <span class="expiry">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v5l3 2"></path>
          </svg>
          ${escapeHtml(options.retentionLabel)}
        </span>
      </div>

      <form id="upload-form" novalidate>
        <label class="dropzone" id="dropzone" for="file-input">
          <span class="dropzone__icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 16V4"></path>
              <path d="m7 9 5-5 5 5"></path>
              <path d="M20 15v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4"></path>
            </svg>
          </span>
          <span class="dropzone__title">Drop a file here</span>
          <span class="dropzone__or">or</span>
          <span class="choose-button">Choose file</span>
          <input id="file-input" name="file" type="file" required>
        </label>

        <div class="selection" id="selection" hidden>
          <div class="file-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6 2h8l4 4v16H6z"></path>
              <path d="M14 2v5h5"></path>
            </svg>
          </div>
          <div class="file-details">
            <strong id="file-name"></strong>
            <span id="file-size"></span>
          </div>
          <button class="icon-button" id="clear-file" type="button" aria-label="Remove selected file" title="Remove selected file">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12"></path>
              <path d="M18 6 6 18"></path>
            </svg>
          </button>
        </div>

        <div class="progress" id="progress" hidden aria-live="polite">
          <div class="progress__labels">
            <span id="progress-label">Uploading</span>
            <span id="progress-value">0%</span>
          </div>
          <div class="progress__track" aria-hidden="true">
            <span id="progress-bar"></span>
          </div>
        </div>

        <div class="message message--error" id="error-message" hidden role="alert"></div>

        <div class="actions">
          <button class="button button--primary" id="upload-button" type="submit" disabled>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 16V4"></path>
              <path d="m7 9 5-5 5 5"></path>
              <path d="M20 15v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4"></path>
            </svg>
            Upload
          </button>
          <button class="button button--secondary" id="cancel-button" type="button" hidden>
            Cancel
          </button>
        </div>
      </form>

      <section class="result" id="result" hidden aria-live="polite">
        <div class="result__status">
          <span class="result__check">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m5 12 4 4L19 6"></path>
            </svg>
          </span>
          <div>
            <h2>Upload complete</h2>
            <p id="result-meta"></p>
          </div>
        </div>
        <label class="url-label" for="result-url">Shareable URL</label>
        <div class="url-field">
          <input id="result-url" type="text" readonly>
          <button class="icon-button icon-button--copy" id="copy-url" type="button" aria-label="Copy URL" title="Copy URL">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <rect x="9" y="9" width="11" height="11" rx="2"></rect>
              <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path>
            </svg>
          </button>
        </div>
        <div class="result__actions">
          <a class="button button--secondary" id="open-url" href="#">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M14 5h5v5"></path>
              <path d="m10 14 9-9"></path>
              <path d="M19 14v5H5V5h5"></path>
            </svg>
            Open
          </a>
          <button class="button button--primary" id="new-upload" type="button">
            Upload another
          </button>
        </div>
      </section>
    </section>

    <section class="workspace recent-view" id="recent-view" role="tabpanel" aria-labelledby="recent-tab recent-heading" hidden>
      <div class="workspace__heading recent-heading">
        <div>
          <h1 id="recent-heading">Recent uploads</h1>
          <p id="recent-summary">Plans and unexpired files in the shared bucket.</p>
        </div>
        <button class="icon-button refresh-button" id="refresh-uploads" type="button" aria-label="Refresh uploads" title="Refresh uploads">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M20 6v5h-5"></path>
            <path d="M4 18v-5h5"></path>
            <path d="M18.5 9a7 7 0 0 0-12-2L4 9"></path>
            <path d="M5.5 15a7 7 0 0 0 12 2l2.5-2"></path>
          </svg>
        </button>
      </div>
      <div class="recent-toolbar">
        <div class="filter-control" role="group" aria-label="Filter uploads">
          <button class="filter-button is-active" type="button" data-filter="all">All</button>
          <button class="filter-button" type="button" data-filter="html">Plans</button>
          <button class="filter-button" type="button" data-filter="file">Files</button>
        </div>
        <label class="recent-field recent-field--search">Search filenames <input id="upload-search" type="search" autocomplete="off" placeholder="Filename"></label>
        <label class="recent-field">Expiry <select id="upload-expiry"><option value="all">All</option><option value="24h">Next 24 hours</option><option value="7d">Next 7 days</option><option value="persistent">Persistent plans</option></select></label>
        <label class="recent-field">Sort <select id="upload-sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="filename">Filename A–Z</option><option value="expiry">Expiry soonest</option></select></label>
      </div>
      <div class="upload-list" id="upload-list" aria-live="polite"></div>
      <div class="list-state" id="list-state">Loading uploads...</div>
      <div class="load-more" id="load-more-wrap" hidden>
        <button class="button button--secondary load-more__button" id="load-more" type="button">
          Load more
        </button>
      </div>
    </section>
    </div>
  </main>

  <script src="/publish/assets/${escapeHtml(options.assetVersion)}/app.js" defer></script>
</body>
</html>`;
}

export const EXTERNAL_UPLOAD_STYLES = `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --ink: #18211c;
  --muted: #667068;
  --paper: #f3f1e9;
  --surface: #fffdf7;
  --line: #d9d8cf;
  --accent: #087451;
  --accent-soft: #dff2e8;
  --blue: #185c91;
  --amber: #975e08;
  --amber-soft: #fff0ce;
  --red: #9a3d3a;
  --red-soft: #fae7e5;
  --radius: 8px;
  --radius-lg: 12px;
  --shadow: 0 18px 50px rgba(24, 33, 28, .07);
  color: var(--ink);
  background: var(--paper);
  font-synthesis: none;
}

* { box-sizing: border-box; }
body { min-width: 320px; min-height: 100vh; margin: 0; background: radial-gradient(circle at 88% 0%, rgba(8, 116, 81, .07), transparent 32rem), var(--paper); }
button, input { font: inherit; }
button, label, a { -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.suite-skip { position: fixed; z-index: 100; top: 8px; left: 8px; padding: 9px 12px; transform: translateY(-160%); border-radius: 6px; background: #17212b; color: #fff; }
.suite-skip:focus { transform: translateY(0); }
.suite-header { position: relative; z-index: 10; border-bottom: 1px solid rgba(24, 33, 28, .12); background: rgba(255, 253, 247, .92); backdrop-filter: blur(16px); }
.suite-header__inner { width: min(100% - 32px, 1080px); min-height: 64px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.suite-brand { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 9px; color: var(--ink); font-weight: 800; text-decoration: none; }
.suite-brand > span { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; background: var(--accent); color: #fff; font-size: 13px; }
.suite-nav { display: flex; min-width: 0; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: thin; }
.suite-nav a { display: inline-flex; min-height: 38px; flex: 0 0 auto; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 6px; color: var(--muted); font-size: 13px; font-weight: 700; text-decoration: none; }
.suite-nav a:hover { color: var(--ink); background: #ecece7; }
.suite-nav a[aria-current="page"] { color: #07583f; background: var(--accent-soft); }
.suite-lock { position: relative; width: 9px; height: 8px; display: inline-block; border: 1.5px solid currentColor; border-radius: 2px; opacity: .65; }
.suite-lock::before { content: ""; position: absolute; left: 1px; bottom: 5px; width: 4px; height: 4px; border: 1.5px solid currentColor; border-bottom: 0; border-radius: 4px 4px 0 0; }

.topbar { height: 58px; border-bottom: 1px solid var(--line); background: transparent; }
.topbar__inner {
  width: min(100% - 32px, 920px);
  height: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.brand { min-width: 0; display: flex; align-items: center; gap: 10px; color: var(--ink); font-size: 15px; font-weight: 800; text-decoration: none; }
.brand img { flex: 0 0 auto; }
.identity { min-width: 0; display: flex; align-items: center; gap: 8px; color: #536170; font-size: 13px; }
.identity__status { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #1f9d69; box-shadow: 0 0 0 3px #e4f5ed; }
.identity__email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.identity__signout { width: 30px; height: 30px; margin-left: 2px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #687785; cursor: pointer; }
.identity__signout:hover { border-color: #d3dbe1; background: #f5f7f8; color: #243442; }
.identity__signout:focus-visible { outline: 3px solid rgba(23, 105, 170, 0.2); outline-offset: 2px; }
.identity__signout svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

main { width: min(100% - 32px, 820px); margin: 0 auto; padding: 64px 0 88px; }
.auth-panel { min-height: 320px; padding: 48px 28px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid #d5dde3; border-radius: 8px; background: #fff; box-shadow: 0 10px 28px rgba(25, 42, 56, 0.07); text-align: center; }
.auth-panel__icon { width: 48px; height: 48px; display: grid; place-items: center; border: 1px solid #b9d9cc; border-radius: 8px; background: #f2fbf7; color: #087f5b; }
.auth-panel__icon svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.auth-panel h1 { margin-top: 18px; }
.auth-panel p { max-width: 360px; margin-top: 7px; color: #677583; font-size: 14px; line-height: 1.5; }
.auth-panel__button { margin-top: 24px; }
.view-tabs { height: 42px; margin-bottom: 14px; display: inline-flex; padding: 3px; border: 1px solid #d5dde3; border-radius: 7px; background: #fff; }
.view-tab { min-width: 104px; height: 34px; padding: 0 13px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 5px; background: transparent; color: #61707d; font-size: 13px; font-weight: 700; cursor: pointer; }
.view-tab:hover { color: #243442; }
.view-tab.is-active { background: #eaf5f1; color: #087252; }
.view-tab:focus-visible { outline: 3px solid rgba(23, 105, 170, 0.2); outline-offset: 2px; }
.view-tab svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.workspace { overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: rgba(255, 253, 247, .92); box-shadow: var(--shadow); }
.workspace__heading { min-height: 96px; padding: 24px 28px; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; border-bottom: 1px solid #e3e8ec; }
h1, h2, p { margin: 0; }
h1 { font-size: 21px; line-height: 1.3; letter-spacing: 0; }
.workspace__heading p { margin-top: 5px; color: #677583; font-size: 14px; }
.expiry { min-height: 30px; padding: 5px 9px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #efd9aa; border-radius: 6px; background: #fff8e9; color: #8b570c; font-size: 12px; font-weight: 700; white-space: nowrap; }
.expiry svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; }

form { padding: 28px; }
.dropzone { min-height: 244px; padding: 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #9eabb6; border-radius: 7px; background: #fafbfc; cursor: pointer; transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease; }
.dropzone:hover, .dropzone:focus-within, .dropzone.is-dragging { border-color: #087f5b; background: #f2fbf7; box-shadow: inset 0 0 0 1px #087f5b; }
.dropzone__icon { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid #c8d1d8; border-radius: 7px; background: #fff; color: #087f5b; }
.dropzone__icon svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.8; }
.dropzone__title { margin-top: 16px; font-size: 15px; font-weight: 700; }
.dropzone__or { margin: 7px 0; color: #7b8793; font-size: 12px; }
.choose-button { min-height: 34px; padding: 7px 12px; border: 1px solid #bdc7cf; border-radius: 6px; background: #fff; color: #263746; font-size: 13px; font-weight: 700; }
#file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.selection { min-height: 68px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; border: 1px solid #d9e0e5; border-radius: 7px; background: #fafbfc; }
.file-icon { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 6px; background: #e8f3fb; color: #1769aa; }
.file-icon svg, .button svg, .icon-button svg, .result__check svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.file-icon svg { width: 21px; height: 21px; }
.file-details { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 3px; }
.file-details strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.file-details span { color: #71808d; font-size: 12px; }

.icon-button { width: 36px; height: 36px; flex: 0 0 auto; display: grid; place-items: center; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #687785; cursor: pointer; }
.icon-button:hover { border-color: #d3dbe1; background: #fff; color: #243442; }
.icon-button:focus-visible, .button:focus-visible, .dropzone:focus-within { outline: 3px solid rgba(23, 105, 170, 0.2); outline-offset: 2px; }
.icon-button svg { width: 19px; height: 19px; }

.progress { margin-top: 20px; }
.progress__labels { display: flex; justify-content: space-between; gap: 16px; color: #4e5e6c; font-size: 12px; font-weight: 700; }
.progress__track { height: 7px; margin-top: 8px; overflow: hidden; border-radius: 4px; background: #e5eaee; }
.progress__track span { width: 0; height: 100%; display: block; background: #087f5b; transition: width 120ms ease; }
.message { margin-top: 18px; padding: 11px 13px; border-radius: 6px; font-size: 13px; line-height: 1.45; }
.message--error { border: 1px solid #efc2bd; background: #fff3f1; color: #9b2c23; }
.actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; }

.button { min-height: 38px; padding: 8px 14px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 6px; font-size: 13px; font-weight: 700; text-decoration: none; cursor: pointer; }
.button svg { width: 17px; height: 17px; }
.button--primary { border: 1px solid #087252; background: #087f5b; color: #fff; }
.button--primary:hover { background: #076b4d; }
.button--primary:disabled { border-color: #b9c5cd; background: #c5cfd6; cursor: not-allowed; }
.button--secondary { border: 1px solid #bdc7cf; background: #fff; color: #263746; }
.button--secondary:hover { background: #f5f7f8; }

.result { padding: 28px; }
.result__status { display: flex; align-items: center; gap: 13px; }
.result__check { width: 40px; height: 40px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 50%; background: #e4f5ed; color: #087f5b; }
.result__check svg { width: 22px; height: 22px; stroke-width: 2.3; }
.result h2 { font-size: 17px; letter-spacing: 0; }
.result__status p { margin-top: 4px; color: #677583; font-size: 13px; }
.url-label { margin-top: 24px; display: block; color: #4c5d6b; font-size: 12px; font-weight: 700; }
.url-field { margin-top: 7px; display: flex; }
.url-field input { min-width: 0; height: 42px; flex: 1; padding: 0 12px; border: 1px solid #bdc7cf; border-right: 0; border-radius: 6px 0 0 6px; background: #fafbfc; color: #263746; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.url-field input:focus { outline: 2px solid rgba(23, 105, 170, 0.25); outline-offset: -1px; }
.icon-button--copy { width: 44px; height: 42px; border: 1px solid #bdc7cf; border-radius: 0 6px 6px 0; background: #fff; }
.result__actions { margin-top: 20px; display: flex; justify-content: flex-end; gap: 10px; }

.recent-heading { align-items: center; }
.refresh-button { border-color: #d3dbe1; background: #fff; }
.refresh-button.is-loading svg { animation: spin 800ms linear infinite; }
.recent-toolbar { min-height: 56px; padding: 11px 20px; display: flex; flex-wrap: wrap; align-items: end; gap: 10px; border-bottom: 1px solid #e3e8ec; background: #fafbfc; }
.recent-field { display: grid; gap: 3px; color: var(--muted); font-size: 11px; font-weight: 700; }
.recent-field--search { min-width: 170px; flex: 1; }
.recent-field input, .recent-field select { min-height: 34px; padding: 6px 8px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--ink); }
.filter-control { height: 32px; display: inline-flex; padding: 2px; border: 1px solid #d5dde3; border-radius: 6px; background: #fff; }
.filter-button { min-width: 64px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; color: #687785; font-size: 12px; font-weight: 700; cursor: pointer; }
.filter-button:hover { color: #243442; }
.filter-button.is-active { background: #e8eef2; color: #243442; }
.filter-button:focus-visible { outline: 3px solid rgba(23, 105, 170, 0.2); outline-offset: 2px; }
.upload-list { padding: 0 20px; }
.upload-row { min-height: 74px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 18px; border-bottom: 1px solid #e8ecef; }
.upload-row:last-child { border-bottom: 0; }
.upload-row__main { min-width: 0; display: flex; align-items: center; gap: 12px; }
.upload-row__icon { width: 36px; height: 36px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 6px; background: #e8f3fb; color: #1769aa; }
.upload-row--html .upload-row__icon { background: #eaf5f1; color: #087252; }
.upload-row__icon svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.upload-row__details { min-width: 0; }
.upload-row__name { max-width: 100%; display: block; overflow: hidden; color: #243442; font-size: 13px; font-weight: 700; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.upload-row__name:hover { color: #0969da; text-decoration: underline; }
.upload-row__meta { margin-top: 4px; color: #71808d; font-size: 11px; }
.upload-row__date { color: #62717e; font-size: 12px; white-space: nowrap; }
.upload-row__actions { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
.upload-row__open { min-height: 36px; padding: 0 8px; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #687785; font-size: 12px; font-weight: 700; line-height: 1; text-decoration: none; white-space: nowrap; }
.upload-row__open svg { width: 16px; height: 16px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.upload-row__open:hover { border-color: #d3dbe1; background: #fff; color: #243442; }
.list-state { min-height: 180px; padding: 48px 24px; display: grid; place-items: center; color: #71808d; font-size: 13px; text-align: center; }
.load-more { min-height: 70px; padding: 15px 20px; display: flex; align-items: center; justify-content: center; border-top: 1px solid #e8ecef; }
.load-more__button { min-width: 132px; }

/* Mauroner Tools design system */
.auth-panel { border-color: var(--line); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow); }
.auth-panel__icon, .result__check { border-color: #b7d8ca; background: var(--accent-soft); color: var(--accent); }
.auth-panel p, .workspace__heading p, .result__status p, .file-details span,
.upload-row__meta, .upload-row__date, .list-state, .identity { color: var(--muted); }
.view-tabs { border-color: var(--line); border-radius: var(--radius); background: var(--surface); }
.view-tab { color: var(--muted); }
.view-tab:hover { color: var(--ink); }
.view-tab.is-active { background: var(--accent-soft); color: var(--accent); }
.workspace__heading, .recent-toolbar, .load-more { border-color: var(--line); }
.expiry { border-color: #e9d19c; background: var(--amber-soft); color: var(--amber); }
.dropzone { border-color: #aeb7ae; border-radius: var(--radius); background: rgba(255, 255, 255, .38); }
.dropzone:hover, .dropzone:focus-within, .dropzone.is-dragging { border-color: var(--accent); background: #eff8f3; box-shadow: inset 0 0 0 1px var(--accent); }
.dropzone__icon { border-color: var(--line); border-radius: var(--radius); background: var(--surface); color: var(--accent); }
.dropzone__or { color: var(--muted); }
.choose-button, .button--secondary, .refresh-button, .icon-button--copy { border-color: var(--line); background: var(--surface); color: var(--ink); }
.selection, .url-field input, .recent-toolbar { border-color: var(--line); background: rgba(255, 255, 255, .38); }
.file-icon, .upload-row__icon { background: #e7eef4; color: var(--blue); }
.upload-row--html .upload-row__icon { background: var(--accent-soft); color: var(--accent); }
.icon-button { color: var(--muted); }
.icon-button:hover { border-color: var(--line); background: var(--surface); color: var(--ink); }
.icon-button:focus-visible, .button:focus-visible, .dropzone:focus-within,
.filter-button:focus-visible { outline-color: rgba(8, 116, 81, .25); }
.progress__labels, .url-label { color: var(--muted); }
.progress__track { background: #e3e5df; }
.progress__track span { background: var(--accent); }
.message--error { border-color: #e5b9b4; background: var(--red-soft); color: var(--red); }
.button { border-radius: var(--radius); }
.button--primary { border-color: #075c42; background: var(--accent); }
.button--primary:hover { background: #075d43; }
.button--primary:disabled { border-color: #bec4bc; background: #cbd0c9; }
.button--secondary:hover { background: #f2f1eb; }
.url-field input { color: var(--ink); }
.filter-control { border-color: var(--line); background: var(--surface); }
.filter-button { color: var(--muted); }
.filter-button:hover { color: var(--ink); }
.filter-button.is-active { background: #e7e9e2; color: var(--ink); }
.upload-row { border-bottom-color: #e2e1da; }
.upload-row__name { color: var(--ink); }
.upload-row__name:hover { color: var(--blue); }
.link-affordance { margin-left: 5px; }

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 620px) {
  .suite-header__inner { width: 100%; min-height: auto; align-items: stretch; flex-direction: column; gap: 4px; padding: 12px; }
  .suite-brand { padding-left: 4px; }
  .suite-nav { width: 100%; flex-wrap: wrap; overflow-x: visible; padding-bottom: 2px; }
  .suite-nav a { padding-inline: 7px; font-size: 12px; }
  .topbar__inner, main { width: min(100% - 24px, 820px); }
  .identity__email { max-width: 124px; }
  main { padding: 24px 0 48px; }
  .view-tabs { width: 100%; }
  .view-tab { min-width: 0; flex: 1; }
  .workspace__heading { padding: 20px; align-items: center; }
  form, .result { padding: 20px; }
  .dropzone { min-height: 210px; padding: 24px 16px; }
  .result__actions, .actions { flex-direction: column-reverse; }
  .button { width: 100%; }
  .recent-toolbar, .upload-list { padding-right: 14px; padding-left: 14px; }
  .filter-control { width: 100%; }
  .recent-field, .recent-field--search { width: 100%; }
  .filter-button { min-width: 0; flex: 1; }
  .upload-row { grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 11px 0; }
  .upload-row__date { grid-column: 1; padding-left: 48px; font-size: 11px; }
  .upload-row__actions { grid-column: 2; grid-row: 1 / span 2; }
}

@media (max-width: 439px) {
  .suite-nav a { flex: 1 1 calc(33.333% - 4px); justify-content: center; }
  .topbar { height: auto; }
  .topbar__inner { min-height: 78px; padding-block: 10px; align-items: flex-start; flex-direction: column; justify-content: center; gap: 7px; }
  .identity { width: 100%; justify-content: space-between; }
  .identity__email { max-width: none; overflow-wrap: anywhere; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
}

/* Command Deck */
:root {
  color-scheme: dark;
  --ink: #fafafa;
  --muted: #a1a1aa;
  --paper: #000;
  --surface: #09090b;
  --line: #27272a;
  --accent: #fafafa;
  --accent-soft: #18181b;
  --blue: #93c5fd;
  --amber: #facc15;
  --amber-soft: #1c1705;
  --red: #fb7185;
  --red-soft: #2b0b11;
  --radius: 8px;
  --radius-lg: 8px;
  --shadow: none;
}

html, body { background: #000; color: #fafafa; }
body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.suite-header[data-suite-shell="command-deck"] {
  position: sticky;
  top: 0;
  border-color: var(--line);
  background: #050505;
  backdrop-filter: none;
}
.suite-header__inner { width: min(1160px, calc(100% - 32px)); min-height: 56px; }
.suite-brand { color: #fafafa; }
.suite-brand > span { background: #fafafa; color: #000; }
.suite-nav a { color: #a1a1aa; }
.suite-nav a:hover { color: #fff; background: #18181b; }
.suite-nav a[aria-current="page"] { color: #fff; background: #27272a; }
.topbar { height: 52px; border-color: var(--line); background: #000; }
.topbar__inner, main { width: min(100% - 32px, 1160px); }
.brand { color: #fafafa; }
.identity { color: #a1a1aa; }
.identity__status { background: #22c55e; box-shadow: none; }
.identity__signout { color: #a1a1aa; }
.identity__signout:hover { border-color: #3f3f46; background: #18181b; color: #fff; }
main { padding: 24px 0 56px; }
.auth-panel, .workspace {
  border-color: var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: none;
}
.auth-panel__icon { border-color: #3f3f46; background: #18181b; color: #fafafa; }
.auth-panel p, .workspace__heading p, .result__status p, .file-details span,
.upload-row__meta, .upload-row__date, .list-state, .identity { color: var(--muted); }
.view-tabs { border-color: var(--line); border-radius: 6px; background: var(--surface); }
.view-tab { color: var(--muted); }
.view-tab:hover { color: #fff; }
.view-tab.is-active { background: #fafafa; color: #000; }
.workspace__heading, .recent-toolbar, .load-more { border-color: var(--line); background: var(--surface); }
.expiry { border-color: #514914; background: var(--amber-soft); color: var(--amber); }
form, .result { background: var(--surface); }
.dropzone {
  border-color: #52525b;
  border-radius: 6px;
  background: #050505;
  transition: none;
}
.dropzone:hover, .dropzone:focus-within, .dropzone.is-dragging {
  border-color: #fafafa;
  background: #111113;
  box-shadow: inset 0 0 0 1px #fafafa;
}
.dropzone__icon { border-color: #3f3f46; background: #18181b; color: #fafafa; }
.dropzone__or { color: #71717a; }
.choose-button, .button--secondary, .refresh-button, .icon-button--copy {
  border-color: #3f3f46;
  background: #111113;
  color: #fafafa;
}
.selection, .url-field input { border-color: #3f3f46; background: #111113; }
.file-icon, .upload-row__icon { background: #172554; color: #bfdbfe; }
.upload-row--html .upload-row__icon { background: #092817; color: #86efac; }
.icon-button { color: #a1a1aa; }
.icon-button:hover { border-color: #3f3f46; background: #18181b; color: #fff; }
.upload-row__open { border-color: #3f3f46; color: #a1a1aa; }
.upload-row__open:hover { border-color: #52525b; background: #18181b; color: #fff; }
.progress__labels, .url-label { color: var(--muted); }
.progress__track { background: #27272a; }
.progress__track span { background: #fafafa; transition: none; }
.message--error { border-color: #7f1d32; background: var(--red-soft); color: var(--red); }
.button { border-radius: 6px; transition: none; }
.button--primary { border-color: #fafafa; background: #fafafa; color: #000; }
.button--primary:hover { background: #fff; color: #000; }
.button--primary:disabled { border-color: #3f3f46; background: #27272a; color: #71717a; }
.button--secondary:hover { border-color: #a1a1aa; background: #18181b; }
.result__check { background: #092817; color: #86efac; }
.url-field input { color: #fafafa; }
.recent-toolbar { background: #09090b; }
.recent-field input, .recent-field select { border-color: #3f3f46; background: #111113; color: #fafafa; }
.filter-control { border-color: #3f3f46; background: #111113; }
.filter-button { color: #a1a1aa; }
.filter-button:hover { color: #fff; }
.filter-button.is-active { background: #fafafa; color: #000; }
.upload-row { border-bottom-color: var(--line); }
.upload-row__name { color: #fafafa; }
.upload-row__name:hover { color: #bfdbfe; }
.load-more { border-top-color: var(--line); }
.refresh-button.is-loading svg { animation: none; }
*, *::before, *::after { animation: none !important; transition: none !important; }

@media (max-width: 620px) {
  .suite-header__inner { width: 100%; min-height: auto; padding: 12px; align-items: stretch; flex-direction: column; gap: 4px; }
  .suite-brand { padding-left: 4px; }
  .suite-nav { width: 100%; flex-wrap: wrap; overflow-x: visible; }
  main { width: min(100% - 24px, 1160px); padding-top: 24px; }
  .topbar__inner { width: min(100% - 24px, 1160px); }
}
`;

export const EXTERNAL_UPLOAD_SCRIPT = `
(() => {
  "use strict";

  const authPanel = document.getElementById("auth-panel");
  const authMessage = document.getElementById("auth-message");
  const signIn = document.getElementById("sign-in");
  const signOut = document.getElementById("sign-out");
  const identity = document.getElementById("identity");
  const identityEmail = document.getElementById("identity-email");
  const authenticatedApp = document.getElementById("authenticated-app");
  const uploadTab = document.getElementById("upload-tab");
  const recentTab = document.getElementById("recent-tab");
  const uploadView = document.getElementById("upload-view");
  const recentView = document.getElementById("recent-view");
  const refreshUploads = document.getElementById("refresh-uploads");
  const recentSummary = document.getElementById("recent-summary");
  const uploadList = document.getElementById("upload-list");
  const listState = document.getElementById("list-state");
  const loadMoreWrap = document.getElementById("load-more-wrap");
  const loadMore = document.getElementById("load-more");
  const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
  const uploadSearch = document.getElementById("upload-search");
  const uploadExpiry = document.getElementById("upload-expiry");
  const uploadSort = document.getElementById("upload-sort");
  const form = document.getElementById("upload-form");
  const input = document.getElementById("file-input");
  const dropzone = document.getElementById("dropzone");
  const selection = document.getElementById("selection");
  const fileName = document.getElementById("file-name");
  const fileSize = document.getElementById("file-size");
  const clearFile = document.getElementById("clear-file");
  const uploadButton = document.getElementById("upload-button");
  const cancelButton = document.getElementById("cancel-button");
  const progress = document.getElementById("progress");
  const progressLabel = document.getElementById("progress-label");
  const progressValue = document.getElementById("progress-value");
  const progressBar = document.getElementById("progress-bar");
  const errorMessage = document.getElementById("error-message");
  const result = document.getElementById("result");
  const resultMeta = document.getElementById("result-meta");
  const resultUrl = document.getElementById("result-url");
  const copyUrl = document.getElementById("copy-url");
  const openUrl = document.getElementById("open-url");
  const newUpload = document.getElementById("new-upload");

  let authToken = null;
  let selectedFile = null;
  let activeRequest = null;
  let uploads = [];
  let uploadsLoaded = false;
  let uploadsLoading = false;
  let uploadsCursor = null;
  let activeFilter = "all";
  let searchTimer = null;
  let uploadsReloadPending = false;

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 bytes";
    const units = ["bytes", "KB", "MB", "GB", "TB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
    const value = bytes / Math.pow(1000, unitIndex);
    return (unitIndex === 0 ? value.toFixed(0) : value.toFixed(value >= 10 ? 1 : 2)) + " " + units[unitIndex];
  };

  const setFile = (file) => {
    selectedFile = file || null;
    errorMessage.hidden = true;
    dropzone.hidden = Boolean(selectedFile);
    selection.hidden = !selectedFile;
    uploadButton.disabled = !selectedFile;
    if (selectedFile) {
      fileName.textContent = selectedFile.name;
      fileSize.textContent = formatBytes(selectedFile.size);
    } else {
      input.value = "";
    }
  };

  const reset = () => {
    form.hidden = false;
    result.hidden = true;
    progress.hidden = true;
    cancelButton.hidden = true;
    uploadButton.hidden = false;
    uploadButton.disabled = true;
    progressBar.style.width = "0%";
    progressValue.textContent = "0%";
    setFile(null);
  };

  const showError = (message) => {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  };

  const showSignedOut = (message) => {
    authToken = null;
    authPanel.hidden = false;
    authenticatedApp.hidden = true;
    identity.hidden = true;
    authMessage.textContent = message || "Sign in to continue.";
    signIn.disabled = false;
  };

  const showSignedIn = (token, claims) => {
    authToken = token;
    authPanel.hidden = true;
    authenticatedApp.hidden = false;
    identity.hidden = false;
    identityEmail.textContent = claims.email || "Authenticated";
  };

  const setView = (view) => {
    const showRecent = view === "recent";
    uploadView.hidden = showRecent;
    recentView.hidden = !showRecent;
    uploadTab.classList.toggle("is-active", !showRecent);
    recentTab.classList.toggle("is-active", showRecent);
    uploadTab.setAttribute("aria-selected", String(!showRecent));
    recentTab.setAttribute("aria-selected", String(showRecent));
  };

  const formatDate = (value) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));

  const copyText = async (value, button) => {
    try {
      await navigator.clipboard.writeText(value);
      button.setAttribute("aria-label", "Copied");
      button.setAttribute("title", "Copied");
      window.setTimeout(() => {
        button.setAttribute("aria-label", "Copy URL");
        button.setAttribute("title", "Copy URL");
      }, 1500);
    } catch {
      window.prompt("Copy URL", value);
    }
  };

  const configureDestination = (link, value, label) => {
    const destination = new URL(value, window.location.href);
    const external = destination.origin !== window.location.origin;
    link.href = destination.href;
    if (external) {
      link.target = "_blank";
      link.rel = "noreferrer";
      link.setAttribute("aria-label", label + " (opens in a new tab)");
    } else {
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.setAttribute("aria-label", label);
    }
    return external;
  };

  const appendDestinationAffordance = (link, external) => {
    const affordance = document.createElement("span");
    affordance.className = "link-affordance";
    affordance.setAttribute("aria-hidden", "true");
    affordance.textContent = external ? "↗" : "›";
    link.append(affordance);
    if (external) {
      const announcement = document.createElement("span");
      announcement.className = "visually-hidden";
      announcement.textContent = " (opens in a new tab)";
      link.append(announcement);
    }
  };

  const renderOpenLink = (link, value, label) => {
    const external = configureDestination(link, value, label);
    link.innerHTML = external
      ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 5h5v5"></path><path d="m10 14 9-9"></path><path d="M19 14v5H5V5h5"></path></svg>'
      : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"></path></svg>';
    link.append(document.createTextNode(label));
  };

  const renderUploads = () => {
    uploadList.replaceChildren();
    const label =
      activeFilter === "html"
        ? uploads.length === 1 ? "plan" : "plans"
        : activeFilter === "file"
          ? uploads.length === 1 ? "file" : "files"
          : uploads.length === 1 ? "upload" : "uploads";
    recentSummary.textContent =
      uploads.length + " " + label + " loaded from the shared bucket.";
    listState.hidden = uploads.length > 0;
    listState.textContent =
      activeFilter === "html"
        ? "No plans yet."
        : activeFilter === "file"
          ? "No files yet."
          : "No uploads yet.";
    loadMoreWrap.hidden = !uploadsCursor;

    for (const upload of uploads) {
      const row = document.createElement("article");
      row.className = "upload-row upload-row--" + upload.kind;

      const main = document.createElement("div");
      main.className = "upload-row__main";
      const icon = document.createElement("span");
      icon.className = "upload-row__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML =
        upload.kind === "html"
          ? '<svg viewBox="0 0 24 24"><path d="M6 2h8l4 4v16H6z"></path><path d="M14 2v5h5"></path><path d="M9 12h6M9 16h6"></path></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M6 2h8l4 4v16H6z"></path><path d="M14 2v5h5"></path></svg>';
      const details = document.createElement("div");
      details.className = "upload-row__details";
      const name = document.createElement("a");
      name.className = "upload-row__name";
      name.textContent = upload.filename;
      name.title = upload.filename;
      appendDestinationAffordance(
        name,
        configureDestination(name, upload.url, upload.filename)
      );
      const meta = document.createElement("div");
      meta.className = "upload-row__meta";
      meta.textContent =
        (upload.kind === "html" ? "Plan" : "File") +
        (upload.project ? " - " + upload.project : "") +
        " - " +
        formatBytes(upload.bytes) +
        (upload.expiresAt ? " - expires " + formatDate(upload.expiresAt) : "");
      details.append(name, meta);
      main.append(icon, details);

      const date = document.createElement("time");
      date.className = "upload-row__date";
      date.dateTime = upload.updatedAt;
      date.textContent = "Uploaded at " + formatDate(upload.updatedAt);

      const actions = document.createElement("div");
      actions.className = "upload-row__actions";
      const copy = document.createElement("button");
      copy.className = "icon-button";
      copy.type = "button";
      copy.setAttribute("aria-label", "Copy URL");
      copy.setAttribute("title", "Copy URL");
      copy.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path></svg>';
      copy.addEventListener("click", () => void copyText(upload.url, copy));
      const open = document.createElement("a");
      open.className = "upload-row__open";
      open.setAttribute("title", "Open upload");
      renderOpenLink(open, upload.url, "Open upload");
      actions.append(copy, open);
      row.append(main, date, actions);
      uploadList.append(row);
    }
  };

  const loadUploads = async ({ reset = false } = {}) => {
    if (!authToken) return;
    if (uploadsLoading) {
      if (reset) uploadsReloadPending = true;
      return;
    }
    uploadsLoading = true;
    if (reset) {
      uploads = [];
      uploadsCursor = null;
      uploadsLoaded = false;
      uploadList.replaceChildren();
    }
    refreshUploads.classList.add("is-loading");
    refreshUploads.disabled = true;
    filterButtons.forEach((button) => {
      button.disabled = true;
    });
    loadMore.disabled = true;
    loadMore.textContent = "Loading...";
    loadMoreWrap.hidden = reset || !uploadsCursor;
    listState.hidden = false;
    listState.textContent = reset ? "Loading uploads..." : "Loading more uploads...";

    try {
      const url = new URL("/api/external-uploads", window.location.origin);
      url.searchParams.set("limit", "25");
      url.searchParams.set("kind", activeFilter);
      const query = uploadSearch.value.trim();
      if (query) url.searchParams.set("q", query);
      url.searchParams.set("expiry", uploadExpiry.value);
      url.searchParams.set("sort", uploadSort.value);
      if (!reset && uploadsCursor) {
        url.searchParams.set("cursor", uploadsCursor);
      }
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        }
      });
      const payload = await response.json();
      if (response.status === 401) {
        showSignedOut("Your session expired. Sign in again to continue.");
        return;
      }
      if (!response.ok || !payload || !Array.isArray(payload.uploads)) {
        throw new Error(payload && payload.message ? payload.message : "Could not load uploads.");
      }
      uploads = reset ? payload.uploads : uploads.concat(payload.uploads);
      uploadsCursor =
        typeof payload.nextCursor === "string" ? payload.nextCursor : null;
      uploadsLoaded = true;
      renderUploads();
    } catch (error) {
      listState.hidden = false;
      listState.textContent =
        error instanceof Error ? error.message : "Could not load uploads.";
    } finally {
      uploadsLoading = false;
      refreshUploads.classList.remove("is-loading");
      refreshUploads.disabled = false;
      filterButtons.forEach((button) => {
        button.disabled = false;
      });
      loadMore.disabled = false;
      loadMore.textContent = "Load more";
      loadMoreWrap.hidden = !uploadsCursor;
      if (uploadsReloadPending) {
        uploadsReloadPending = false;
        void loadUploads({ reset: true });
      }
    }
  };

  const initializeAuth = async () => {
    showSignedIn("browser-session", { email: "Authenticated" });
  };

  signIn.addEventListener("click", () => location.reload());

  signOut.addEventListener("click", () => {
    fetch("/api/auth/sign-out", { method: "POST" }).finally(() => location.assign("/"));
  });

  uploadTab.addEventListener("click", () => setView("upload"));
  recentTab.addEventListener("click", () => {
    setView("recent");
    if (!uploadsLoaded) void loadUploads({ reset: true });
  });
  refreshUploads.addEventListener("click", () => void loadUploads({ reset: true }));
  loadMore.addEventListener("click", () => void loadUploads());
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";
      filterButtons.forEach((candidate) =>
        candidate.classList.toggle("is-active", candidate === button)
      );
      void loadUploads({ reset: true });
    });
  });
  uploadSearch.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void loadUploads({ reset: true }), 250);
  });
  uploadExpiry.addEventListener("change", () => void loadUploads({ reset: true }));
  uploadSort.addEventListener("change", () => void loadUploads({ reset: true }));

  input.addEventListener("change", () => setFile(input.files && input.files[0]));
  clearFile.addEventListener("click", () => setFile(null));

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  });

  dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (file) setFile(file);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!selectedFile || activeRequest || !authToken) return;

    const body = new FormData();
    body.append("file", selectedFile, selectedFile.name);
    const request = new XMLHttpRequest();
    activeRequest = request;
    progress.hidden = false;
    errorMessage.hidden = true;
    uploadButton.hidden = true;
    cancelButton.hidden = false;

    request.upload.addEventListener("progress", (progressEvent) => {
      if (!progressEvent.lengthComputable) {
        progressLabel.textContent = "Uploading";
        progressValue.textContent = "";
        return;
      }
      const percent = Math.min(100, Math.round((progressEvent.loaded / progressEvent.total) * 100));
      progressValue.textContent = percent + "%";
      progressBar.style.width = percent + "%";
    });

    request.addEventListener("load", () => {
      activeRequest = null;
      cancelButton.hidden = true;
      let payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = null;
      }

      if (request.status < 200 || request.status >= 300 || !payload || !payload.url) {
        if (request.status === 401) {
          reset();
          showSignedOut("Your session expired. Sign in again.");
          return;
        }
        uploadButton.hidden = false;
        progress.hidden = true;
        showError(payload && payload.message ? payload.message : "Upload failed. Try again.");
        return;
      }

      form.hidden = true;
      result.hidden = false;
      resultUrl.value = payload.url;
      renderOpenLink(openUrl, payload.url, "Open");
      const expiry = payload.expiresAt
        ? "Expires " + new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.expiresAt))
        : "Uploaded";
      resultMeta.textContent = formatBytes(payload.bytes) + " - " + expiry;
      uploadsLoaded = false;
    });

    request.addEventListener("error", () => {
      activeRequest = null;
      cancelButton.hidden = true;
      uploadButton.hidden = false;
      progress.hidden = true;
      showError("The connection was interrupted. Try again.");
    });

    request.addEventListener("abort", () => {
      activeRequest = null;
      cancelButton.hidden = true;
      uploadButton.hidden = false;
      progress.hidden = true;
      showError("Upload cancelled.");
    });

    request.open("POST", "/api/external-uploads");
    request.setRequestHeader("Accept", "application/json");
    request.send(body);
  });

  cancelButton.addEventListener("click", () => {
    if (activeRequest) activeRequest.abort();
  });

  copyUrl.addEventListener("click", async () => {
    await copyText(resultUrl.value, copyUrl);
  });

  newUpload.addEventListener("click", reset);
  void initializeAuth();
})();
`;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
