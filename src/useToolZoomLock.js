import {useEffect} from 'react';
export default function useToolZoomLock(enabled){
 useEffect(()=>{
  if(!enabled)return;
  const wheel=e=>{if(e.ctrlKey||e.metaKey)e.preventDefault()};
  const gesture=e=>e.preventDefault();
  const key=e=>{if((e.ctrlKey||e.metaKey)&&['+','=','-','0'].includes(e.key))e.preventDefault()};
  document.addEventListener('wheel',wheel,{passive:false});
  document.addEventListener('keydown',key);
  for(const name of ['gesturestart','gesturechange','gestureend'])document.addEventListener(name,gesture,{passive:false});
  return()=>{document.removeEventListener('wheel',wheel);document.removeEventListener('keydown',key);for(const name of ['gesturestart','gesturechange','gestureend'])document.removeEventListener(name,gesture)};
 },[enabled]);
}
