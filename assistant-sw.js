self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{};}catch{}
  if(!payload.id)return;
  let url;try{url=new URL(payload.url,self.location.origin);}catch{return;}
  if(url.origin!==self.location.origin||url.pathname!=='/command')return;
  event.waitUntil(self.registration.showNotification("Jared's Assistant",{body:'A conversation needs your review.',tag:`assistant:${payload.id}`,renotify:false,data:{url:url.href}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL(event.notification.data?.url||'/command?area=assistant',self.location.origin);
  if(url.origin!==self.location.origin||url.pathname!=='/command')return;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const existing=windows.find(w=>new URL(w.url).origin===url.origin&&new URL(w.url).pathname==='/command');
    if(existing){await existing.navigate(url.href);return existing.focus();}
    return clients.openWindow(url.href);
  }));
});
