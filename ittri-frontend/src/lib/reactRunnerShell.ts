export const DEFAULT_HTML = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/><title>Landing Studio</title><style>html,body{height:100%}body{font:14px system-ui;margin:0;background:#0b1020;color:#e6eefc}header{padding:28px;background:#0f172a;color:#fff}main{padding:28px;}</style></head><body><header><h1>🚀 Landing Studio</h1><p>Describe your page on the left, then Generate.</p></header><main><p>Switch to <strong>Code</strong> to edit, then click <em>Run</em> to refresh the preview.</p></main></body></html>`;

export const reactRunnerShell = (source: string, title = 'Preview') => `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title><style>html,body,#root{height:100%}body{margin:0;font:14px system-ui;background:#0b1020;color:#e6eefc}.err{padding:16px;color:#dc2626;white-space:pre-wrap}</style></head><body><div id="root"></div><script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script><script type="text/babel" data-presets="typescript,react">
try{
  const rootEl=document.getElementById('root');
  const Root=(window).App||(typeof (window).App==='function'?(window).App:null);
  if(!Root){
    rootEl.innerHTML='<div class="err">Export default a component: <code>export default function App(){ return &lt;div/&gt; }</code></div>';
  }else{
    const root=(window).ReactDOM.createRoot(rootEl);
    (window).__runnerRoot=root;
    root.render((window).React.createElement(Root));
    const unmount=()=>{ try{ (window).__runnerRoot?.unmount?.(); }catch{}; (window).__runnerRoot=null; };
    window.addEventListener('unload', unmount, { once:true });
    window.addEventListener('pagehide', unmount, { once:true });
  }
}catch(e){
  (document.getElementById('root')).innerHTML='<pre class="err">'+String(e)+'</pre>';
}
</script><script type="text/babel" data-presets="typescript,react">
${source}
</script></body></html>`;
