/* The reader runs against public build-time projections; there is no API server. */
(function (root) {
  'use strict';
  const aliases={models:'model',jobs:'job',companies:'company',stories:'story'};
  const terms=value=>(String(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).map(w=>aliases[w]||w);
  const normalize=value=>(value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).join(' ');
  const kinds={stories:'thread',funding:'funding',people:'person_move',jobs:'job',models:'model',events:'event',benchmarks:'benchmark_result'};
  function score(record,query){
    const needles=terms(query);
    if(!needles.length)return query.trim()?null:0;
    let total=0;
    for(const needle of needles){let weight=0;for(const [tokens,value] of record.fields){if(tokens.some(t=>t.startsWith(needle)))weight=Math.max(weight,value);}if(!weight)return null;total+=weight;}
    return total;
  }
  function select(index,query,view){
    const get=k=>query.get(k)||'', q=get('q').trim().slice(0,200),scope=get('scope')==='archive'?'history':get('scope')||'all';
    let kind=get('kind')==='archive'?'thread':get('kind');
    const validKinds=new Set(index.groups.map(g=>g[0]));
    if(!['all','current','history'].includes(scope)||kind&&!validKinds.has(kind))throw new Error('Unknown search filter. Clear the filters and try again.');
    const fixed=kinds[view],company=get('company');
    let companyName=company.startsWith('name:')?company.slice(5):index.companies.find(c=>c.id===company)?.name;
    let values=[];
    for(const record of index.records){
      if(record.history&&view!=='search'&&!['stories','funding','research'].includes(view))continue;
      if(scope==='current'&&record.history||scope==='history'&&!record.history)continue;
      if(view==='research'&&(!['thread','event'].includes(record.kind)||record.topic!=='Research'))continue;
      if(fixed&&record.kind!==fixed)continue;
      const relevance=score(record,q);if(relevance===null)continue;
      if(get('topic')&&(get('topic')==='Capital'?'Funding':get('topic'))!==record.topic)continue;
      if(['transaction_type','stage','status','availability','move_type','verification_state','workplace_type','comparison_key','benchmark_id','evaluation_kind'].some(k=>get(k)&&record.filters[k]!==get(k)))continue;
      if(get('currency')&&record.currency!==get('currency'))continue;
      if(get('country')&&!record.countries.includes(get('country')))continue;
      if(company&&!record.entities.some(e=>e.id===company||companyName&&normalize(e.name)===normalize(companyName)))continue;
      values.push({record,relevance});
    }
    values.sort((a,b)=>(view==='search'?b.relevance-a.relevance:0)||b.record.updated-a.record.updated||(a.record.id<b.record.id?-1:a.record.id>b.record.id?1:0));
    const counts={};for(const {record} of values)counts[record.kind]=(counts[record.kind]||0)+1;
    let offset=get('cursor')||'0';if(!/^\d+$/.test(offset))throw new Error('Invalid page. Clear the filters and try again.');offset=Number(offset);if(!Number.isSafeInteger(offset))throw new Error('Invalid page.');
    if(view==='search'&&kind)values=values.filter(({record})=>record.kind===kind);
    const total=values.length;
    let groups=[];
    if(view==='search'){
      const page=kind||scope==='history'?values.slice(offset,offset+20):values;
      groups=index.groups.filter(([k])=>(!kind||kind===k)&&page.some(x=>x.record.kind===k)).map(([k,label,description])=>({kind:k,label,description,total:counts[k]||0,items:page.filter(x=>x.record.kind===k).slice(0,kind||scope==='history'?20:5).map(x=>x.record)}));
      const intent={models:'model',model:'model',funding:'funding',jobs:'job',people:'person_move',research:'event',news:'thread'}[q.toLocaleLowerCase()];
      if(intent&&!kind)groups.sort((a,b)=>Number(b.kind===intent)-Number(a.kind===intent));
    }
    return {q,kind,scope,counts,total,groups,items:values.slice(offset,offset+20).map(x=>x.record),next:(view!=='search'||kind||scope==='history')&&offset+20<total?offset+20:null,landing:view==='search'&&!q&&!kind&&![...query].some(([k,v])=>v&&!['scope','cursor','fragment'].includes(k))&&scope==='all'};
  }
  const api={terms,score,select};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document==='undefined')return;
  root.AIbriefStatic=api;
  const path=location.pathname.replace(/\/+$/,'')||'/',segment=path.split('/')[1];
  if(segment==='archive'&&new URLSearchParams(location.search).has('date')){const date=new URLSearchParams(location.search).get('date');if(/^\d{4}-\d{2}-\d{2}$/.test(date))location.replace('/archive/'+date+'/');return;}
  const view=segment==='search'?'search':kinds[segment]||segment==='research'?segment:segment==='companies'&&path==='/companies'?'companies':null;
  if(!view||path.split('/').length>2&&!/\/page\/\d+$/.test(path))return;
  const result=document.getElementById('results')||document.querySelector('.directory-list');
  const form=document.querySelector('[data-search-form],form.filters');
  if(!result||!form)return;
  const base='/'+segment+'/', landing=result.innerHTML;
  let index,sequence=0,timer;
  function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
  function link(text,url,className){const a=element('a',className,text);a.href=url;return a;}
  function params(){const q=new URLSearchParams(location.search),match=location.pathname.replace(/\/+$/,'').match(/\/page\/(\d+)$/);if(match&&!q.has('cursor'))q.set('cursor',String((Number(match[1])-1)*20));return q;}
  function url(query,changes={}){const q=new URLSearchParams(query);q.delete('fragment');for(const [k,v] of Object.entries(changes)){q.delete(k);if(v!==null&&v!=='')q.set(k,String(v));}return base+(q.size?'?'+q:'');}
  function trustedFragment(markup){const template=document.createElement('template');template.innerHTML=markup;return template.content;}
  function appendRecords(parent,records,field){for(const r of records)parent.append(trustedFragment(r[field]));}
  function syncForm(query){for(const input of form.querySelectorAll('input[name],select[name]'))input.value=query.get(input.name)|| (input.name==='scope'?'all':'');}
  function nextPage(query,next){if(next!==null)result.append(link('Next page →',url(query,{cursor:next}),'next-page'));}
  function renderSearch(query,state){
    result.replaceChildren();
    const refinements=form.querySelector('.search-refinements');let clear=form.querySelector('[data-static-clear]');if(!clear&&refinements){clear=link('Clear search',base);clear.dataset.staticClear='true';refinements.append(clear);}if(clear)clear.hidden=state.landing;
    if(state.landing){result.innerHTML=landing;return;}
    const summary=element('div','search-summary');summary.append(element('p','result-count',state.total+' '+(state.total===1?'result':'results')+(state.q?' for “'+state.q+'”':'')),element('span','', 'Most relevant first'+(state.groups.length>1?' · Grouped by type':'')));summary.firstChild.setAttribute('role','status');result.append(summary);
    if(state.scope!=='history'){
      const tabs=element('div','search-type-tabs');tabs.setAttribute('role','navigation');tabs.setAttribute('aria-label','Result types');
      for(const [kind,label] of [['','All'],...index.groups]){if(kind&&!state.counts[kind]&&state.kind!==kind)continue;const a=link(label+' ',url(query,{kind,cursor:null}));a.append(element('span','',String(kind?state.counts[kind]||0:Object.values(state.counts).reduce((a,b)=>a+b,0))));if(state.kind===kind)a.setAttribute('aria-current','page');tabs.append(a);}result.append(tabs);
    }
    for(const group of state.groups){
      const section=element('section','search-group'),heading=element('div','search-group-heading'),titles=element('div'),h2=element('h2','',group.label+' ');h2.id='search-group-'+group.kind;h2.append(element('span','',String(group.total)));section.setAttribute('aria-labelledby',h2.id);titles.append(h2,element('p','',group.description));heading.append(titles);if(!state.kind&&state.scope!=='history'&&group.total>group.items.length)heading.append(link('View all '+group.total+' →',url(query,{kind:group.kind,cursor:null})));section.append(heading);appendRecords(section,group.items,'search_html');result.append(section);
    }
    if(!state.groups.length)result.append(element('p','empty','No matching records. Try fewer filters or another term.'));
    nextPage(query,state.next);
  }
  function renderModels(records){
    const groups=new Map();
    for(const record of records){const model=record.model,key=model.creator_id+'|'+model.family;if(!groups.has(key))groups.set(key,{...model,records:[],modalities:new Set(),updated:record.updated});const g=groups.get(key);g.records.push(record);model.modalities.forEach(m=>g.modalities.add(m));g.updated=Math.max(g.updated,record.updated);}
    const container=element('div','model-directory');
    for(const group of [...groups.values()].sort((a,b)=>b.updated-a.updated||a.family.localeCompare(b.family)||a.creator.localeCompare(b.creator))){
      const section=element('section','model-family'),heading=element('div','model-family-heading');heading.append(element('h2','',group.family),element('p','',group.creator+' · '+[...group.modalities].join(', ')));section.append(heading);
      const wrap=element('div','model-table-wrap'),table=element('table','model-table'),caption=element('caption','sr-only',group.family+' versions'),thead=element('thead'),row=element('tr');for(const text of ['Version','Access','Released']){const th=element('th','',text);th.scope='col';row.append(th);}thead.append(row);const tbody=element('tbody');for(const r of group.records.sort((a,b)=>a.model.version.localeCompare(b.model.version,undefined,{numeric:true,sensitivity:'base'}))){tbody.append(trustedFragment(r.row_html));}table.append(caption,thead,tbody);wrap.append(table);section.append(wrap);container.append(section);
    }
    result.append(container);
  }
  function renderDirectory(query,state){
    result.replaceChildren(element('p','result-count',state.total+' '+(segment==='models'?'model '+(state.total===1?'version':'versions'):state.total===1?'result':'results')+(state.q?' for “'+state.q+'”':'')));
    if(segment==='models')renderModels(state.items);else {const list=element('div','directory-list');appendRecords(list,state.items,'directory_html');result.append(list);}
    if(!state.items.length)result.append(element('p','empty','No matching records. Try fewer filters or another term.'));
    nextPage(query,state.next);
  }
  function renderCompanies(query){
    const q=(query.get('q')||'').toLocaleLowerCase(), category=query.get('category'),country=query.get('country');
    const values=index.companies.filter(c=>c.name.toLocaleLowerCase().includes(q)&&(!category||c.category===category)&&(!country||c.country===country));result.replaceChildren();for(const c of values)result.append(trustedFragment(c.html));if(!values.length)result.append(element('p','empty','No companies match these filters.'));
  }
  function render(query){
    if(query.get('scope')==='archive')query.set('scope','history');if(query.get('kind')==='archive')query.set('kind','thread');
    try{syncForm(query);if(view==='companies')renderCompanies(query);else{const state=select(index,query,view);if(view==='search')renderSearch(query,state);else renderDirectory(query,state);}}catch(error){result.replaceChildren(element('p','empty',error.message));}result.setAttribute('aria-busy','false');
  }
  async function load(){
    const current=++sequence;result.setAttribute('aria-busy','true');try{let response=await fetch(document.documentElement.dataset.readerIndex,{credentials:'omit'});if(response.status===404)response=await fetch('/data/reader.json',{credentials:'omit',cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(data.version!==1||!Array.isArray(data.records))throw new Error();if(current!==sequence)return;index=data;render(params());}catch{result.setAttribute('aria-busy','false');const notice=element('p','notice','Search and filters could not load. Reload to try again; the generated pages remain available.');notice.setAttribute('role','alert');result.prepend(notice);}
  }
  function navigate(target,replace=false){const u=new URL(target,location.href);if(u.origin!==location.origin)return;history[replace?'replaceState':'pushState'](null,'',u.pathname+u.search);if(index)render(new URLSearchParams(u.search));}
  form.addEventListener('submit',event=>{event.preventDefault();const query=new URLSearchParams(new FormData(form));for(const [k,v] of [...query])if(!v)query.delete(k);const kind=new URLSearchParams(location.search).get('kind');if(kind&&view==='search')query.set('kind',kind);navigate(base+(query.size?'?'+query:''));});
  form.querySelectorAll('select').forEach(select=>select.addEventListener('change',()=>{if(select.name==='scope'){const current=new URL(location.href);current.searchParams.delete('kind');history.replaceState(null,'',current.pathname+current.search);}form.requestSubmit();}));
  const input=form.querySelector('input[name=q]');if(input)input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{const query=new URLSearchParams(new FormData(form));query.delete('cursor');const kind=new URLSearchParams(location.search).get('kind');if(kind&&view==='search')query.set('kind',kind);for(const [k,v] of [...query])if(!v)query.delete(k);navigate(base+(query.size?'?'+query:''),true);},250);});
  result.addEventListener('click',event=>{const a=event.target.closest('a');if(!a||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;const target=new URL(a.href);if(target.origin===location.origin&&target.pathname.replace(/\/+$/,'')===base.replace(/\/+$/,'')){event.preventDefault();navigate(a.href);}});
  window.addEventListener('popstate',()=>{if(index)render(params());});
  load();
})(typeof globalThis==='undefined'?this:globalThis);
