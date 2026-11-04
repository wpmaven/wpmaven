import React from 'react';

/**
 * The editor's styles, scoped under .wme-gs. They ship inside the editor's
 * own chunk (a chunk's separate CSS file is not part of the plugin), and use
 * the app's palette variables, so light and dark follow the app.
 *
 * wp-admin draws a typed field (input[type="email"] and the like), a disabled
 * and a read-only one itself, at one attribute and one element: the editor's
 * own rules for those are written under .wme-gs, so they outweigh it. The
 * selects take the shared .wm-select (styles/dashboard.css).
 */
export const GS_CSS = `
.wme-gs{--gs-radius:12px;--gs-side:384px;width:100%;height:100%;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:"Inter",sans-serif;overflow:hidden}
.wme-gs *{box-sizing:border-box}
.wme-gs-bar{height:52px;flex-shrink:0;display:flex;align-items:center;gap:10px;padding:0 14px;background:var(--bg-raised);border-bottom:1px solid var(--glass-border);font-family:"DM Sans",sans-serif;z-index:500;min-width:0}
.wme-gs-bar-group{display:flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--bg)}
.wme-gs-bar-sep{width:1px;height:22px;background:var(--glass-border);flex-shrink:0}
.wme-gs-spacer{flex:1;min-width:8px}
.wme-gs-tool{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--text-dim);font:500 13px "DM Sans",sans-serif;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.wme-gs-tool:hover{color:var(--text);background:color-mix(in srgb,var(--purple) 8%,transparent)}
.wme-gs-tool[aria-pressed="true"],.wme-gs-tool.is-on{color:var(--purple);background:color-mix(in srgb,var(--purple) 12%,transparent)}
.wme-gs-tool:focus-visible,.wme-gs-link:focus-visible,.wme-gs-row-btn:focus-visible{outline:2px solid var(--purple);outline-offset:2px}
.wme-gs-tool svg{width:15px;height:15px;flex-shrink:0}
.wme-gs-page{position:relative}
.wme-gs-page-btn{max-width:240px}
.wme-gs-page-btn span{overflow:hidden;text-overflow:ellipsis}
.wme-gs-menu{position:absolute;top:calc(100% + 6px);left:0;min-width:260px;max-height:60vh;overflow:auto;padding:6px;border-radius:var(--gs-radius);background:var(--bg-raised);border:1px solid var(--glass-border);box-shadow:var(--glass-shadow);z-index:700}
.wme-gs-menu button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:var(--text);font:500 13px "Inter",sans-serif;text-align:left;cursor:pointer}
.wme-gs-menu button:hover,.wme-gs-menu button[aria-current="true"]{background:color-mix(in srgb,var(--purple) 10%,transparent)}
.wme-gs-menu small{color:var(--text-dim);font-weight:400}
.wme-gs-menu button.wme-gs-menu-add{justify-content:flex-start;margin-top:4px;color:var(--purple);border-top:1px solid var(--glass-border);border-radius:0 0 8px 8px}
.wme-gs-menu-add span{display:inline-flex;align-items:center;gap:6px}
.wme-gs-main{flex:1;display:flex;min-height:0}
.wme-gs-stage{flex:1;position:relative;min-width:0;overflow:hidden}
.wme-gs-side{width:var(--gs-side);flex-shrink:0;display:flex;flex-direction:column;background:var(--bg-raised);border-left:1px solid var(--glass-border);min-height:0}
.wme-gs-panel{display:flex;flex-direction:column;height:100%;min-height:0}
.wme-gs-head{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-bottom:1px solid var(--glass-border)}
.wme-gs-head-text{flex:1;min-width:0}
.wme-gs-chip{display:inline-flex;align-items:center;gap:6px;font:600 11px "DM Sans",sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--gs-kind,var(--purple))}
.wme-gs-chip::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--gs-kind,var(--purple))}
.wme-gs-title{margin:4px 0 0;font:600 15px "DM Sans",sans-serif;color:var(--text);overflow-wrap:anywhere}
.wme-gs-sub{margin:2px 0 0;font-size:12px;color:var(--text-dim)}
.wme-gs-x{width:28px;height:28px;flex-shrink:0;border-radius:50%;border:1px solid var(--glass-border);background:var(--bg);color:var(--text-dim);cursor:pointer;font-size:16px;line-height:1}
.wme-gs-x:hover{color:var(--text)}
.wme-gs-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;min-height:0}
.wme-gs-foot{border-top:1px solid var(--glass-border);padding:12px 16px;display:flex;flex-direction:column;gap:10px}
.wme-gs-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.wme-gs-actions .wme-gs-push{margin-left:auto}
.wme-gs-label{display:block;font:600 12px "DM Sans",sans-serif;color:var(--text);margin:0 0 6px}
.wme-gs-hint{margin:0;font-size:12px;line-height:1.5;color:var(--text-dim)}
.wme-gs-input,.wme-gs-textarea,.wme-gs input.wme-gs-input[type]{width:100%;padding:9px 11px;border-radius:10px;border:1px solid var(--glass-border);background:var(--bg);color:var(--text);font:400 13px "Inter",sans-serif;line-height:1.45}
.wme-gs-select{width:100%}
.wme-gs-textarea{min-height:92px;resize:vertical}
.wme-gs-input:focus,.wme-gs-textarea:focus,.wme-gs input.wme-gs-input[type]:focus{outline:none;border-color:var(--purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--purple) 18%,transparent)}
.wme-gs-input[aria-invalid="true"],.wme-gs input.wme-gs-input[type][aria-invalid="true"]{border-color:var(--rose)}
.wme-gs :is(.wme-gs-input,.wme-gs-textarea):disabled{color:var(--text);background:var(--bg);border-color:var(--glass-border);box-shadow:none;opacity:.5;cursor:not-allowed}
.wme-gs :is(.wme-gs-input,.wme-gs-textarea)[readonly]{background-color:var(--bg)}
.wme-gs-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.wme-gs-suggest{display:flex;flex-wrap:wrap;gap:6px}
.wme-gs-suggest button{padding:4px 10px;border-radius:999px;border:1px solid var(--glass-border);background:transparent;color:var(--text-dim);font:500 12px "Inter",sans-serif;cursor:pointer}
.wme-gs-suggest button:hover{color:var(--text);border-color:var(--purple)}
.wme-gs-note{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;background:var(--glass);border:1px solid var(--glass-border);color:var(--text)}
.wme-gs-note.is-warn{border-color:color-mix(in srgb,var(--peach) 55%,transparent);background:color-mix(in srgb,var(--peach) 9%,transparent)}
.wme-gs-note.is-bad{border-color:color-mix(in srgb,var(--rose) 55%,transparent);background:color-mix(in srgb,var(--rose) 8%,transparent)}
.wme-gs-note.is-good{border-color:color-mix(in srgb,var(--cyan) 50%,transparent);background:color-mix(in srgb,var(--cyan) 8%,transparent)}
.wme-gs-working{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text)}
.wme-gs-spin{width:16px;height:16px;border-radius:50%;border:2px solid color-mix(in srgb,var(--purple) 25%,transparent);border-top-color:var(--purple);animation:wme-gs-spin .8s linear infinite;flex-shrink:0}
@keyframes wme-gs-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.wme-gs-spin{animation-duration:2.4s}}
.wme-gs-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.wme-gs-check{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.45;border:1px solid var(--glass-border)}
.wme-gs-check b{flex-shrink:0;font:600 11px "DM Sans",sans-serif;text-transform:uppercase;letter-spacing:.03em}
.wme-gs-check.is-broken{border-color:color-mix(in srgb,var(--rose) 55%,transparent);background:color-mix(in srgb,var(--rose) 8%,transparent)}
.wme-gs-check.is-broken b{color:var(--rose)}
.wme-gs-check.is-warn{border-color:color-mix(in srgb,var(--peach) 55%,transparent);background:color-mix(in srgb,var(--peach) 8%,transparent)}
.wme-gs-check.is-warn b{color:var(--peach)}
.wme-gs-check.is-info b{color:var(--text-dim)}
.wme-gs-changes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-dim)}
.wme-gs-changes del{color:var(--text-dim)}
.wme-gs-changes ins{text-decoration:none;color:var(--text);font-weight:500}
.wme-gs-result{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.45}
.wme-gs-result.is-ok{background:color-mix(in srgb,var(--cyan) 10%,transparent);border:1px solid color-mix(in srgb,var(--cyan) 45%,transparent)}
.wme-gs-result.is-bad{background:color-mix(in srgb,var(--rose) 8%,transparent);border:1px solid color-mix(in srgb,var(--rose) 45%,transparent)}
.wme-gs-result svg{flex-shrink:0;margin-top:2px}
.wme-gs-thumbs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.wme-gs-thumbs figure{margin:0}
.wme-gs-thumbs img{width:100%;border-radius:8px;border:1px solid var(--glass-border);display:block}
.wme-gs-thumbs figcaption{font-size:11px;color:var(--text-dim);margin-top:4px}
.wme-gs-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.wme-gs-row{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:10px;border:1px solid var(--glass-border);background:var(--bg);font-size:13px;min-width:0}
.wme-gs-row-main{flex:1;min-width:0}
.wme-gs-row-main p{margin:0;overflow-wrap:anywhere}
.wme-gs-row-main small{display:block;color:var(--text-dim);font-size:11px;margin-top:2px}
.wme-gs-row-btn{border:0;background:transparent;color:var(--text-dim);cursor:pointer;padding:4px 6px;border-radius:6px;font:500 12px "Inter",sans-serif}
.wme-gs-row-btn:hover{color:var(--text);background:var(--glass)}
.wme-gs-row-btn:disabled{opacity:.4;cursor:default}
.wme-gs-row.is-drag{opacity:.5}
.wme-gs-row.is-child{margin-left:22px}
.wme-gs-link{border:0;background:none;padding:0;color:var(--purple);font:500 13px "Inter",sans-serif;cursor:pointer;text-align:left}
.wme-gs-link:hover{text-decoration:underline}
.wme-gs-status{display:inline-block;padding:1px 8px;border-radius:999px;font:600 11px "DM Sans",sans-serif;background:var(--glass);color:var(--text-dim);flex-shrink:0}
.wme-gs-status.is-live{background:color-mix(in srgb,var(--cyan) 14%,transparent);color:var(--cyan)}
.wme-gs-status.is-preview{background:color-mix(in srgb,var(--purple) 12%,transparent);color:var(--purple)}
.wme-gs-status.is-bad{background:color-mix(in srgb,var(--rose) 12%,transparent);color:var(--rose)}
.wme-gs-colors{display:flex;flex-direction:column;gap:10px}
.wme-gs-color{display:grid;grid-template-columns:36px 1fr 110px;gap:10px;align-items:center}
.wme-gs-color input[type="color"]{width:36px;height:36px;padding:0;border:1px solid var(--glass-border);border-radius:10px;background:none;cursor:pointer}
.wme-gs-color input[type="color"]::-webkit-color-swatch-wrapper{padding:3px}
.wme-gs-color input[type="color"]::-webkit-color-swatch{border:0;border-radius:7px}
.wme-gs-color span{font-size:13px}
.wme-gs-ratio{font-size:12px;color:var(--text-dim);display:flex;justify-content:space-between;gap:8px}
.wme-gs-ratio b{font-weight:600;color:var(--text)}
.wme-gs-ratio.is-low b{color:var(--rose)}
.wme-gs-media{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.wme-gs-media button{position:relative;aspect-ratio:1;border:2px solid transparent;border-radius:8px;padding:0;overflow:hidden;cursor:pointer;background:var(--glass)}
.wme-gs-media button[aria-pressed="true"]{border-color:var(--purple)}
.wme-gs-media img{width:100%;height:100%;object-fit:cover;display:block}
.wme-gs-choices{display:flex;flex-direction:column;gap:6px}
.wme-gs-choice{display:flex;align-items:center;gap:6px;min-height:36px;padding:0 6px;border:1px solid var(--glass-border);border-radius:9px;background:var(--bg-raised)}
.wme-gs-choice.is-new{border-style:dashed}
.wme-gs-grip{color:var(--text-dim);font-size:12px;letter-spacing:-2px;cursor:grab;width:12px;flex-shrink:0;text-align:center}
.wme-gs-choice.is-new .wme-gs-grip{cursor:default;letter-spacing:0}
.wme-gs-choice-text{flex:1;min-width:0;border:0;background:transparent;color:var(--text);font:400 13px "Inter",sans-serif;padding:6px 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wme-gs-choice-text:focus{outline:none}
.wme-gs-choice:focus-within{border-color:var(--purple)}
.wme-gs-choice-extra{width:84px;height:26px;border:1px solid var(--glass-border);border-radius:7px;background:var(--bg);color:var(--text);font:400 12px "Inter",sans-serif;padding:3px 7px}
.wme-gs-choice-x{width:22px;height:22px;border:0;border-radius:50%;background:transparent;color:var(--text-dim);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.wme-gs-choice-x:hover{color:var(--rose)}
.wme-gs-tabs{display:flex;gap:4px;padding:3px;border-radius:999px;background:var(--bg)}
.wme-gs-tabs button{flex:1;height:30px;border:0;border-radius:999px;background:transparent;color:var(--text-dim);font:500 12px "DM Sans",sans-serif;cursor:pointer}
.wme-gs-tabs button[aria-selected="true"]{background:var(--bg-raised);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.wme-gs-banner{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:450;display:flex;align-items:center;gap:10px;padding:7px 8px 7px 14px;border-radius:999px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid color-mix(in srgb,var(--purple) 40%,var(--glass-border));box-shadow:var(--glass-shadow);font-size:12px;font-weight:500;white-space:nowrap}
.wme-gs-banner i{width:8px;height:8px;border-radius:50%;background:var(--purple);box-shadow:0 0 0 4px color-mix(in srgb,var(--purple) 20%,transparent)}
.wme-gs-empty{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--glass-border);box-shadow:var(--glass-shadow);font-size:13px;pointer-events:none;z-index:50;white-space:nowrap}
.wme-gs-section-title{margin:0;font:600 12px "DM Sans",sans-serif;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em}
.wme-gs-entry{display:flex;align-items:center;gap:12px;width:100%;padding:12px;border-radius:12px;border:1px solid var(--glass-border);background:var(--bg);color:var(--text);cursor:pointer;text-align:left;font:500 13px "Inter",sans-serif}
.wme-gs-entry:hover{border-color:color-mix(in srgb,var(--purple) 50%,var(--glass-border))}
.wme-gs-entry small{display:block;color:var(--text-dim);font-weight:400;font-size:12px;margin-top:2px}
.wme-gs-entry svg{width:18px;height:18px;flex-shrink:0;color:var(--purple)}
.wme-gs-share{display:flex;gap:6px;align-items:center}
.wme-gs-share input{flex:1;min-width:0}
.wme-gs-dialog{position:absolute;inset:0;z-index:800;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}
.wme-gs-dialog > div{width:min(400px,calc(100% - 32px));padding:20px;border-radius:16px;background:var(--bg-raised);border:1px solid var(--glass-border);box-shadow:var(--glass-shadow);display:flex;flex-direction:column;gap:12px}
.wme-gs-dialog h3{margin:0;font:600 15px "DM Sans",sans-serif}
.wme-gs-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
.wme-gs-row-btn.is-icon{display:inline-grid;place-items:center;width:30px;height:30px;padding:0;flex-shrink:0}
.wme-gs-social{list-style:none;margin:0;padding:0;flex-shrink:0;overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--glass-border);border-radius:10px;background:var(--bg)}
.wme-gs-social>li{margin:0}
.wme-gs-social>li+li{border-top:1px solid var(--glass-border)}
.wme-gs-social-line{display:flex;align-items:center;gap:10px;min-width:0;padding:6px 6px 6px 12px}
.wme-gs-social-name{flex-shrink:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 13px "Inter",sans-serif;color:var(--text)}
.wme-gs-social-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-dim)}
.wme-gs-social-url.is-empty{font-style:italic}
.wme-gs-social-row>.wme-gs-note{margin:0 12px 10px}
.wme-gs-social-row.is-open{display:flex;flex-direction:column;gap:8px;padding:12px;background:color-mix(in srgb,var(--purple) 5%,var(--bg))}
.wme-gs-social-pick{display:flex;align-items:center;gap:10px}
@media (max-width:1100px){.wme-gs{--gs-side:340px}.wme-gs-tool .wme-gs-tool-word{display:none}}
@media (max-width:782px){.wme-gs-main{flex-direction:column}.wme-gs-side{width:100%;height:52%;border-left:0;border-top:1px solid var(--glass-border)}}
`;

export function GsStyle(): React.ReactElement {
  return <style data-wme-gs="1">{GS_CSS}</style>;
}
