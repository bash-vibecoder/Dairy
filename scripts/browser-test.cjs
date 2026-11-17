/* Integration checks for the bundled UI with a simulated Android file bridge.
   Install Playwright separately; no browser tooling is shipped in the app. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require(process.env.ANOTEP_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname,'../app/src/main/assets');
const output = path.resolve(__dirname,'../build/screenshots');
fs.mkdirSync(output,{recursive:true});

(async()=>{
  const server = http.createServer((request,response)=>{
    const relative = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const file = path.join(root, relative==='/' ? 'index.html' : relative);
    if(!file.startsWith(root+path.sep) || !fs.existsSync(file)){response.writeHead(404);response.end();return;}
    const ext = path.extname(file);
    response.setHeader('Content-Type',{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.txt':'text/plain'}[ext]||'application/octet-stream');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'");
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({viewport:{width:412,height:850},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page = await context.newPage();
  const errors=[],externals=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(url))externals.push(request.url());});
  await context.addInitScript(()=>{
    window.__commands=[];window.__persisted=null;window.__disk={};window.__clipboard='';window.__delaySave=false;window.__delayed=null;window.__conflict=false;
    const emit=(type,payload,requestId='')=>setTimeout(()=>window.App.nativeEvent({type,payload,requestId}),0);
    window.AnotePNative={dispatch(raw){const command=JSON.parse(raw);window.__commands.push(command);const p=command.payload,id=command.requestId;
      if(command.type==='ready')emit('bootstrap',window.__restore||{});
      if(command.type==='persist')window.__persisted=p;
      if(command.type==='save'){
        if(window.__conflict&&!p.force&&!p.saveAs){emit('conflict',{name:p.name},id);return;}
        const uri=p.saveAs||!p.uri?'content://local/'+p.name:p.uri;
        window.__disk[uri]=p.text;
        const event={type:'saved',payload:{id:p.id,name:p.name,uri,fingerprint:'hash-'+p.text.length},requestId:id};
        if(window.__delaySave)window.__delayed=event;else emit(event.type,event.payload,id);
      }
      if(command.type==='copy'){window.__clipboard=p.text;emit('copied',{},id);}
      if(command.type==='paste')emit('pasted',{text:window.__clipboard},id);
      if(command.type==='listFolder')emit('folderListing',{uri:p.uri,entries:[{name:'notes.txt',uri:'content://local/notes.txt',directory:false},{name:'src',uri:'content://local/src',directory:true}]},id);
      if(command.type==='findInFiles')emit('findResults',{matches:[{uri:'content://local/notes.txt',name:'notes.txt',line:1,snippet:'offline'}],files:1,skipped:0,limited:false},id);
      if(command.type==='licenses')emit('licenses',{text:'CodeMirror MIT license'},id);
    }};
  });
  const cm=()=>page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.getValue());
  const set=async(text)=>page.evaluate(text=>document.querySelector('#editor .CodeMirror').CodeMirror.setValue(text),text);
  const run=async(action)=>page.evaluate(action=>{window.App.run(action);},action);
  const selectAll=()=>page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.execCommand('selectAll'));
  let checks=0;
  const check=(value,expected,message)=>{assert.deepEqual(value,expected,message);checks++;};
  try{
    await page.goto(url);await page.waitForSelector('.document-tab');
    check(await page.locator('.document-tab').count(),1,'Initial tab');
    check(await cm(),'','Starts with an empty document');
    const layout=await page.evaluate(()=>({menuRows:new Set([...document.querySelectorAll('#menubar button')].map(n=>n.getBoundingClientRect().top)).size,toolRows:new Set([...document.querySelectorAll('#toolbar button')].map(n=>n.getBoundingClientRect().top)).size,arrows:[...document.querySelectorAll('.arrow-keys button')].map(n=>({key:n.dataset.key,x:n.getBoundingClientRect().left,y:n.getBoundingClientRect().top}))}));
    check(layout.menuRows,2,'Menus occupy two rows');check(layout.toolRows,2,'Toolbar occupies two rows');
    const arrow=key=>layout.arrows.find(a=>a.key===key);
    check(arrow('up').x,arrow('down').x,'Up and down share a column');check(arrow('up').y<arrow('down').y,true,'Up arrow is above down');check(arrow('left').x<arrow('down').x&&arrow('right').x>arrow('down').x,true,'Left and right arrows flank down');
    await set('const greet = (name) => {\n\t// Everything stays on this device.\n\treturn `Hello, ${name}!`;\n};\n\ngreet("AnoteP");\n');
    await run('language:text/javascript');
    await page.waitForSelector('.cm-keyword');
    check(await page.locator('#languageStatus').textContent(),'JavaScript','Language selection');
    check(await page.locator('.document-tab .dirty').count(),1,'Unsaved indicator');
    await page.screenshot({path:path.join(output,'phone-light.png')});
    await run('dark');check(await page.locator('body').evaluate(b=>b.classList.contains('dark')),true,'Dark theme');
    await page.screenshot({path:path.join(output,'phone-dark.png')});await run('light');

    await run('new');await set('cat cats cat\nCAT\n');
    check(await page.locator('.document-tab').count(),2,'Multiple tabs');
    await run('replace');await page.locator('#findInput').fill('cat');await page.locator('#wholeWord').check();
    await page.waitForFunction(()=>document.getElementById('matchCount').textContent==='3 matches');
    check(await page.locator('#matchCount').textContent(),'3 matches','Whole-word case-insensitive search');
    await page.locator('#replaceInput').fill('dog');await page.locator('#replaceAll').click();
    check(await cm(),'dog cats dog\ndog\n','Replace all');
    await run('undo');check(await cm(),'cat cats cat\nCAT\n','Replace all is undoable');
    await page.locator('#closeSearch').click();
    await set('item=12\nitem=42');await run('replace');await page.locator('#findInput').fill('item=(\\d+)');await page.locator('#useRegex').check();await page.locator('#wholeWord').uncheck();await page.locator('#replaceInput').fill('value: $1');await page.locator('#replaceAll').click();
    check(await cm(),'value: 12\nvalue: 42','Regex replacement captures');await page.locator('#closeSearch').click();

    await set('b\na\nc');await selectAll();await run('sortAsc');check(await cm(),'a\nb\nc','Sort lines');
    await run('undo');check(await cm(),'b\na\nc','Sort undo');
    await set('one\ntwo\nthree');await page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.setCursor({line:1,ch:1}));await run('lineUp');check(await cm(),'two\none\nthree','Move line up');
    await run('lineDown');check(await cm(),'one\ntwo\nthree','Move line down');
    await run('bookmark');check(await page.locator('.bookmark-marker').count()>0,true,'Bookmark gutter');
    await run('new');await set('other tab');
    await run('split');check(await page.locator('#secondaryPane').isVisible(),true,'Split view');
    await page.evaluate(()=>document.querySelector('#secondEditor .CodeMirror').CodeMirror.replaceRange(' linked',{line:0,ch:9}));check(await cm(),'other tab linked','Edits propagate between split views');await run('closeSplit');
    await run('language:text/x-python');
    await run('save');await page.waitForSelector('#dialogBackdrop:not([hidden])');await page.locator('#dialogBody input').fill('sample.py');await page.getByRole('button',{name:'OK',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.document-tab.active .tab-name').textContent==='sample.py');
    check(await page.locator('.document-tab.active .dirty').count(),0,'Save marks tab clean');
    check(await page.evaluate(()=>window.__disk['content://local/sample.py']),'other tab linked','Native save receives correct content');
    await page.evaluate(()=>{window.__delaySave=true;document.querySelector('#editor .CodeMirror').CodeMirror.replaceRange(' v1',{line:0,ch:17});});
    await run('save');await page.waitForFunction(()=>!!window.__delayed);
    await page.evaluate(()=>{document.querySelector('#editor .CodeMirror').CodeMirror.replaceRange(' v2',{line:0,ch:20});window.App.nativeEvent(window.__delayed);window.__delaySave=false;});
    check(await page.locator('.document-tab.active .dirty').count(),1,'Edits during a save remain dirty');
    await run('save');await page.waitForFunction(()=>!document.querySelector('.document-tab.active .dirty'));

    await page.evaluate(()=>{window.__conflict=true;document.querySelector('#editor .CodeMirror').CodeMirror.replaceRange(' changed',{line:0,ch:0});});
    await run('save');await page.waitForSelector('#dialogBackdrop:not([hidden])');
    check(await page.locator('#dialogTitle').textContent(),'File changed outside AnoteP','External change conflict');
    await page.getByRole('button',{name:'Overwrite',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.document-tab.active .dirty'));await page.evaluate(()=>window.__conflict=false);

    await run('new');await set('');
    await run('recordMacro');await page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.replaceSelection('abc','end','+input'));await run('stopMacro');await run('playMacro');check(await cm(),'abcabc','Macro playback');
    await run('saveMacro');
    await selectAll();await run('copy');await page.waitForFunction(()=>window.__clipboard==='abcabc');
    await page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.setCursor({line:0,ch:6}));await run('paste');await page.waitForFunction(()=>document.querySelector('#editor .CodeMirror').CodeMirror.getValue()==='abcabcabcabc');checks++;

    await run('close');await page.waitForSelector('#dialogBackdrop:not([hidden])');check(await page.locator('#dialogTitle').textContent(),'Save changes?','Closing unsaved tabs asks before discarding');await page.getByRole('button',{name:'Cancel',exact:true}).click();
    check(await page.locator('.document-tab').count(),4,'Cancel close preserves document');
    await page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.setCursor({line:0,ch:0}));
    await page.locator('[data-modifier=shift]').click();await page.locator('[data-key=right]').click();await page.locator('[data-key=right]').click();
    check(await page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.getSelection()),'ab','Shift + arrows extend selection');
    await page.locator('[data-modifier=shift]').click();
    await page.locator('[data-modifier=ctrl]').click();await page.locator('[data-key=A]').click();
    check(await page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.getSelection()),'abcabcabcabc','Ctrl + A selects all');
    check(await page.locator('[data-modifier=ctrl]').getAttribute('aria-pressed'),'false','Ctrl resets after shortcut');
    await page.locator('[data-modifier=alt]').click();check(await page.locator('[data-modifier=alt]').getAttribute('aria-pressed'),'true','Alt toggles');await page.locator('[data-modifier=alt]').click();
    await page.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.setCursor({line:0,ch:12}));
    await page.evaluate(()=>App.flushSession());
    const recovery=await page.evaluate(()=>window.__persisted);
    check(recovery.documents.length,4,'Recovery captures all tabs');check(recovery.documents.some(d=>d.text==='abcabcabcabc'),true,'Recovery captures unsaved text');
    check(recovery.settings.macro.length>0,true,'Saved macros are persisted');
    const restoredPage=await context.newPage();restoredPage.on('pageerror',e=>errors.push(e.message));
    await restoredPage.addInitScript(recovery=>{window.__restore=recovery;},recovery);
    await restoredPage.goto(url);await restoredPage.waitForSelector('.document-tab');
    check(await restoredPage.locator('.document-tab').count(),4,'Recovered tab count');
    check(await restoredPage.evaluate(()=>document.querySelector('#editor .CodeMirror').CodeMirror.getValue()),'abcabcabcabc','Recovery reopens current document');
    await restoredPage.close();

    await page.evaluate(()=>App.nativeEvent({type:'folderChosen',payload:{uri:'content://local/tree',name:'My projects'}}));
    await page.waitForSelector('.tree-node');check(await page.locator('#sidebar').isVisible(),true,'Folder browser');
    await run('findInFiles');await page.waitForSelector('#dialogBackdrop:not([hidden])');await page.locator('#dialogBody input[type=text]').fill('offline');await page.getByRole('button',{name:'Find All',exact:true}).click();await page.waitForSelector('.result-row');check(await page.locator('.result-row').count(),1,'Folder search results');await page.locator('#closeResults').click();
    await page.locator('#closeFolder').click();

    await page.setViewportSize({width:360,height:740});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'360px screen does not overflow');
    await page.screenshot({path:path.join(output,'phone-360.png')});
    await page.setViewportSize({width:850,height:380});await page.screenshot({path:path.join(output,'phone-landscape.png')});
    check(await page.locator('#editor').evaluate(n=>n.getBoundingClientRect().height>100),true,'Landscape editing area');
    await page.setViewportSize({width:1280,height:800});
    await page.locator('.document-tab').first().click();await run('split');await page.screenshot({path:path.join(output,'tablet-split.png')});
    check(await page.locator('#secondaryPane').isVisible(),true,'Tablet split');await run('closeSplit');

    // Exercise every menu without changing document content.
    for(const name of ['File','Edit','Search','View','Encoding','Language','Settings','Macro','Help']){
      await page.locator('[data-menu="'+name+'"]').click();check(await page.locator('#menuPopover').isVisible(),true,name+' menu opens');
      await page.locator('[data-menu="'+name+'"]').click();
    }
    await page.locator('[data-menu=File]').click();
    await page.setViewportSize({width:412,height:480});
    check(await page.locator('#menuPopover').isVisible(),true,'Menu survives keyboard opening resize');
    await page.setViewportSize({width:412,height:850});
    check(await page.locator('#menuPopover').isVisible(),true,'Menu survives keyboard dismissal resize');
    check(await page.evaluate(()=>window.__commands.some(c=>c.type==='hideKeyboard')),true,'Menu tap requests keyboard dismissal');
    await page.locator('#menuPopover [data-action=new]').click();
    check(await page.locator('.document-tab').count(),5,'Menu action works after keyboard dismissal');
    await set('#!/usr/bin/env python3\ndef greet(name):\n    print(name)\n');
    await page.waitForFunction(()=>document.getElementById('languageStatus').textContent==='Python · Auto');
    check(await page.locator('#languageStatus').textContent(),'Python · Auto','Detects language of an extensionless document');
    await run('language:text/plain');await set('const a = 1; console.log(a);');
    await page.waitForTimeout(600);
    check(await page.locator('#languageStatus').textContent(),'Normal text','Manual language overrides detection');
    await run('autoLanguage');check(await page.locator('#languageStatus').textContent(),'JavaScript · Auto','Automatic detection can be re-enabled');
    await run('about');await page.waitForSelector('#dialogBackdrop:not([hidden])');await page.screenshot({path:path.join(output,'about.png')});await page.locator('#dialogClose').click();
    await run('licenses');await page.waitForSelector('#dialogBackdrop:not([hidden])');check(await page.locator('#dialogBody').textContent(),'CodeMirror MIT license','Local license text');await page.locator('#dialogClose').click();
    check(externals,[],'No remote requests from bundled UI');check(errors,[],'No JavaScript runtime errors');
    console.log('Browser integration: '+checks+' checks passed. Screenshots: build/screenshots/');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
